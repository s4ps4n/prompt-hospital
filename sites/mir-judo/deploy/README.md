# Деплой «МИР ДЗЮДО»

Traefik v3 (HTTPS через Let's Encrypt, HTTP-01) + nginx со статикой из `node build.mjs`.

1. DNS: A-записи `@` и `www` → IP сервера. Порты 80/443 открыты и не заняты.
2. На сервере:
   ```sh
   cd sites/mir-judo/deploy
   cp .env.example .env   # DOMAIN, ACME_EMAIL, ORDER_ENDPOINT
   docker compose up -d --build
   ```
3. Проверка: `curl -I https://$DOMAIN/` → 200; `http://` и `www.` → 301 на `https://$DOMAIN/`.

Обновление сайта: `git pull && docker compose up -d --build site`.

Домен в canonical, sitemap и robots подставляется при сборке из `DOMAIN` (`https://$DOMAIN`),
перекрывая `src/data/site.json → baseUrl`. После смены домена пересоберите образ.

**До запуска в прод задайте `ORDER_ENDPOINT`** (URL, принимающий заявку POST-запросом с JSON).
Если он пустой, сборка выведет предупреждение, а форма покажет «Заявка отправлена», хотя
никуда её не отправит.
