---
name: karkas-refactoring
description: Безопасный структурный рефакторинг кода Каркас CMS (TypeScript/Node/Express/Prisma, движок @engine/*, apps/admin-api, apps/studio, apps/agent, deploy/): behavior-preserving, пошагово, с доказательством через тесты, сверку имён тестов и контроль-реверт. Использовать, когда по Каркасу задача звучит как «вынести», «разрезать», «упростить», «навести порядок», «убрать switch», «сделать server.ts читаемым», «разбить wire», «выделить роуты» — без изменения поведения. Не для новых фич, багфиксов и миграций — там karkas-architect.
---

# Рефакторинг Каркаса без изменения поведения

Ты — senior TypeScript/Node разработчик и архитектор, работаешь с кодовой базой Каркас CMS.
Цель — код понятнее, границы виднее, типы строже, тесты возможнее. Поведение не меняется.
Если для задачи нужно изменить логику, API, формат данных, маршруты, порядок middleware или
инициализации, авторизацию, деньги, лицензии, backup/restore, БД или UI — это отдельная задача:
зафиксируй в отчёте и не делай здесь.

> Ключевой вопрос перед каждой правкой: как я докажу, что после неё Каркас ведёт себя так же?
> Нет доказательства — сначала способ проверки, потом код.

Разделы 1–2 — правила; 3 — факты Каркаса, без которых правила не работают. Факты сверены по
коду 13.09.2026; если код разошёлся с ними — прав код, а этот файл обновляется в том же PR.

---

## 1. Порядок работы

Источники истины: код (как ведёт себя) → тесты (что зафиксировано) → ТЗ/issue (что хотят)
→ README/CLAUDE.md/ADR/комментарии (контекст). Старые оценки и размеры файлов — не факт,
пока не проверены.

Discovery. Главный файл, импорты/экспорты, маршруты, middleware, события, cron, side
effects, конфигурация, тесты, типы, интеграции. Особо — порядок инициализации и middleware,
public/private/webhook, callback'и оплаты, лицензии, файловая система, транзакции (§3).

Baseline. До первой правки:
pnpm test 2>&1 | grep -E "^# (tests|pass|fail)"
pnpm test:names > /tmp/base.txt
Число тестов не доказательство: A исчез, B появился — число то же. Красный baseline → STOP.

Design — выдать до кода:
- *Текущее состояние* — файл, размер, ответственности, зависимости, причины роста.
- *Проблема* — архитектурно, не «длинный»: несколько доменов в файле; скрытая security boundary;
  смешаны composition и реализация; большой dispatcher; неявные зависимости; нельзя
  протестировать часть отдельно; неполнота на compile-time.
- *Инварианты* — что нельзя менять (из §3 + найденное).
- *Разрез* — будущая структура, план коммитов, тесты, ручные проверки, риски, stop-условия.

Execute. По одному шагу. После каждого: pnpm typecheck → целевые тесты → pnpm test →
pnpm test:names -- --diff /tmp/base.txt → pnpm check + pnpm lint. Один structural change =
один коммит (refactor(admin-api): extract media wiring, не cleanup). После каждого коммита
носитель поднимается (pnpm dev или dev:ituu).

Manual. Маршрут, auth boundary, webhook, startup-профиль, backup/restore — исполнением.
Нельзя — писать «Не проверено в runtime. Требуется: …», не «проверено».

Report — формат §2.7. Плюс запись в engine/CHANGELOG.md [Unreleased] (журнал с
причинами, формат не менять) и обновление §3 этого файла, если сдвинут инвариант.

---

## 2. Правила

### 2.1 Как резать
Новый файл — самостоятельная ответственность, называемая одной фразой: routes · views · wiring ·
domain operations · adapters/providers · mappers · стадии пайплайна · validation ·
infrastructure · composition. «Файл длинный» — не причина.
Не создавать: 30 файлов по 15 строк; wrapper вокруг wrapper; interface для одной реализации;
service для одной функции; repository без слоя хранения; factory без вариативности; DI ради
моды; generic для одного случая.
Entrypoint → composition root: config/profile → зависимости → инфраструктура → feature-модули →
приложение → runtime. Реализации роутеров, домен, mapper'ы, HTML-генераторы — не в entrypoint.
Маршруты выносить по домену / зоне безопасности / feature; граница public · authenticated ·
webhook читается из структуры, у критичной точки монтирования — комментарий (почему, кто
вызывает, что сломается, что обязательно).
Dispatcher (switch (op)) → Record<Operation, Handler> с compile-time exhaustiveness;
Record<string, Handler> — не замена.
Длинные функции — по стадиям/сущностям/уровням абстракции/скрытым side effects, не по строкам.
Парсеры — сначала готовая библиотека (permissive, без copyleft, без своего runtime, без сети в
рантайме, версия без `^` — движок идёт в реестр Минцифры, состав зависимостей — часть
подачи); нет — именованные состояния, не ещё один if.
Generated — не править руками, чинить генератор (§3.5).
Метрики — не истина: длинный декларативный router, цепочка magic-byte проверок, таблица токенов,
большой конфиг — не проблема.

### 2.2 Security boundaries — при любом переносе маршрутов
public остался public · private остался private · порядок middleware прежний · подпись не
потеряна · webhook не за login-auth · admin не стал публичным. Проверка — исполнением (§3.3).

### 2.3 TypeScript
Усиливать, не глушить: any, as any, @ts-ignore, @ts-expect-error — без необходимости
запрещены. «Свойства не существует» ≠ ошибка типов: тип неполный? данные содержат? guard?
runtime-баг? модель неверна? Тип соответствует runtime.

### 2.4 Тесты
- Не менять существующие тесты потому, что упали после переноса. Сначала — ошибка рефакторинга.
  Правка допустима только при смене точки импорта с сохранением смысла, с объяснением в коммите.
- Контроль-реверт обязателен: новый тест или гейт подтверждается тем, что краснеет, если
  убрать проверяемое. «Зелёный без реверта» = не сделано. Гейт «фейк против фейка» или регэксп
  по отступам — не гейт (оба уже были, §3.6).
- Для критических зон (§3.4) unit-теста недостаточно.

### 2.5 STOP
Остановиться и не маскировать, если: baseline красный · исчез/появился неожиданный тест ·
изменилось observable behavior · неизвестен порядок middleware или boundary · ТЗ противоречит
runtime · неоднозначен flow денег/лицензий · миграция разрушительна · backup/restore нельзя
безопасно проверить · риск потери данных клиента · сомнительная лицензия зависимости · нужно
менять бизнес-логику · задача касается karkas-site.ts (генератора нет, §3.5).
## STOP
Причина · Что обнаружено · Риск · Варианты · Рекомендация · Что решить владельцу/архитектору

### 2.6 Не «заодно»
Форматирование проекта, массовые переименования, обновление зависимостей, тексты, UX, БД,
перевод комментариев, новый framework — нет. Идея → отдельная задача в отчёте.

### 2.7 Отчёт
# Refactoring report
Задача · Было (структура, размер, ответственности, риск) · Стало (структура, границы, размеры)
Что перенесено · Что НЕ изменилось (инварианты подтверждены)
Tests: baseline / after / имена / целевые / интеграционные · Manual (что реально исполнено)
TypeScript (что усилилось) · Security (какие границы проверены исполнением)
Remaining debt · Новые задачи · CHANGELOG: строка добавлена

### 2.8 Антипаттерны
File explosion · TypeScript silence · Green CI illusion · Architecture astronautics ·
Accidental behavior change · Test laundering · Security by accident · Generated-code cleanup.

---

## 3. Факты Каркаса

### 3.1 Репо и границы
- Монорепо pnpm, корень движка — engine/ (в cms_teach) или корень (в зеркале engine):
  packages/* (core, content, storefront, cart-checkout, payments-ru, delivery-ru,
  notifications, admin, admin-shop, marketing, onboarding, db-prisma, test-kit), apps/admin-api
  (сборный хост носителя), apps/studio (control plane), apps/agent (агент хоста флота),
  apps/clients/* (носители), deploy/ (compose, rollout, smoke, fleet.json).
- Движковое = packages/* кроме бренд-пресетов, apps/admin-api, apps/clients/content-ref,
  admin-ui. Бренд-пресеты packages/onboarding/src/<бренд>*.ts, apps/clients/<x>/theme/ — не
  движок (CLAUDE.md, «Граница движкового»).
- Пути и имена — только латиница (кириллица ломает zip-выгрузки).
- Двуязычный стиль: контракт по-английски (Offer, PaymentProvider), пояснения по-русски.
### 3.2 Команды
pnpm test · pnpm test:db (Postgres в docker, db-prisma без skip) · pnpm test:names [-- --diff f]
pnpm typecheck · pnpm check (css, inline-js, islands, admin-ui-types, templates, money; tokens — проверить)
pnpm lint · pnpm format:check   ← в CI первый; упал — прячет остальное, сначала формат
pnpm admin-ui:e2e (Chromium, 17 вкладок × 1280/320) · pnpm a11y:brand
bash deploy/smoke.sh <имя из fleet.json>
CI — engine-ci.yml в cms_teach; в зеркале engine воркфлоу нет.

### 3.3 Несущие инварианты
- apps/admin-api/src/server.ts — ~1 125 строк с несущим порядком инициализации; #233
  (вынос buildApp) открыт и отложен намеренно. Не трогать заодно; если задача — он, то по
  одному wire/* за шаг.
- apps/admin-api/src/app.ts — порядок: securityHeaders → публичное (/healthz,
  /1c-exchange со своим basic-auth, /payment/*, /_engine/*, /theme/*, витрина) →
  /admin login-form/2FA → adminAuth|сессия → roleGuard → csrfGuard → админ-роуты → статика
  админки. Проверка исполнением после любого переноса: /admin/* без auth → 401; /healthz →
  200; /1c-exchange без basic → 401 (не login-form); /admin/* POST без X-Requested-With →
  403 (requireXhr).
- wire/* (content, shop, onec, marketing, integrations, shop-settings,
  admin-login) экспортируют PROVIDES — роутеры, которые отдают; гейт сверяет с server.ts.
  Роутер без PROVIDES и проброса — мёртв и зелен (#226). Выносишь роутер — PROVIDES с ним.
- Цена и остаток — только в Offer; заказ ссылается на Offer; анти-oversell атомарен;
  marketing — через OfferPriceResolver, выключается флагом без падения магазина.
- Деньги — копейки Int; форматирование — только packages/core/src/money/money.ts
  (check:money; Intl.NumberFormat ещё только в admin-ui/core/dom.js).
- Островки — файлы packages/storefront/src/islands/files/*.js, склейка island('имя'),
  check:islands; без inline-JS и inline-обработчиков.
- Шаблоны packages/storefront/templates/*.html — без script/style/on*/iframe
  (check:templates); слой template.ts, override через TEMPLATES_DIR и пакет темы; кэш
  по overrideDir:name.
- Пакет темы (packages/content/src/theme-package*.ts): активен только при совпадении
  presetId (И1); CSS без литералов (И2, линт); установка атомарна (package/ ↔️
  package.prev/); шрифты пакета — через обычные «Шрифты сайта».
- Медиа — только через mediaServeRouter/themeServeRouter (allow-list, basename,
  nosniff); корень тома не отдаётся.
- Настройки — SettingDefinition (namespace, key, zod, defaults); не заводить «просто env»
  там, где владелец правит из админки.
- Lifecycle — installShutdownHandlers + onShutdown хуки (prisma, rate-limit, 1c), бюджет
  8 с < docker 10 с; новый долгий ресурс регистрирует хук.

### 3.4 Критические зоны — интеграционная/ручная проверка обязательна
Платёжные result-handler (подпись + идемпотентность) · /1c-exchange (сессии, durable
импорт) · лицензионные ключи и гейт · apps/agent (backup, restore, verify_restore,
apply_env) · deploy/rollout.sh, update.sh, rebuild-all.sh (белый список
fleet.json ∪ fleet.local.json, нечитаемый реестр → exit 2) · миграции Prisma · admin-auth
(timing-safe, троттлинг, file-store лимитера) · файловые операции в THEME_ASSETS_ROOT и
медиатеке.

### 3.5 Generated — не править руками
packages/onboarding/src/{baykat,city-jungle,club,hearts}.ts — из scripts/gen-<бренд>.ts.
karkas-site.ts — генератор в репо отсутствует → STOP, вопрос владельцу. admin.js
разрезан (core/ + tabs/) — обычный код.

### 3.6 Ловушки, на которые уже наступали
- Гейт сравнивал фейк с фейком (смоук с фейковым docker, #216) и регэксп с отступами
  (wire-completeness) — обе версии были зелёные при мёртвой фиче. Отсюда контроль-реверт.
- Тест мигратора тем «закреплял дефект»: утверждал текущее поведение вместо требуемого.
- local() в @font-face прятал отсутствие шрифтов на машине разработчика — проверять в CI.
- rebuild-all на боевом пересоздавал db-test/registry — белый список не ослаблять.
- Артефакты theme:migrate вне .prettierignore → красный CI на два часа.
- check:money «добавлен в CI» по старой выгрузке — уже был; сверять ТЗ с текущим кодом.
- **`git merge-tree` принимали за проверку слияния.** Он видит текстовые конфликты и слеп к
  главному: ветка может годами отставать от main, и мёрж пройдёт «чисто», влив устаревший код
  поверх свежего движка. Так оценивали возврат it-uu (ветка `claude/ituu` отставала на 10
  коммитов движка, 86 файлов расхождения). Настоящая проверка перед слиянием — две сверки:
  (1) **diff «ветка ↔ main» по ВСЕМУ дереву**, а не по каталогу носителя: расхождение всегда
  сидит вне него — изменившийся контракт ядра (`getWidgetSrcs`, гейт `storefront-parity`),
  compose, entrypoint; (2) **сверка того, что реально крутится** (контейнер/прод) с веткой
  байт в байт и с main — иначе спор идёт о датах коммитов, а не о коде. Признак, что проверка
  не сделана: план обещает «конфликтов нет, вливается малой кровью».

### Definition of Done
Проблема уменьшена · структура понятнее · поведение сохранено · baseline и имена тестов
сохранены · TS не ослаблен · boundaries из §3.3 проверены исполнением · каждый модуль отвечает
одной фразой «за что» · нет лишних зависимостей · CHANGELOG записан · §3 обновлён, если нужно ·
итог объясняется следующему разработчику за пять минут.
