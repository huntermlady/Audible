# Audible: single entry point for every task (BUILD_PLAN §3.1, CONTRACTS §3).
SHELL := /bin/bash
export UV_PROJECT_ENVIRONMENT := $(HOME)/.venvs/audible

SEASONS ?= auto
WEEK ?= auto

PY_MODELS := shared/py/src/audible_contracts/models
TS_TYPES := web/src/types/generated

.PHONY: setup types check-types data mock-data reports eval web build preview test e2e lint \
	worker-dev worker-deploy worker-test

setup:
	uv sync
	ln -sfn $(UV_PROJECT_ENVIRONMENT) .venv
	npm --prefix web ci
	npm --prefix worker ci
	@if command -v pre-commit >/dev/null 2>&1 && [ -f .pre-commit-config.yaml ]; then pre-commit install; fi

types:
	uv run python -m audible_contracts.codegen --py-out $(PY_MODELS) --ts-out $(TS_TYPES)

check-types:
	@tmp=$$(mktemp -d); \
	uv run python -m audible_contracts.codegen --py-out $$tmp/py --ts-out $$tmp/ts >/dev/null && \
	diff -r -x __pycache__ $(PY_MODELS) $$tmp/py && diff -r $(TS_TYPES) $$tmp/ts; \
	status=$$?; rm -rf $$tmp; \
	if [ $$status -ne 0 ]; then echo "Generated types are stale: run 'make types'." >&2; exit 1; fi

data:
	uv run python -m audible_pipeline build --seasons $(SEASONS) --out data

mock-data:
	uv run python -m audible_contracts.mock --out data

reports:
	uv run python -m audible_ai reports --week $(WEEK)

eval:
	uv run python -m audible_ai eval

web:
	npm --prefix web run dev

build:
	npm --prefix web run build

preview:
	npm --prefix web run preview

test:
	uv run pytest
	npm --prefix web test -- --run
	npm --prefix worker test -- --run

e2e:
	npm --prefix web run e2e

lint:
	uv run ruff check . && uv run pyright
	npm --prefix web run lint && npm --prefix web run typecheck
	npm --prefix worker run typecheck

# Cloudflare Worker (cloud AI for visitors without Ollama; T2)
worker-dev:
	npm --prefix worker run dev:remote

worker-deploy:
	npm --prefix worker run deploy

worker-test:
	npm --prefix worker test -- --run
