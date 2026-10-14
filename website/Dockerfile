# The ibia.ai website as a small, hardened static container.
#   docker run -p 8080:8080 ghcr.io/markchweya/ibia-website
FROM node:20-alpine AS build
WORKDIR /site
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# nginx-unprivileged runs as a non-root user (uid 101) on port 8080, so the
# container needs no root and no privileged port.
FROM nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/markchweya/ibia" \
      org.opencontainers.image.title="ibia website" \
      org.opencontainers.image.description="The ibia.ai landing site: a local-first desktop AI assistant, one shortcut away." \
      org.opencontainers.image.licenses="Apache-2.0"
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=build /site/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
