// Version-independent pilot copy. The release renders it into the
// existing pages without changing their layout, artwork or release links.

import { EXTENSION_NAME } from '../../apps/extension/build/manifest.ts';
import { escapeHtml } from './changelog.ts';

const PRIVACY_BODY = `        <h1>О данных</h1>
        <p class="lead">Что ChatGoose читает, куда это уходит и что остаётся на вашем компьютере. При установке Firefox спрашивает согласие на обработку данных. Доступ к Fansly включается отдельно.</p>

        <h2>Куда уходят данные</h2>
        <p>AI работает на сервере агентства — в хабе ChatGoose (<code>gosling-agency.ru</code> или другом HTTPS-адресе хаба, который вы выбрали в настройках). Расширение получает оттуда архив переписки, траты и ответы AI. Само расширение к поставщикам AI не обращается.</p>
        <p>В ChatSpace расширение читает данные страницы и вставляет черновик в поле ввода. Собственных запросов к OnlyMonster оно не делает.</p>
        <p>После «Включить Fansly» расширение также читает данные страницы Fansly и обращается к <code>https://apiv3.fansly.com/api/v1/</code>: для очереди «Новые», приветствий, поиска чата, профилей и заметок. Эти запросы идут в Fansly. «Fansly через вкладку» в настройках направляет их через вкладку модели и прокси её контейнера Firefox; по умолчанию режим выключен и запросы делает фон расширения. Через хаб эти запросы не проходят.</p>

        <h2>Что обрабатывается</h2>
        <ul class="rows">
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Вход в ChatGoose</span>
            <span class="row__value">Логин и пароль ChatGoose
              <span class="row__note">Пароль уходит на хаб при входе. На компьютере хранится ключ устройства; выход его стирает.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Вход в Fansly</span>
            <span class="row__value">Заголовки сессии из запросов открытой страницы
              <span class="row__note">После выдачи прав Firefox расширение пассивно читает заголовки запросов к API Fansly и статусы ответов. Это нужно для работы под нужным аккаунтом и паузы при ограничении запросов. Ключи Fansly хранятся в сессии браузера и используются только для Fansly: в хаб, AI, технические замеры и журнал они не уходят. Пароль Fansly расширение не запрашивает.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Личные данные</span>
            <span class="row__value">Имена и идентификаторы фанов, страницы и диалога, имя чаттера, дата регистрации фана
              <span class="row__note">Идентификаторы связывают открытый чат с архивом и AI в хабе. Дата регистрации и профиль Fansly показываются рядом с чатом.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Переписка и черновик</span>
            <span class="row__value">Свежие сообщения открытого чата и ваш черновик
              <span class="row__note">Отправляются в хаб по вашему Reply, Fix, Hi или Ping, только для этой генерации; в архив хаба из расширения не добавляются. Recap, Review и Coach используют архив хаба. Для очереди «Новые» расширение отдельно проверяет историю в Fansly, не открывая чат и не отмечая его прочитанным.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Заметки Fansly</span>
            <span class="row__value">Имя фана и анкета, которые вы читаете или сохраняете в Fansly
              <span class="row__note">Значения заметок расширение не отправляет в хаб, AI или журнал. «Заполнить из чата» передаёт в хаб только названия полей анкеты и идентификаторы чата; AI отвечает по архиву хаба. Предложения сохраняются в Fansly только после «Создать» или «Сохранить».</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Траты и приветствия</span>
            <span class="row__value">Траты из хаба, очередь фанов и состояние отправки приветствия
              <span class="row__note">Spenders показывает данные хаба. Хаб также координирует бронь и результат отправки приветствий между чаттерами. Приветствие отправляется в Fansly по вашему клику. Карт и банковских счетов расширение не читает.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Страница и vault</span>
            <span class="row__value">Открытый чат, поле ввода, список чатов и выбранные для загрузки файлы
              <span class="row__note">Работа на странице ограничена <code>chat.onlymonster.ai</code> и, после отдельного разрешения, <code>fansly.com</code>. Загрузка файлов идёт через интерфейс Fansly; расширение следит за подтверждением и сохраняет прогресс. В пилоте Fansly голосовых функций нет.</span>
            </span>
          </li>
          <li class="row">
            <span class="row__mark">·</span>
            <span class="row__name">Технические замеры</span>
            <span class="row__value">Скорость работы и коды ошибок — с отдельного согласия
              <span class="row__note">Согласие включается в «Настройках» → «Диагностика». Текстов переписки, заметок и ключей сессии в замерах нет. Для наблюдения пилота Fansly чаттеры включают это согласие.</span>
            </span>
          </li>
        </ul>

        <h2>Что остаётся на компьютере</h2>
        <ul>
          <li>Настройки темы, языка, звука, клавиш и Fansly, ключ устройства ChatGoose, очередь и контрольные точки незаконченных действий.</li>
          <li>Ключи сессии Fansly — в памяти и сессионном хранилище браузера; они переживают сон фона расширения.</li>
          <li>Журнал диагностики без текстов переписки, заметок, паролей и ключей Fansly. Выгрузка журнала остаётся у вас, пока вы сами не отправите файл.</li>
        </ul>

        <h2>Что решаете вы</h2>
        <ul>
          <li>Отправить сообщение, сохранить заметку или загрузить файлы. Расширение не отправляет сообщения фанам само.</li>
          <li>Открыть чат: просмотр превью и генерация не отмечают его прочитанным. «Открыть и вставить» открывает чат на сайте и может отметить его прочитанным.</li>
          <li>Разрешить технические замеры и доступ к Fansly. Код из сети расширение не загружает и не выполняет.</li>
        </ul>

        <h2>Как отозвать согласие</h2>
        <p>«Выключить Fansly» в popup или настройках останавливает работу на Fansly и отзывает выданные права; открытые вкладки нужно перезагрузить. Права можно отозвать и в Firefox. Согласие на технические замеры отключается отдельно, в «Настройках» → «Диагностика». Удаление расширения на <code>about:addons</code> удаляет его настройки и ключ устройства. Вопросы о данных — к владельцу агентства.</p>`;

