// Сгенерировано scripts/i18n.mjs из translations.csv — не править руками: правьте CSV и запустите `npm run i18n`.

export const LANGS = ['ru', 'en'] as const
export type Lang = (typeof LANGS)[number]

export type TKey =
  | 'lang.switchTo'
  | 'top.title'
  | 'top.addModel'
  | 'top.zoomOut'
  | 'top.zoomIn'
  | 'top.zoomFit'
  | 'top.zoomTitle'
  | 'top.journal'
  | 'top.reset'
  | 'counter.tasks'
  | 'counter.run'
  | 'counter.run.title'
  | 'counter.blocked'
  | 'counter.blocked.title'
  | 'counter.wait'
  | 'counter.wait.title'
  | 'status.run'
  | 'status.wait'
  | 'status.blocked'
  | 'status.done'
  | 'role.coordinator'
  | 'role.executor'
  | 'role.architect'
  | 'role.fullstack'
  | 'role.sysadmin'
  | 'role.designer'
  | 'role.uxui'
  | 'role.acceptor'
  | 'role.reviewer'
  | 'priority.3'
  | 'priority.2'
  | 'priority.1'
  | 'priority.up'
  | 'priority.down'
  | 'tasks.one'
  | 'tasks.few'
  | 'tasks.many'
  | 'tasks.other'
  | 'task.onlyKind'
  | 'task.anyRole'
  | 'tray.title'
  | 'tray.hint'
  | 'tray.empty'
  | 'tray.newTitle'
  | 'tray.newPlaceholder'
  | 'tray.priority'
  | 'tray.kind'
  | 'tray.add'
  | 'card.label'
  | 'card.close'
  | 'card.role'
  | 'card.coordLocked'
  | 'card.roleLocked'
  | 'card.coordInfo'
  | 'card.current'
  | 'card.complete'
  | 'card.block'
  | 'card.unblock'
  | 'card.toTray'
  | 'card.free'
  | 'card.queue'
  | 'card.returnToTray'
  | 'card.done'
  | 'card.clone'
  | 'card.remove'
  | 'catalog.title'
  | 'catalog.hint'
  | 'catalog.models'
  | 'catalog.role'
  | 'catalog.cancel'
  | 'catalog.confirm'
  | 'journal.title'
  | 'modal.close'
  | 'scene.freeRoom'
  | 'sign.noTask'
  | 'sign.inTray'
  | 'msg.hint'
  | 'msg.miss'
  | 'msg.resetRemote'
  | 'msg.resetConfirm'
  | 'msg.resetDone'
  | 'status.label'
  | 'source.label'
  | 'source.demo'
  | 'source.off'
  | 'source.connecting'
  | 'source.down'
  | 'source.live'
  | 'source.stale'

