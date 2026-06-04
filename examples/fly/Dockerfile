# Fly.io runtime for a pre-built Laurel `dist/` directory.
# Enable [deploy.nginx] with root = "/usr/share/nginx/html", then run
# `bunx laurel build` before `flyctl deploy` so `dist/` and
# `dist/.laurel/nginx.conf` exist in the Docker build context.
FROM nginx:1.27-alpine

COPY dist/.laurel/nginx.conf /etc/nginx/conf.d/default.conf
# The generated config includes brotli_static for nginx builds that support it.
# The stock nginx:alpine image does not ship that module, so keep this sample
# portable by dropping only that directive. Use a Brotli-enabled nginx image and
# remove this line if you want .br sidecars served directly.
RUN sed -i '/brotli_static/d' /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
# Keep build metadata out of the public document root; the copied config above
# is the runtime source of truth.
RUN rm -rf /usr/share/nginx/html/.laurel
