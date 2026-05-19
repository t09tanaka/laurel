#!/usr/bin/env bash
# Usage: ./create-issues.sh <issues.json>
#
# Reads a JSON array of {title, body, labels[]} from $1 and creates one GitHub
# issue per entry. Resilient to partial failures: writes the created issue
# number back to issues.created.json so reruns skip done items.
set -euo pipefail

input="${1:?usage: $0 issues.json}"
created="${input%.json}.created.json"

if [[ ! -f "$created" ]]; then
  echo "[]" > "$created"
fi

total=$(jq '. | length' "$input")
done_count=$(jq '. | length' "$created")
echo "Creating issues from $input ($total entries; $done_count already done)"

idx=0
while IFS= read -r row; do
  idx=$((idx + 1))
  # Skip if already created
  already=$(jq -r --arg i "$idx" '.[] | select(.idx == ($i | tonumber)) | .number' "$created" 2>/dev/null || true)
  if [[ -n "$already" ]]; then
    continue
  fi

  title=$(jq -r '.title' <<<"$row")
  body=$(jq -r '.body' <<<"$row")
  labels=$(jq -r '.labels | join(",")' <<<"$row")

  printf "[%3d/%d] %s\n" "$idx" "$total" "$title"

  if number=$(gh issue create --title "$title" --body "$body" --label "$labels" 2>&1 | tail -1 | grep -oE '[0-9]+$'); then
    jq --arg i "$idx" --arg n "$number" --arg t "$title" \
      '. + [{idx: ($i | tonumber), number: ($n | tonumber), title: $t}]' \
      "$created" > "$created.tmp" && mv "$created.tmp" "$created"
  else
    echo "  ! failed; will retry on next run"
  fi

  # Throttle to avoid secondary rate limits (5000/hr; we stay well under)
  sleep 0.3
done < <(jq -c '.[]' "$input")

echo "Done."
