# «МИР ДЗЮДО» — статический сайт: сборка (node build.mjs) → nginx.
# Контекст сборки — sites/mir-judo/.
FROM node:22-alpine AS build
WORKDIR /site
COPY build.mjs ./
COPY src ./src
ARG ORDER_ENDPOINT=""
ARG BASE_URL=""
RUN ORDER_ENDPOINT="$ORDER_ENDPOINT" BASE_URL="$BASE_URL" node build.mjs

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/dist /usr/share/nginx/html
# Traefik не маршрутизирует на контейнер, пока он не healthy → частые проверки на старте (Docker ≥ 25)
HEALTHCHECK --interval=30s --start-period=10s --start-interval=2s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
