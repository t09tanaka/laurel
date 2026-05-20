FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK CMD wget -q -O /dev/null http://localhost/healthz
