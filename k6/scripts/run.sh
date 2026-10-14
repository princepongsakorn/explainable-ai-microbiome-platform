#!/usr/bin/env bash
# Run one k6 script and keep its raw output under k6/results/<dir>/.
#
# usage: ENV_FILE=<path> bash k6/scripts/run.sh <e2e_prediction|inference_direct> <results-dir-name>
#
# ENV_FILE holds BASE_URL, K6_USERNAME, K6_PASSWORD (and INFERENCE_URL for the
# direct test). Keep it outside the repository; nothing from it is written to
# the results.
set -euo pipefail

script="$1"
results_name="$2"
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../results/$results_name"
mkdir -p "$out"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE:?set ENV_FILE to the credentials file}"
set +a

stamp="$(TZ=Asia/Bangkok date +%Y%m%dT%H%M%S%z)"
cd "$here"
# caffeinate keeps the Mac awake; a sleep mid-run stalls k6 and the clocks.
caffeinate -dimsu k6 run --quiet \
  --summary-export "$out/${script}-${stamp}.summary.json" \
  "${script}.js" 2>&1 | tee "$out/${script}-${stamp}.stdout.log"

# --summary-export includes setup()'s return value, which holds the JWT.
python3 - "$out/${script}-${stamp}.summary.json" <<'PY'
import json, sys
path = sys.argv[1]
summary = json.load(open(path))
if summary.get("setup_data"):
    summary["setup_data"] = {key: "<redacted>" for key in summary["setup_data"]}
json.dump(summary, open(path, "w"), indent=4)
PY