const FANSLY_CUTOVER = `        <section id="fansly-cutover">
          <h2>Переход на Fansly</h2>
          <p>Для Fansly дождитесь объявления владельца и обновления с поддержкой пилота: все 11 чаттеров шести страниц переходят в один день. В пилоте войсов нет; голосовые функции появятся после него.</p>
          <ol>
            <li>До перехода закончите начатые войсы и загрузки vault в старом расширении. Его локальные данные и незаконченные работы в новое не переносятся. Обновите новое ChatGoose и войдите своим логином ChatGoose.</li>
            <li>В объявленный день выключите старое расширение в своём профиле Firefox: <code>about:addons</code> → «Расширения». У старого id <code>chatgoose@gosling.agency</code>, у нового — <code>chat-extension@gosling.agency</code>. Оба могут называться ChatGoose; id виден на <code>about:debugging#/runtime/this-firefox</code>. FBuddy оставьте включённым.</li>
            <li>В popup нового расширения или «Настройках» → «Аккаунты», в карточке «Fansly», нажмите «Включить Fansly». Разрешите доступ к <code>fansly.com</code>, <code>apiv3.fansly.com</code> и наблюдение запросов. Дождитесь готовности и перезагрузите все вкладки Fansly — баннер и popup подскажут, какие ещё ждут.</li>
            <li>Настройки старого расширения не переносятся — выставьте их заново: персону своей страницы («Настройки» → «Персоны»), звук («Вид и звук»), свои хоткеи («Хоткеи») и вид «Заметок» (переключатель в самой панели: «Всегда справа», «Справа по кнопке» или «Окно по центру»).</li>
            <li>Проверьте панель над полем ввода в открытом чате. В «Настройках» → «Диагностика» включите согласие на технические замеры для наблюдения пилота.</li>
          </ol>
          <p>Пока старое расширение включено, новое на Fansly отступает. Приветствия отправляйте только из нового: старое и новое нельзя использовать параллельно на одной странице. Какие данные читаются и куда уходят — в <a href="privacy.html">«О данных»</a>.</p>
        </section>`;

