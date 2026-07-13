#!/usr/bin/env python3

from datetime import datetime, timezone
from pathlib import Path
import os
import re
import sys

START = datetime(2001, 1, 1, tzinfo=timezone.utc)
END = datetime(2101, 1, 1, tzinfo=timezone.utc)
CANDLE_HEIGHT = 534
INNER_BORDER = 32
INNER_HEIGHT = CANDLE_HEIGHT - 2 * INNER_BORDER


def current_time() -> datetime:
    value = os.environ.get("INOCHI_AT")
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def update(path: Path, burned_height: float) -> None:
    source = path.read_text()
    rendered, replacements = re.subn(
        r'(<rect id="burned"[^>]* height=")[^"]+',
        rf'\g<1>{burned_height:.6f}',
        source,
        count=1,
    )
    if replacements != 1:
        raise SystemExit(f"could not locate the burned-zone rectangle in {path}")
    path.write_text(rendered)


now = current_time()
progress = min(1.0, max(0.0, (now - START) / (END - START)))
burned_height = INNER_HEIGHT * progress

for filename in sys.argv[1:]:
    update(Path(filename), burned_height)

