"""Loads and renders shared/prompts templates (mirrored by web/src/ai/prompts.ts).

Template format: `<!-- @system -->` … `<!-- @user -->` …; other HTML comments are dropped;
`{{name}}` placeholders are replaced verbatim. `{{rules}}` is shared/prompts/_rules.md, and
`{{principles}}` is _oc_principles.md or _dc_principles.md, chosen by the template's `oc_`/`dc_`
prefix.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from typing import Any

from audible_contracts.paths import SHARED_DIR

PROMPTS_DIR = SHARED_DIR / "prompts"
_COMMENT = re.compile(r"<!--[\s\S]*?-->")
_SYSTEM = "<!-- @system -->"
_USER = "<!-- @user -->"


@dataclass(frozen=True)
class RenderedPrompt:
    system: str
    user: str


@cache
def template(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text()


def _clean(text: str) -> str:
    return _COMMENT.sub("", text).strip()


def _fill(text: str, values: Mapping[str, str]) -> str:
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    return text


def render(name: str, values: Mapping[str, str]) -> RenderedPrompt:
    raw = template(name)
    body = raw.split(_SYSTEM, 1)[1] if _SYSTEM in raw else raw
    system, _, user = body.partition(_USER)
    role = name.split("_", 1)[0]
    principles = _clean(template(f"_{role}_principles")) if role in ("oc", "dc") else ""
    values = {"rules": _clean(template("_rules")), "principles": principles, **values}
    return RenderedPrompt(system=_fill(_clean(system), values), user=_fill(_clean(user), values))


def render_facts(fs: Mapping[str, Any] | None) -> str:
    """Compact one-line-per-fact rendering used in every prompt."""
    if fs is None or not fs["facts"]:
        return "(no facts available)"
    lines = []
    for f in fs["facts"]:
        league = f" (league {f['league_display']})" if f["league_display"] is not None else ""
        low = ", LOW SAMPLE" if f["low_sample"] else ""
        lines.append(f"- {f['id']} | {f['label']} | {f['display']}{league} | n={f['n']}{low}")
    return "\n".join(lines)


def _json(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def situational_prompt(fs: Mapping[str, Any]) -> RenderedPrompt:
    situation = fs["context"]["situation"]
    name = "oc_situational" if situation["role"] == "OC" else "dc_situational"
    return render(name, {"situation": _json(situation), "derived": _json(fs["derived"]),
                         "fact_sheet": render_facts(fs)})


def report_prompt(fs: Mapping[str, Any]) -> RenderedPrompt:
    ctx = fs["context"]
    name = "oc_report" if ctx["role"] == "OC" else "dc_report"
    return render(name, {"context": _json(ctx), "fact_sheet": render_facts(fs)})


def chat_system(context: Mapping[str, Any], fs: Mapping[str, Any] | None) -> str:
    return render("chat", {"context": _json(context), "fact_sheet": render_facts(fs)}).system


def retry_user(user: str, errors: list[str]) -> str:
    """The retry prompt: the original user prompt plus the validation errors."""
    listed = "\n".join(f"- {e}" for e in errors[:20])
    return (f"{user}\n\nYour previous response failed validation:\n{listed}\n\n"
            "Fix every error and return the corrected JSON only.")
