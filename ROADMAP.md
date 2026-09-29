# Roadmap

> English · [Русский](ROADMAP.ru.md)

Current state based on actual codebase.

## Done
- **Office and cubicles** — isometric scene, models in rooms, Hermes tray, journal, idle-idlers (sleeping / drinking coffee / walking).
- **Custom orchestrator** — journal (`journal.json`) + HTTP API (`server.py`) + dispatcher (`dispatch.py`), which actually runs the models. Levels A→D: journal → monitor → write → execution.

## Planned
- **Statistics** — who worked how much, by model (completed tasks, time in progress).
- **Overseer** — a hand that slaps idlers so they run to Hermes for a task (a joke from discussions).

## Out of Scope
- **WebSocket** — the office and dispatcher update via polling; this is sufficient for the current scale; real-time push is not required.
