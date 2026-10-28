#!/bin/sh
# Runs the backend tests with the race detector and fails if total statement
# coverage is below MIN_COVERAGE (percent, default 80).
set -eu
min="${MIN_COVERAGE:-80}"
profile="$(mktemp)"
trap 'rm -f "$profile"' EXIT

go test -race -coverprofile="$profile" ./...
total="$(go tool cover -func="$profile" | awk '/^total:/ { sub("%", "", $3); print $3 }')"
echo "backend coverage: ${total}% (minimum ${min}%)"
awk -v t="$total" -v m="$min" 'BEGIN { exit !(t + 0 >= m + 0) }' || {
  echo "backend coverage ${total}% is below the ${min}% minimum" >&2
  exit 1
}
