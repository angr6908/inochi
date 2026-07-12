#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

INOCHI_AT=${INOCHI_AT:-$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat())')}
export INOCHI_AT

"$script_dir/generate-inochi-candle.sh"
"$script_dir/generate-inochi-media.sh"