/** Only editorial bodies: release slots and the rest of each page stay as they are. */
export function renderSiteCopy(name: string, source: string): string {
  const product = escapeHtml(EXTENSION_NAME);
  const html = source
    .replace(/(<title>[^<]* — )[^<]*(<\/title>)/, `$1${product}$2`)
    .replace(/<span class="nav__host">[^<]*<\/span>/, '<span class="nav__host">для ChatSpace и Fansly</span>')
    .replace(/(<p class="foot">)ChatGoose(?: для ChatSpace)? /, `$1${product} `)
    .replace('Все версии ChatGoose для ChatSpace, от новой к старой.', `Все версии ${product}, от новой к старой.`);
  if (name === 'index.html') {
    return html
      .replace(/<h1>[^<]*<\/h1>/, `<h1>${product}</h1>`)
      .replace(/<p class="lead">[^<]*<\/p>/, '<p class="lead">AI-помощник чаттера для ChatSpace и Fansly: ответы, правка черновика, приветствия, пинги, сводки, оценка чата и доска Spenders. Одно расширение для Firefox.</p>')
      .replace(/(<span class="row__mark">5<\/span>\n)[\s\S]*?(?=\n {10}<\/li>)/, `$1            <span class="row__name">Откройте ChatSpace или включите Fansly</span>
            <span class="row__value">Панель ChatGoose появится над полем ввода в чате
              <span class="row__note">Для Fansly сначала выполните <a href="start.html#fansly-cutover">шаги перехода</a>. Вкладки, открытые до установки или обновления, перезагрузите.</span>
            </span>`)
      .replace(/(<h2>Обновления<\/h2>\n {8}<p>)[\s\S]*?(<\/p>)/, '$1Firefox сам проверяет обновления примерно раз в сутки и ставит их без вопросов. Вкладки ChatSpace и Fansly, открытые до обновления, попросят перезагрузку.$2')
      .replace(/<h2>Если у вас уже стоит ChatGoose<\/h2>[\s\S]*?(?=\n {8}<p class="foot">)/, `<h2>Если у вас уже стоит ChatGoose</h2>
        <p>В день перехода на Fansly выключите старое расширение во всём профиле Firefox, а в новом нажмите «Включить Fansly». Все чаттеры страницы переходят вместе. Порядок и подготовка — в <a href="start.html#fansly-cutover">«Как начать»</a>; пилот проходит без войсов.</p>
        <p>Приложение ChatGoose для OnlyFans остаётся установленным. Страницы, которые тимлид перевёл на ChatSpace, ведите здесь; приветствия на них отправляйте только из расширения. Id нового расширения и его обновления остаются прежними.</p>
`);
  }
  if (name === 'privacy.html') {
    const body = /^[ \t]*<h1>О данных<\/h1>[\s\S]*?(?=\n {6}<\/div>\n {4}<\/main>)/m;
    if (!body.test(html)) throw new Error('privacy.html: no privacy body to regenerate');
    return html.replace(body, PRIVACY_BODY);
  }
  if (name === 'start.html') {
    const existing = / {8}<section id="fansly-cutover">[\s\S]*?<\/section>/;
    if (existing.test(html)) return html.replace(existing, FANSLY_CUTOVER);
    const anchor = '        <h2>Не получается войти</h2>';
    if (!html.includes(anchor)) throw new Error('start.html: no cutover insertion point');
    return html.replace(anchor, `${FANSLY_CUTOVER}\n\n${anchor}`);
  }
  return html;
}
