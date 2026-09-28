# v1.0.0 — first release

Prompt Hospital — a Theme Hospital–style office visualization of an AI team. A working orchestrator control panel: see who's doing what, drag tasks onto models, and the models actually run.

## What's inside

- **Isometric office** — rooms, chibi characters, statuses, idle animations (walk / coffee / sleep).
- **Journal** — single source of truth (`journal.json`), models + tasks + history.
- **API + dispatcher** — `server.py` serves the journal, `dispatch.py` actually runs models.
- **Integration levels A→D** — journal → monitor → write → execute.
- **Interaction** — drag-and-drop tasks, model card, catalog, Hermes tray, priorities.
- **i18n** — RU/EN, `translations.csv` as the human-editable source + generator.
- **Docs** — README (EN/RU), INSTALL (EN/RU), ROADMAP.

## Stack

Vite · React · TypeScript · SVG · Python (journal / API / dispatcher) · Docker · Traefik

## Try it

https://prompthospital.site

## Deploy

See `INSTALL.md` — three levels: from `npm run dev` to docker + Traefik + HTTPS.
