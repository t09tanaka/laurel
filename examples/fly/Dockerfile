# Fly.io static-only runtime for a pre-built Nectar `dist/` directory.
# Run `bunx nectar build` before `flyctl deploy` so `dist/` exists in the
# Docker build context.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
