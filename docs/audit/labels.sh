#!/usr/bin/env bash
set -euo pipefail

declare -a labels=(
  "security|#b60205|Security risk, vulnerability, or hardening gap"
  "ghost-compat|#5319e7|Ghost theme/feature parity gap"
  "release-blocker|#000000|Must fix before 1.0"
  "P0|#b60205|Critical — release blocker"
  "P1|#d93f0b|High priority — near term"
  "P2|#fbca04|Medium priority"
  "P3|#cccccc|Low priority — backlog"
  "performance|#ff9800|Speed / memory / scale"
  "dx|#1d76db|Developer experience"
  "cli|#0e8a16|CLI ergonomics"
  "infra|#5319e7|CI / release / packaging"
  "a11y|#bfdadc|Accessibility"
  "seo|#bfd4f2|Search engine optimisation"
  "i18n|#fef2c0|Internationalisation"
  "theme-dev|#c5def5|Theme developer experience"
  "image-pipeline|#fad8c7|Image processing"
  "members|#5319e7|Members / subscriptions (Ghost feature)"
  "comments|#fbca04|Comments integration"
  "search|#0075ca|Search integration"
  "migration|#006b75|Ghost import / migration tooling"
  "testing|#0e8a16|Test coverage / quality"
  "rss|#bfdadc|RSS / feeds"
  "sitemap|#bfdadc|Sitemap"
  "routes|#bfd4f2|Routing / URL handling"
  "render|#c5def5|Rendering engine"
  "content|#fef2c0|Content loading / parsing"
  "config|#d4c5f9|Config schema / loader"
  "supply-chain|#b60205|Dependency / supply chain"
  "observability|#1d76db|Logging / errors / monitoring"
  "api|#0e8a16|Plugin / extension API"
  "docs|#0075ca|Documentation"
  "good first issue|#7057ff|Good entry-point task"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name color desc <<< "$entry"
  gh label create "$name" --color "${color#'#'}" --description "$desc" 2>/dev/null || \
    gh label edit "$name" --color "${color#'#'}" --description "$desc" >/dev/null
done
echo "Labels ready"
