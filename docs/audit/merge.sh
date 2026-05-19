#!/usr/bin/env bash
# Merge all audit JSON files into one deduplicated array sorted with P0 first.
set -euo pipefail

self="docs/audit/self-audit.json"
inputs=(
  "$self"
  "/tmp/nectar-audit-ghost.json"
  "/tmp/nectar-audit-html.json"
  "/tmp/nectar-audit-security.json"
  "/tmp/nectar-audit-prod.json"
)

existing=()
for f in "${inputs[@]}"; do
  if [[ -f "$f" ]]; then
    existing+=("$f")
    echo "  + $f ($(jq '. | length' "$f") entries)"
  else
    echo "  ! missing: $f"
  fi
done

jq -s 'add | unique_by(.title)
  | sort_by(
      if (.labels | index("P0")) then 0
      elif (.labels | index("P1")) then 1
      elif (.labels | index("P2")) then 2
      else 3 end
    )' "${existing[@]}" > docs/audit/all.json

echo "Merged → docs/audit/all.json ($(jq '. | length' docs/audit/all.json) unique titles)"
