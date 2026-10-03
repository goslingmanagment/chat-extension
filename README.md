# chat-extension

Браузерное расширение ChatGoose для чаттеров: AI-ответы, правка черновика,
приветствия, пинги, рекапы, разбор чата, коучинг, доска Spenders, «Новые»,
хоткеи и звук — поверх веб-чата OnlyMonster ChatSpace (`chat.onlymonster.ai`,
OnlyFans), потом и на fansly.com.

После пилота заменяет оба нынешних клиента: десктоп для OnlyFans
(`onlyfans-chat`, Electron) и Fansly-расширение (`fansly-chat`). Пока пилот
не пройден, оба работают как раньше. Весь AI и все данные платформ идут через
Agency Hub (`hub`).

**Статус:** планирование, кода ещё нет.

## С чего начать

- [docs/hub-integration-plan.md](docs/hub-integration-plan.md) — план: что
  меняем в хабе, как расширение с ним работает, порядок, приёмка, решения
  владельца. §0 — требования владельца к новому клиенту.
- [docs/research/onlymonster-chatspace.md](docs/research/onlymonster-chatspace.md)
  — исследование ChatSpace: устройство, API, точки встраивания, плюсы и минусы
  против десктопа; рядом подробные отчёты и инвентаризации Fansly-расширения и
  десктопа (из них собирается чек-лист паритета).
- [docs/architecture.md](docs/architecture.md) — архитектура расширения:
  стек, пакеты, интерфейсы, работа с ChatSpace и хабом, пакеты работ для
  агентов, контракт UI-агента. Рядом [docs/parity/](docs/parity/) — чек-лист
  паритета (787 пунктов) и карта: куда уходит каждый пункт.
- [docs/decisions.md](docs/decisions.md) — журнал решений.
- [AGENTS.md](AGENTS.md) — правила для агентов.
