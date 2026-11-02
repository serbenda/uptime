#!/usr/bin/env python3
"""Checks the health of the sources after an update.

Exits with code 1 and prints a Markdown report if any provider has failed several runs
in a row; the Action uses it to open the "Data sources down" issue.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from update import FAILURES_BEFORE_ALERT, OUTPUT  # noqa: E402


def main():
    try:
        providers = json.loads((OUTPUT / "status.json").read_text("utf-8")).get("providers", [])
    except (OSError, ValueError) as e:
        print(f"Couldn't read `status.json`: {e}")
        return 1
    down = [p for p in providers if (p.get("source") or {}).get("failures_in_a_row", 0) >= FAILURES_BEFORE_ALERT]
    if not down:
        print("All sources are responding.")
        return 0
    print(f"These sources have failed at least {FAILURES_BEFORE_ALERT} updates in a row. "
          "The site shows them as *no data*.\n")
    print("| Provider | Error | Failures in a row | Last good data |")
    print("|---|---|---|---|")
    for p in down:
        s = p["source"]
        print(f"| {p['name']} | {s.get('error') or '-'} | {s.get('failures_in_a_row')} | {s.get('last_ok') or 'never'} |")
    run_url = os.environ.get("RUN_URL")
    if run_url:
        print(f"\nRun log: {run_url}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
