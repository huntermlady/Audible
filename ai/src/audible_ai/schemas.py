"""Shared JSON Schemas: validation (full schema) and model-facing schemas (inlined, simplified,
stat_ids constrained to the fact sheet's IDs)."""

from __future__ import annotations

import copy
import json
from functools import cache
from typing import Any
from urllib.parse import urljoin

from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from audible_contracts.paths import SCHEMAS_DIR

Schema = dict[str, Any]

# Keywords removed from model-facing schemas. Ollama's grammar and Claude structured outputs support
# only a subset of JSON Schema; local validation still enforces the full schema.
_STRIP_KEYS = ("$schema", "$id", "$defs", "description", "title", "pattern", "format",
               "minLength", "maxLength", "minimum", "maximum", "uniqueItems")


@cache
def load(name: str) -> Schema:
    """Load `shared/schemas/<name>.schema.json`."""
    return json.loads((SCHEMAS_DIR / f"{name}.schema.json").read_text())


@cache
def registry() -> Registry:
    resources = []
    for path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        schema = json.loads(path.read_text())
        resources.append((schema["$id"], Resource.from_contents(schema, DRAFT202012)))
    return Registry().with_resources(resources)


@cache
def validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(load(name), registry=registry())


def errors(name: str, instance: Any) -> list[str]:
    """Schema errors as short human-readable strings (empty if valid)."""
    out = []
    for err in sorted(validator(name).iter_errors(instance), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        out.append(f"{path}: {err.message}")
    return out


REPORT_BODY_ID = "https://huntermlady.github.io/Audible/schemas/report_body.schema.json"


def _resolve(ref: str, base: str, root: Schema) -> tuple[Schema, str]:
    url = urljoin(base, ref)
    doc_url, _, fragment = url.partition("#")
    doc = root if doc_url == root.get("$id") else registry().contents(doc_url)
    node: Any = doc
    for part in [p for p in fragment.split("/") if p]:
        node = node[part]
    return node, doc_url


def inline(schema: Schema, base: str | None = None) -> Schema:
    """Return a copy of `schema` with every $ref inlined and unsupported keywords removed."""
    root_base: str = base or schema.get("$id", "")

    def walk(node: Any, base: str) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                target, target_base = _resolve(node["$ref"], base, schema)
                return walk(target, target_base)
            out = {}
            for k, v in node.items():
                if k in _STRIP_KEYS:
                    continue
                if k == "properties":  # keys here are property names, never keywords
                    out[k] = {name: walk(sub, base) for name, sub in v.items()}
                else:
                    out[k] = walk(v, base)
            return out
        if isinstance(node, list):
            return [walk(v, base) for v in node]
        return node

    return walk(copy.deepcopy(schema), root_base)


def _constrain_stat_ids(node: Any, ids: list[str]) -> None:
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "stat_ids" and isinstance(v, dict) and v.get("type") == "array":
                v["items"] = {"type": "string", "enum": list(ids)}
            else:
                _constrain_stat_ids(v, ids)
    elif isinstance(node, list):
        for v in node:
            _constrain_stat_ids(v, ids)


def report_body_schema() -> Schema:
    """The part of a GamePlanReport the model writes: headline, keys, situational_calls."""
    full = load("game_plan_report")
    props = {k: full["properties"][k] for k in ("headline", "keys", "situational_calls")}
    return {
        "$id": REPORT_BODY_ID,
        "type": "object",
        "additionalProperties": False,
        "required": list(props),
        "properties": props,
        "$defs": full["$defs"],
    }


def report_body_errors(instance: Any) -> list[str]:
    v = Draft202012Validator(report_body_schema(), registry=registry())
    out = []
    for err in sorted(v.iter_errors(instance), key=lambda e: list(e.absolute_path)):
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        out.append(f"{path}: {err.message}")
    return out


OC_ONLY = ("play_family", "direction")
DC_ONLY = ("front", "coverage_shell", "pressure")


def _constrain_role(node: Any, role: str) -> None:
    """In every call option, force the other role's fields to null and this role's required
    fields to non-null (the role check of SPEC §12, enforced by JSON mode). `direction` stays
    optional for the OC."""
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict) and "role" in props and "primary" in props:
            props["role"] = {"type": "string", "enum": [role]}
        if isinstance(props, dict) and "play_family" in props and "front" in props:
            nulls = DC_ONLY if role == "OC" else OC_ONLY
            required = ("play_family",) if role == "OC" else DC_ONLY
            for name in nulls:
                props[name] = {"type": "null"}
            for name in required:
                enum = [v for v in props[name].get("enum", []) if v is not None]
                props[name] = {"type": "string", "enum": enum}
        for v in node.values():
            _constrain_role(v, role)
    elif isinstance(node, list):
        for v in node:
            _constrain_role(v, role)


def model_schema(kind: str, fact_ids: list[str], role: str | None = None) -> Schema:
    """Model-facing schema for `kind` in {"call", "report"} (SPEC §12); `role` ("OC"/"DC")
    additionally pins the role's call fields."""
    source = load("coordinator_call") if kind == "call" else report_body_schema()
    out = inline(source)
    _constrain_stat_ids(out, fact_ids)
    if role is not None:
        _constrain_role(out, role)
    return out
