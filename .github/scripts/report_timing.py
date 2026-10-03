"""Summarize a `python -m audible_ai reports` log as Markdown (for $GITHUB_STEP_SUMMARY).

Reads the CLI's timestamped log lines ("<date> <time>,ms LEVEL message"):
`wrote <path> (passed|failed)` and `kept <path> (already passed)`. A report's time is the gap
since the previous report event (or the first log line), so it includes fact-sheet building, the
model call and any retry.
Usage: python3 .github/scripts/report_timing.py reports.log
"""

import re
import sys
from datetime import datetime

LINE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),\d+ \w+ (.*)$")
WROTE = re.compile(r"^wrote (\S+) \((\w+)\)")
KEPT = re.compile(r"^kept (\S+)")
WEEK = re.compile(r"season (\d+) week (\d+)")


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "reports.log"
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except FileNotFoundError:
        print("_No reports log (the job stopped before generating reports)._")
        return 0
    start = last = None
    wrote: list[tuple[str, str, float]] = []
    kept = 0
    week = None
    for raw in lines:
        m = LINE.match(raw)
        if not m:
            continue
        ts = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
        msg = m.group(2)
        start = start or ts
        last = last or ts
        if w := WEEK.search(msg):
            week = f"{w.group(1)} week {w.group(2)}"
        if w := WROTE.match(msg):
            wrote.append((w.group(1), w.group(2), (ts - last).total_seconds()))
            last = ts
        elif KEPT.match(msg):
            kept += 1
            last = ts
    reports = [r for r in wrote if not r[0].startswith("samples/")]
    passed = sum(1 for r in reports if r[1] == "passed")
    secs = [r[2] for r in reports]
    total = (last - start).total_seconds() if start and last else 0
    print(f"### Game-plan reports{f' — {week}' if week else ''}\n")
    print("| Written | Passed | Failed | Kept (already passed) | Avg s / report | Max s "
          "| Wall time |")
    print("|---|---|---|---|---|---|---|")
    avg = f"{sum(secs) / len(secs):.0f}" if secs else "—"
    mx = f"{max(secs):.0f}" if secs else "—"
    failed = len(reports) - passed
    wall = f"{total / 60:.1f} min"
    print(f"| {len(reports)} | {passed} | {failed} | {kept} | {avg} | {mx} | {wall} |")
    if reports:
        print("\n<details><summary>Per report</summary>\n")
        print("| Report | Status | Seconds |\n|---|---|---|")
        for name, status, s in reports:
            print(f"| `{name}` | {status} | {s:.0f} |")
        print("\n</details>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
