"""`python -m audible_ai reports --week auto|N` and `python -m audible_ai eval`."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from audible_ai.config import StageConfig, load_config, with_provider
from audible_ai.data import DATA_DIR, REPORTS_DIR
from audible_ai.providers import ProviderUnavailable, make_provider

log = logging.getLogger("audible_ai")

FAKE_REPORTS_DIR = Path.home() / ".cache" / "audible" / "fake-reports"
FAKE_EVAL_DIR = Path.home() / ".cache" / "audible" / "fake-eval"
PROVIDERS = ("ollama", "claude", "fake", "cloud")


def _ollama_ready(stage: StageConfig) -> StageConfig | None:
    """Return the stage to use (maybe with the fallback model), or None if Ollama is down.
    Exits with status 1 if Ollama is up but neither model is installed."""
    from audible_ai.providers.ollama import OllamaProvider

    up, models = OllamaProvider(stage.model, stage.base_url).health()
    if not up:
        return None
    installed = set(models) | {m.removesuffix(":latest") for m in models}
    if stage.model in installed:
        return stage
    if stage.fallback_model and stage.fallback_model in installed:
        log.warning("model %s not installed; using fallback %s", stage.model,
                    stage.fallback_model)
        return StageConfig(**{**stage.__dict__, "model": stage.fallback_model})
    log.error("model %s is not installed in Ollama (installed: %s). Run: ollama pull %s",
              stage.model, ", ".join(sorted(models)) or "none", stage.model)
    sys.exit(1)


def _cloud_ready(stage: StageConfig) -> StageConfig | None:
    """The cloud Worker: reachable, and model "auto" resolved to its default model."""
    from audible_ai.providers.ollama import OllamaProvider

    up, models = OllamaProvider(stage.model, stage.base_url, name="cloud").health(timeout_s=5)
    if not up or not models:
        log.warning("The cloud Worker is not reachable at %s; skipping %s stage.",
                    stage.base_url, stage.stage)
        return None
    if stage.model == "auto" or stage.model not in models:
        stage = StageConfig(**{**stage.__dict__, "model": models[0]})
    return stage


def _prepare(stage: StageConfig) -> StageConfig | None:
    if stage.provider == "cloud":
        return _cloud_ready(stage)
    if stage.provider != "ollama":
        return stage
    ready = _ollama_ready(stage)
    if ready is None:
        log.warning("Ollama is not running at %s; skipping %s stage. Start it with "
                    "`ollama serve` (or open the Ollama app) and re-run.",
                    stage.base_url, stage.stage)
    return ready


def cmd_reports(args: argparse.Namespace) -> int:
    from audible_ai import reports

    stage = _prepare(with_provider(load_config().batch, args.provider, args.base_url))
    if stage is None:
        return 0
    out = Path(args.out) if args.out else (FAKE_REPORTS_DIR if stage.provider == "fake"
                                           else REPORTS_DIR)
    week = args.week if args.week == "auto" else int(args.week)
    games = set(args.game or [])
    try:
        summary = reports.run(make_provider(stage), week, data_dir=Path(args.data), out_dir=out,
                              games_filter=(lambda g: g["game_id"] in games) if games else None,
                              with_samples=not args.no_samples,
                              skip_existing=args.skip_existing)
    except ProviderUnavailable as e:
        log.warning("%s; stopping. Reports written so far are indexed.", e)
        return 0
    log.info("season %d week %d: %d games, %d passed, %d failed, %d kept, %d samples → %s",
             summary.season, summary.week, summary.games, len(summary.written),
             len(summary.failed), len(summary.skipped), summary.samples, out)
    return 0


def _ask(scenario: dict, row: dict) -> bool | None:
    call = row["call"]["primary"]
    print(f"\n{scenario['id']}: {scenario['notes_for_human_rater']}")
    print(f"  call: {call}")
    for item in row["call"]["rationale"]:
        print(f"  - {item['text']}")
    answer = input("  defensible? [y/n/skip] ").strip().lower()
    return {"y": True, "n": False}.get(answer)


def cmd_eval(args: argparse.Namespace) -> int:
    from audible_ai import eval as ev

    cfg = load_config()
    stages = ["live", "batch"] if args.stage == "both" else [args.stage]
    configs = []
    for name in stages:
        stage = _prepare(with_provider(cfg.stage(name), args.provider, args.base_url))
        if stage is not None:
            configs.append((stage, make_provider(stage)))
    if not configs:
        return 0
    fake = all(stage.provider == "fake" for stage, _ in configs)
    results_dir = Path(args.out) if args.out else (FAKE_EVAL_DIR if fake else ev.RESULTS_DIR)
    try:
        result, path = ev.run_eval(configs, rate=_ask if args.rate else None,
                                   results_dir=results_dir)
    except ProviderUnavailable as e:
        log.warning("%s; eval stopped.", e)
        return 0
    print(ev.format_scorecard(result))
    print(f"\nwrote {path}")
    if not args.rate:
        print("Record the owner's rating with: uv run python -m audible_ai eval --rate")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="audible_ai")
    sub = parser.add_subparsers(dest="command", required=True)

    rp = sub.add_parser("reports", help="generate weekly game-plan reports")
    rp.add_argument("--week", default="auto", help="'auto' (manifest.current_week) or a number")
    rp.add_argument("--provider", choices=PROVIDERS, help="override [ai.batch].provider")
    rp.add_argument("--base-url", help="Ollama or cloud Worker base URL (e.g. wrangler dev)")
    rp.add_argument("--data", default=str(DATA_DIR))
    rp.add_argument("--out", help="reports dir (default reports/; fake: ~/.cache/audible/...)")
    rp.add_argument("--game", action="append", help="only this game_id (repeatable)")
    rp.add_argument("--no-samples", action="store_true", help="skip Play-Caller samples")
    rp.add_argument("--skip-existing", action="store_true",
                    help="keep reports already in --out that are valid and passed (resume)")
    rp.set_defaults(func=cmd_reports)

    ep = sub.add_parser("eval", help="run the 12 eval scenarios and print the scorecard")
    ep.add_argument("--provider", choices=PROVIDERS, help="override the stages' provider")
    ep.add_argument("--base-url", help="Ollama or cloud Worker base URL (e.g. wrangler dev)")
    ep.add_argument("--stage", choices=("live", "batch", "both"), default="both")
    ep.add_argument("--rate", action="store_true", help="ask for a defensible y/n rating")
    ep.add_argument("--out", help="results dir (default eval/results; fake: ~/.cache/audible/...)")
    ep.set_defaults(func=cmd_eval)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    return args.func(args)
