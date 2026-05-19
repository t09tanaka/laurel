#!/usr/bin/env bash
# Load every entry in docs/audit/all.json into the local project-backlog.
# Idempotent: writes loaded indices to docs/audit/backlog-loaded.txt; reruns skip.
set -euo pipefail

SKILL_DIR="/Users/tanakatakuto/.claude/skills/project-backlog"
INPUT="docs/audit/all.json"
STATE="docs/audit/backlog-loaded.txt"

touch "$STATE"

total=$(jq '. | length' "$INPUT")
done_count=$(wc -l < "$STATE" | tr -d ' ')
echo "Loading $total entries into project-backlog ($done_count already done)"

idx=-1
while IFS= read -r row; do
  idx=$((idx + 1))
  if grep -qx "$idx" "$STATE"; then continue; fi

  title=$(jq -r '.title' <<<"$row")
  body=$(jq -r '.body' <<<"$row")
  labels=$(jq -r '.labels | join(", ")' <<<"$row")
  desc=$(printf "**Labels:** %s\n\n%s" "$labels" "$body")

  if python3 "$SKILL_DIR/scripts/cli.py" add --title "$title" --desc "$desc" >/dev/null; then
    printf "%s\n" "$idx" >> "$STATE"
    n=$(($(wc -l < "$STATE" | tr -d ' ')))
    if (( n % 100 == 0 )); then printf "  ✓ %d/%d\n" "$n" "$total"; fi
  else
    echo "  ! failed at idx=$idx; will retry on next run" >&2
  fi
done < <(jq -c '.[]' "$INPUT")

echo "Done. $(wc -l < "$STATE" | tr -d ' ')/$total loaded."
