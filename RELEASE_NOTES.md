# v1.0.0 — первый релиз

**RU.** Prompt Hospital — визуализация ИИ-команды в стиле Theme Hospital. Рабочий пульт оркестратора: смотришь, кто чем занят, перетаскиваешь задачи на модели — и модели реально запускаются.

**EN.** Prompt Hospital — a Theme Hospital–style office visualization of an AI team. A working orchestrator control panel: see who's doing what, drag tasks onto models, and the models actually run.

## Что внутри · What's inside

- **Изометрический офис / Isometric office** — комнаты, чиби-персонажи, статусы, idle-анимации (гуляет / кофе / сон).
- **Журнал / Journal** — единый источник истины (`journal.json`): модели, задачи, история.
- **API + диспетчер / API + dispatcher** — `server.py` отдаёт журнал, `dispatch.py` реально запускает модели.
- **Уровни интеграции A→D / Integration levels A→D** — журнал → монитор → запись → исполнение.
- **Интерактив / Interaction** — drag-and-drop задач, карточка модели, каталог, лоток Гермеса, приоритеты.
- **i18n** — RU/EN, `translations.csv` как редактируемый людьми источник + генератор.
- **Доки / Docs** — README (EN/RU), INSTALL (EN/RU), ROADMAP.

## Стек · Stack

Vite · React · TypeScript · SVG · Python (журнал / API / диспетчер) · Docker · Traefik

## Попробовать · Try it

https://prompthospital.site

## Развёртывание · Deploy

См. `INSTALL.md` — три уровня: от `npm run dev` до docker + Traefik + HTTPS.
