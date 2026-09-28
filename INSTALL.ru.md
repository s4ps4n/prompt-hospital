# Как развернуть Prompt Hospital — по шагам

Три уровня, от простого к полному. Начни с первого — офис заработает за минуту, дальше по мере надобности.

---

## Уровень 0. Просто посмотреть офис (без всякого сервера)

Нужно только **Node.js 18+** на машине.

```bash
git clone https://github.com/s4ps4n/prompt-hospital.git
cd prompt-hospital
npm install
npm run dev
```

Открой **http://localhost:5173** — увидишь офис с тестовыми задачами.

Что происходит: без настройки офис работает **автономно** — задачи и модели лежат в `localStorage` браузера. Никакого сервера, журнала и диспетчера не нужно. Это уровень «посмотреть интерфейс».

---

## Уровень 1. Полный стек локально (офис + живой журнал + запуск моделей)

Теперь офис будет читать и писать в **реальный журнал**, а не в браузер. Без docker — просто два процесса.

### Шаг 1. Заведи оркестратор (журнал + API)

Оркестратор уже в репозитории — каталог `orchestrator/` рядом с фронтом. Нужен только стартовый журнал:

```bash
cd orchestrator
cp journal.example.json journal.json
```

Запусти API:

```bash
python3 server.py 8090
```

Проверь: открой **http://localhost:8090/journal** — увидишь свой журнал в JSON.

### Шаг 2. Собери офис так, чтобы он ходил в этот журнал

Вернись в каталог фронта и собери с указанием адреса журнала:

```bash
cd ~/prompt-hospital
VITE_JOURNAL_URL=http://localhost:8090/journal npm run build
npx serve dist          # или любой статик-сервер
```

Открой адрес, который даст `serve` (обычно **http://localhost:3000**).

Теперь офис показывает твой журнал: перетащи задачу на модель — она запишется в `journal.json`, и после перезагрузки останется там.

### Шаг 3. Диспетчер (чтобы модели реально работали)

```bash
cd orchestrator
ORCHESTRATOR_API=http://localhost:8090 \
python3 dispatch.py --loop 30
```

Диспетчер каждые 30 секунд смотрит журнал: если на модели с полем `model: "codex"` висит задача — реально запускает `codex exec` и по результату закрывает задачу. (Для других моделей допиши свой запуск в `dispatch.py`.)

---

## Уровень 2. Прод: docker + nginx + домен + HTTPS

То, как это развёрнуто у нас на `https://prompthospital.site`. Требует docker и настроенный Traefik (как для любого домена).

### 1. API в docker-сети

```bash
docker run -d --name orchestrator-api --network deploy_default \
  -v /root/orchestrator:/app -w /app --restart unless-stopped \
  python:3.11-alpine python server.py 8090
```

### 2. Фронт — nginx со статикой и Basic Auth

`nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  auth_basic "Prompt Hospital";
  auth_basic_user_file /etc/nginx/.htpasswd;
  location /journal { proxy_pass http://orchestrator-api:8090; }
  location /op      { proxy_pass http://orchestrator-api:8090; }
  location /        { try_files $uri /index.html; }
}
```

Собери статику с `VITE_JOURNAL_URL=/journal`, создай `.htpasswd` (`openssl passwd -apr1`), и запусти:

```bash
docker run -d --name prompt-hospital --network deploy_default \
  -v /root/prompt-hospital/site:/usr/share/nginx/html:ro \
  -v /root/prompt-hospital/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  -v /root/prompt-hospital/.htpasswd:/etc/nginx/.htpasswd:ro \
  --restart unless-stopped \
  --label traefik.enable=true \
  --label "traefik.http.routers.prompthospital.rule=Host(\`prompthospital.site\`)" \
  --label traefik.http.routers.prompthospital.entrypoints=websecure \
  --label traefik.http.routers.prompthospital.tls.certresolver=le \
  --label traefik.http.services.prompthospital.loadbalancer.server.port=80 \
  nginx:alpine
```

### 3. DNS

У регистратора домена: `A-запись prompthospital.site → IP сервера`. Сертификат Traefik выпустит сам (Let's Encrypt).

---

## Как проверить, что всё связано

1. `GET /journal` возвращает твой журнал (модели + задачи).
2. Перетащил задачу на модель в офисе → она появилась в `journal.json`.
3. Перезагрузил офис → назначение осталось (значит пишется в журнал, не в браузер).
4. Диспетчер подхватил задачу с `model: "codex"` → реально запустил Codex → закрыл задачу.

## Где что лежит

| Что | Где |
|---|---|
| Фронтенд (офис) | `prompt-hospital/` |
| Журнал (источник истины) | `orchestrator/journal.json` |
| CLI операций | `orchestrator/journal.py` |
| HTTP API | `orchestrator/server.py` |
| Диспетчер | `orchestrator/dispatch.py` |
