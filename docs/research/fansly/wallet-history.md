# Fansly: «Wallet history» (кошелёк создателя)

Проверено 2026-11-15 по Москве: `pnpm see:session --bare` (тестовая модель агентства, без расширения, только
чтение: переходы, вкладка «Wallet history», кнопка «Next page»). Для доски «Отчёт» (кнопка «показать на сайте»
и наблюдатель продаж). Имена фанов, суммы и номера здесь не записаны.

## Где

- Страница: `https://fansly.com/creator/wallet/history` («Wallet & Payouts» → вкладка «Wallet history»).
  `/creator/wallet` открывает `/creator/wallet/payouts`; старый адрес `/creator/earnings/wallet` ведёт туда же.
- Переход без перезагрузки работает: `history.pushState(null, '', '/creator/wallet/history')` и событие `popstate`
  (как `host-fansly/isolated/navigate.ts` открывает чат): роутер Angular рисует историю, `window` тот же.
- Живой экран один: `app-creator-wallet-transaction-history` внутри `app-stats-card.wallet-block`.

## Строка

```
div.tx-rows
  div.tx-row
    div.tx-thumb            значок вида (fa-star подписка, fa-dollar-sign чаевые, картинка у продажи медиа)
    div.tx-main
      div.tx-title
        span.tx-label       «Subscription Sale to», «Tip from», «Media Sale to» (xd-localization-string)
        app-account-username a.username-wrapper[href="/<handle>"] span.display-name, span.user-name «@handle»
      div.tx-sublabel       у подписки: тир и срок
      div.tx-meta
        span                «Oct 10, 2026, 12:18» (местное время браузера, без секунд)
        span.tx-id          «#<transactionId>» (полный номер транзакции, 18 цифр)
        span.fansly-status-pill «Approved»
    div.tx-amount div.tx-amount-value  span.tx-sign «+», app-balance-display «4» (после комиссии, как баланс)
```

- **Номер транзакции печатается в каждой строке** (`span.tx-id`), это тот же `transactionId`, что в ответе API и в
  Hub. Поиск строки по номеру точный; время, сумма и фан нужны только как запасной путь.
- Возврат остаётся в списке зачёркнутым (подпись страницы).

## Страницы списка

- `app-cursor-pager div.pager`: `div.pager-range` «1–10 of 78», кнопки `button[aria-label="Previous page"]`,
  `button.pager-num` (номера, у текущей `aria-current="page"`), `button[aria-label="Next page"]` (у последней
  страницы `disabled`).
- На странице 10 строк, новые сверху. Сайт сам грузит `GET apiv3.fansly.com/api/v1/account/wallets/earnings/transactions?before=&after=&limit=30&offset=0&ngsw-bypass=true`
  при входе на вкладку; следующие страницы до 30-й строки берёт из того же ответа, дальше просит следующий кусок.

## Ответ API

`{ success, response: { total, data: [ … ], aggregationData: { accountMedia, … } } }`, строка:
`walletId, transactionId, accountId, correlationId, correlationAccountId, type, destination, amount,
destinationTax, destinationAmount, newBalance, newBalance64, createdAt (мс), updatedAt, status, senderId, receiverId`.

- `amount` / `destinationAmount` — в тысячных долях доллара (4000 = $4), то, что показано в строке.
- `type`: 15001 подписка, 7101 чаевые, 2110/2116 продажа медиа (как в Hub `money-rules.ts`).

## Заголовки

- `fansly.com` отдаёт `x-frame-options: SAMEORIGIN` (себя не даёт встраивать), `content-security-policy` нет ни в
  заголовке, ни в `<meta>`: вложенный кадр с другого https-адреса страница не запрещает.
- `chat.onlymonster.ai`: `content-security-policy: frame-ancestors 'none'`, `x-frame-options: DENY` (тоже только про
  встраивание его самого); `frame-src` нет.

## Как смотреть

С мака прямой путь до fansly.com сбрасывается: `ssh -N -D 127.0.0.1:<порт> <сервер>` и
`CG_SEE_LIVE_SOCKS=127.0.0.1:<порт> pnpm see:session --bare` (прокси только у этого браузера).