export const translations: Record<Lang, Record<TKey, string>> = {
  'ru': {
    'lang.switchTo': 'Переключить на русский',
    'top.title': 'Prompt Hospital',
    'top.addModel': '＋ Модель',
    'top.zoomOut': 'Уменьшить',
    'top.zoomIn': 'Увеличить',
    'top.zoomFit': 'Вписать',
    'top.zoomTitle': 'Масштаб {pct}%',
    'top.journal': 'Журнал',
    'top.reset': 'Сброс',
    'counter.tasks': 'Задачи:',
    'counter.run': 'в работе',
    'counter.run.title': 'Задачи у исполнителей — текущие задачи моделей',
    'counter.blocked': 'заблокировано',
    'counter.blocked.title': 'Задачи, снятые с ротации или заблокированные моделью',
    'counter.wait': 'ожидают',
    'counter.wait.title': 'Задачи в лотке Гермеса и в очередях моделей',
    'status.run': 'в работе',
    'status.wait': 'ожидает',
    'status.blocked': 'заблокирован',
    'status.done': 'выполнено',
    'role.coordinator': 'координатор',
    'role.executor': 'исполнитель',
    'role.architect': 'архитектор',
    'role.fullstack': 'фулстак',
    'role.sysadmin': 'сисадмин',
    'role.designer': 'дизайнер',
    'role.uxui': 'UX/UI',
    'role.acceptor': 'приёмщик',
    'role.reviewer': 'рецензент',
    'priority.3': 'высокий',
    'priority.2': 'средний',
    'priority.1': 'низкий',
    'priority.up': 'Повысить приоритет',
    'priority.down': 'Понизить приоритет',
    'tasks.one': '{n} задача',
    'tasks.few': '{n} задачи',
    'tasks.many': '{n} задач',
    'tasks.other': '{n} задачи',
    'task.onlyKind': 'только {kind}',
    'task.anyRole': 'любая роль',
    'tray.title': 'Лоток Гермеса',
    'tray.hint': 'Тащите конверт на комнату модели. Бросите на другой конверт в лотке — встанет перед ним и возьмёт его приоритет.',
    'tray.empty': 'Лоток пуст',
    'tray.newTitle': 'Название задачи',
    'tray.newPlaceholder': 'Новая задача…',
    'tray.priority': 'Приоритет',
    'tray.kind': 'Роль задачи',
    'tray.add': '＋ В лоток',
    'card.label': 'Карточка модели',
    'card.close': 'Закрыть карточку',
    'card.role': 'Роль',
    'card.coordLocked': 'Роль координатора закреплена.',
    'card.roleLocked': 'Нельзя сменить роль, пока модель в работе. Сначала заверши или сними задачу.',
    'card.coordInfo': 'Координатор раздаёт задачи. В лотке {tasks}. Возьмите конверт со стола или из лотка слева и бросьте на комнату модели.',
    'card.current': 'Текущая задача',
    'card.complete': '✓ Завершить',
    'card.block': '⛔ Блок',
    'card.unblock': 'Снять блок',
    'card.toTray': '↩ В лоток',
    'card.free': 'Свободен — перетащите сюда конверт',
    'card.queue': 'Очередь модели',
    'card.returnToTray': 'Вернуть в лоток',
    'card.done': 'Выполнено: {n}',
    'card.clone': '＋ Экземпляр с другой ролью',
    'card.remove': 'Убрать из офиса',
    'catalog.title': 'Каталог моделей',
    'catalog.hint': 'Выберите модель и роль — в офисе появится новая комната. Одна модель может занимать несколько комнат с разными ролями.',
    'catalog.models': 'Модели',
    'catalog.role': 'Роль:',
    'catalog.cancel': 'Отмена',
    'catalog.confirm': 'Добавить в офис',
    'journal.title': 'Журнал оркестратора',
    'modal.close': 'Закрыть',
    'scene.freeRoom': '＋ свободная комната',
    'sign.noTask': 'Нет текущей задачи',
    'sign.inTray': 'в лотке: {n}',
    'msg.hint': 'Перетащите конверт из лотка на комнату модели · клик по комнате — карточка',
    'msg.miss': 'Мимо — задача осталась на месте',
    'msg.resetRemote': 'Сброс — только для локального офиса, не для журнала оркестратора',
    'msg.resetConfirm': 'Сбросить офис к стартовому составу?',
    'msg.resetDone': 'Офис сброшен к стартовому составу',
    'status.label': 'Строка состояния',
    'source.label': 'Источник данных офиса',
    'source.demo': 'ДЕМО-ДАННЫЕ',
    'source.off': 'связь с оркестратором не настроена (VITE_JOURNAL_URL не задан при сборке). Это макет, а не реальный журнал.',
    'source.connecting': 'подключение к оркестратору {url}… Пока показан макет, а не реальный журнал.',
    'source.down': 'оркестратор недоступен ({url}). Это макет, а не реальный журнал.',
    'source.live': 'Журнал оркестратора',
    'source.stale': 'Связь с оркестратором потеряна ({url}). Показан последний полученный журнал, данные могут быть устаревшими.',
  },
  'en': {
    'lang.switchTo': 'Switch to English',
    'top.title': 'Prompt Hospital',
    'top.addModel': '＋ Model',
    'top.zoomOut': 'Zoom out',
    'top.zoomIn': 'Zoom in',
    'top.zoomFit': 'Fit',
    'top.zoomTitle': 'Zoom {pct}%',
    'top.journal': 'Journal',
    'top.reset': 'Reset',
    'counter.tasks': 'Tasks:',
    'counter.run': 'in progress',
    'counter.run.title': 'Tasks being worked on — models\' current tasks',
    'counter.blocked': 'blocked',
    'counter.blocked.title': 'Tasks taken out of rotation or blocked by their model',
    'counter.wait': 'waiting',
    'counter.wait.title': 'Tasks in Hermes\' tray and in models\' queues',
    'status.run': 'running',
    'status.wait': 'waiting',
    'status.blocked': 'blocked',
    'status.done': 'done',
    'role.coordinator': 'coordinator',
    'role.executor': 'executor',
    'role.architect': 'architect',
    'role.fullstack': 'full-stack',
    'role.sysadmin': 'sysadmin',
    'role.designer': 'designer',
    'role.uxui': 'UX/UI',
    'role.acceptor': 'QA acceptor',
    'role.reviewer': 'reviewer',
    'priority.3': 'high',
    'priority.2': 'medium',
    'priority.1': 'low',
    'priority.up': 'Raise priority',
    'priority.down': 'Lower priority',
    'tasks.one': '{n} task',
    'tasks.few': '{n} tasks',
    'tasks.many': '{n} tasks',
    'tasks.other': '{n} tasks',
    'task.onlyKind': '{kind} only',
    'task.anyRole': 'any role',
    'tray.title': 'Hermes\' tray',
    'tray.hint': 'Drag an envelope onto a model\'s room. Drop it on another envelope in the tray to put it in front and take its priority.',
    'tray.empty': 'Tray is empty',
    'tray.newTitle': 'Task title',
    'tray.newPlaceholder': 'New task…',
    'tray.priority': 'Priority',
    'tray.kind': 'Task role',
    'tray.add': '＋ To tray',
    'card.label': 'Model card',
    'card.close': 'Close card',
    'card.role': 'Role',
    'card.coordLocked': 'The coordinator role is fixed.',
    'card.roleLocked': 'Can\'t change the role while the model is working. Complete or unassign the task first.',
    'card.coordInfo': 'The coordinator hands out tasks. {tasks} in the tray. Grab an envelope from the desk or the tray on the left and drop it on a model\'s room.',
    'card.current': 'Current task',
    'card.complete': '✓ Complete',
    'card.block': '⛔ Block',
    'card.unblock': 'Unblock',
    'card.toTray': '↩ To tray',
    'card.free': 'Idle — drag an envelope here',
    'card.queue': 'Model queue',
    'card.returnToTray': 'Return to tray',
    'card.done': 'Done: {n}',
    'card.clone': '＋ Instance with another role',
    'card.remove': 'Remove from office',
    'catalog.title': 'Model catalog',
    'catalog.hint': 'Pick a model and a role — a new room will appear in the office. One model can occupy several rooms with different roles.',
    'catalog.models': 'Models',
    'catalog.role': 'Role:',
    'catalog.cancel': 'Cancel',
    'catalog.confirm': 'Add to office',
    'journal.title': 'Orchestrator journal',
    'modal.close': 'Close',
    'scene.freeRoom': '＋ free room',
    'sign.noTask': 'No current task',
    'sign.inTray': 'in tray: {n}',
    'msg.hint': 'Drag an envelope from the tray onto a model\'s room · click a room for its card',
    'msg.miss': 'Missed — the task stayed in place',
    'msg.resetRemote': 'Reset is for the local office only, not for the orchestrator\'s journal',
    'msg.resetConfirm': 'Reset the office to the starting lineup?',
    'msg.resetDone': 'Office reset to the starting lineup',
    'status.label': 'Status bar',
    'source.label': 'Office data source',
    'source.demo': 'DEMO DATA',
    'source.off': 'orchestrator link is not configured (VITE_JOURNAL_URL was not set at build time). This is a mock-up, not the real journal.',
    'source.connecting': 'connecting to the orchestrator {url}… Showing a mock-up, not the real journal.',
    'source.down': 'orchestrator is unreachable ({url}). This is a mock-up, not the real journal.',
    'source.live': 'Orchestrator journal',
    'source.stale': 'Lost connection to the orchestrator ({url}). Showing the last received journal; data may be out of date.',
  },
}
