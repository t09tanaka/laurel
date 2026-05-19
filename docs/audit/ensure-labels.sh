#!/usr/bin/env bash
# Ensure every label referenced in docs/audit/all.json exists.
set -euo pipefail

# Color map: pick a stable colour per label by hashing the name.
hash_color() {
  local name="$1"
  local hex
  hex=$(printf '%s' "$name" | shasum -a 256 | cut -c1-6)
  echo "$hex"
}

# Description: brief.
get_desc() {
  case "$1" in
    P0) echo "Critical — release blocker";;
    P1) echo "High priority — near term";;
    P2) echo "Medium priority";;
    P3) echo "Low priority — backlog";;
    *) echo "Audit-derived";;
  esac
}

labels=()
while IFS= read -r line; do labels+=("$line"); done < <(jq -r '[.[] | .labels[]] | unique[]' docs/audit/all.json)

for name in "${labels[@]}"; do
  if [[ -z "$name" ]]; then continue; fi
  color=$(hash_color "$name")
  desc=$(get_desc "$name")
  if ! gh label list --search "$name" --json name -L 100 2>/dev/null | jq -e --arg n "$name" 'any(.[]; .name == $n)' >/dev/null 2>&1; then
    gh label create "$name" --color "$color" --description "$desc" >/dev/null 2>&1 \
      && echo "  created: $name (#$color)" \
      || echo "  ! failed to create $name"
  fi
done
echo "Done."
