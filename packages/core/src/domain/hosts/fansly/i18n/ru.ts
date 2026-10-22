// Russian texts of the Fansly CG codes (1.15.0, R20 P4a3; contracts
// errors-fansly.ts, docs/architecture.md Appendix A «Коды Fansly»). The
// Fansly build's own catalog: the ChatSpace `ru` catalog never carries these
// (R20 architecture §3.4). Plain texts without parameters, as the shared CG
// texts: an error crosses runtimes as code and facts. Product terms in Latin
// (I18-002).

import type { CgFanslyCatalog } from '@cg/contracts/errors-fansly';

export const FANSLY_CG_RU: CgFanslyCatalog = {
  'cg.fanOff.title': 'Fansly не включён',
  'cg.fanOff.body': 'Включите Fansly в настройках расширения: браузер один раз спросит разрешение на fansly.com.',
  'cg.fanSession.title': 'Нет связи с Fansly',
  'cg.fanSession.body': 'Откройте Fansly этой модели и перейдите в сообщения, затем повторите.',
  'cg.fanExpired.title': 'Сессия Fansly истекла',
  'cg.fanExpired.body': 'Обновите вкладку Fansly этой модели, дождитесь входа и повторите.',
  'cg.fanRequest.title': 'Fansly вернул ошибку',
  'cg.fanRequest.body': 'Подождите немного и повторите действие.',
  'cg.fanRateLimit.title': 'Fansly просит паузу',
  'cg.fanRateLimit.body': 'Слишком много запросов к Fansly. Очередь продолжится сама после паузы; действие повторите, когда истечёт срок.',
  'cg.fanTab.title': 'Нет связи с вкладкой Fansly',
  'cg.fanTab.body': 'Включён режим «Fansly через вкладку»: запросы идут через открытую вкладку Fansly этой модели. Обновите её и повторите.',
  'cg.fanGroup.title': 'Чат с фаном не найден',
  'cg.fanGroup.body': 'Fansly не нашёл переписку с этим фаном. Откройте её в Fansly сами или повторите позже.',
  'cg.fanNetwork.title': 'Нет связи с Fansly — попробуйте «Fansly через вкладку»',
  'cg.fanNetwork.body': 'Расширение не достучалось до Fansly напрямую. Если Fansly у вас открывается только через VPN или прокси, включите «Fansly через вкладку»: Настройки → Аккаунты → Fansly. Иначе повторите позже.',
  'cg.noteRead.title': 'Заметки не загрузились',
  'cg.noteRead.body': 'Fansly не отдал заметки фана. Нажмите «Обновить».',
  'cg.noteWrite.title': 'Заметка не сохранилась',
  'cg.noteWrite.body': 'Fansly отказал. Текст остался в поле — сохраните ещё раз.',
  'cg.noteUncertain.title': 'Неизвестно, сохранилась ли заметка',
  'cg.noteUncertain.body': 'Ответ Fansly не дошёл. Обновите заметки и только потом сохраняйте снова, чтобы не создать вторую.',
  'cg.noteTooLong.title': 'Слишком длинный текст',
  'cg.noteTooLong.body': 'Заголовок и имя — до 1000 символов, текст заметки — до 50 000. Сократите его: сами мы текст не обрезаем.',
  'cg.vaultNoAlbum.title': 'Откройте альбом',
  'cg.vaultNoAlbum.body': 'Файлы загружаются в открытый альбом vault: откройте его на Fansly.',
  'cg.vaultUpload.title': 'Файл не загрузился',
  'cg.vaultUpload.body': 'Fansly не принял файл. Попробуйте загрузить его ещё раз.',
  'cg.vaultUncertain.title': 'Неизвестно, загрузился ли файл',
  'cg.vaultUncertain.body': 'Проверьте альбом. Загрузить файл снова можно только по вашему выбору, чтобы он не задвоился.',
  'cg.vaultStopped.title': 'Загрузка остановлена',
  'cg.vaultStopped.body': 'Альбом, аккаунт или вкладка сменились. Продолжите с места остановки — загруженные файлы не повторятся.',
  'cg.fnewPartial.title': 'Результат неполный',
  'cg.fnewPartial.body': 'Проверка прошла не до конца. Продолжите её, чтобы увидеть всех подписчиков.',
  'cg.fnewAccount.title': 'Аккаунт Fansly сменился',
  'cg.fnewAccount.body': 'Проверка остановлена: вкладка теперь под другим аккаунтом. Запустите её заново.',
  'cg.fnewDmClosed.title': 'Этому фану нельзя написать',
  'cg.fnewDmClosed.body': 'Fansly не даёт написать: платные сообщения или ограничения фана. Ничего не сгенерировано и не отправлено.',
  'cg.fnewHistory.title': 'Переписка изменилась',
  'cg.fnewHistory.body': 'Пока отправляли, у фана появилось новое сообщение. Посмотрите его и нажмите «Отправить» ещё раз.',
  'cg.fnewUnverified.title': 'История не проверена',
  'cg.fnewUnverified.body': 'Свой текст уходит только после полной проверки переписки. Дождитесь её или проверьте этого фана сейчас.',
};
