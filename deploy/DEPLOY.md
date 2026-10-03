# Deployment Guide — Docker + Traefik + HTTPS

## Prerequisites

| Tool            | Version  |
| --------------- | -------- |
| Docker Engine   | ≥ 24     |
| Docker Compose  | ≥ 2.20   |
| Domain with DNS | A-record |

## 1. DNS

Point your domain to the server IP:

```
A   prompt.hospital       → <SERVER_IP>
A   www.prompt.hospital   → <SERVER_IP>
A   traefik.prompt.hospital → <SERVER_IP>   # optional, for dashboard
```

## 2. Configure environment

```bash
cp .env.example .env
nano .env          # set DOMAIN and ACME_EMAIL
```

## 3. Deploy

```bash
docker compose up -d --build
```

Traefik will automatically obtain a Let's Encrypt TLS certificate on the
first request. It typically takes 10–30 seconds.

## 4. Verify

```bash
curl -I https://prompt.hospital
# HTTP/2 200
# strict-transport-security: max-age=31536000; includeSubDomains; preload
```

## 5. Updates

```bash
git pull
docker compose up -d --build
```

Zero-downtime: Traefik drains the old container after the new one is
healthy (healthcheck in Dockerfile).

## 6. Logs

```bash
docker compose logs -f traefik   # reverse-proxy / TLS
docker compose logs -f app       # nginx access logs
```

## 7. Traefik Dashboard (optional)

Generate a password hash:

```bash
sudo apt install apache2-utils
htpasswd -nB admin
```

Paste the output into `.env` as `TRAEFIK_DASHBOARD_AUTH` (escape `$` → `$$`).

Open `https://traefik.prompt.hospital`.

## Architecture

```
  Internet
     │
     ▼
┌──────────┐  :80 redirect   ┌──────────────┐
│  Traefik │ ──────────────▶ │  :443 (TLS)  │
│  :80/443 │                 │  letsencrypt  │
└────┬─────┘                 └──────┬───────┘
     │ proxy pass                   │
     ▼                              ▼
┌──────────┐               ┌──────────────┐
│  app     │               │  app         │
│  nginx   │               │  nginx       │
│  :80     │               │  :80         │
└──────────┘               └──────────────┘
```
