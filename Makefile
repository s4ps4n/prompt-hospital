# ── Shortcuts ──────────────────────────────────────────────────
.PHONY: up down build logs restart status ssl-check

up:
	docker compose up -d --build

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f

restart:
	docker compose restart

status:
	docker compose ps

ssl-check:
	@echo "Checking TLS certificate…"
	@openssl s_client -connect $$(grep DOMAIN .env | cut -d= -f2):443 -servername $$(grep DOMAIN .env | cut -d= -f2) </dev/null 2>/dev/null | openssl x509 -noout -dates
