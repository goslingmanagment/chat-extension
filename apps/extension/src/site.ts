// The pages of the release site the extension links to (architecture.md §13:
// «Страницы site/ лежат рядом с фидом» — installation, «Как начать», «Что
// нового», the version history; UP-013, ST-005, ST-050). They open in a new
// tab on the person's click and nowhere else: the extension itself never
// requests them. The site is R19's; until it is published these addresses
// answer 404. The manifest test pins the base to the update feed's folder.

/** The folder of the site, next to the update feed (build/manifest.ts `UPDATE_URL`). */
export const SITE_BASE = 'https://ext.gosling-agency.ru/chat-extension/';

export const SITE_PAGES = {
  /** «Что нового»: the notes of the current version. */
  whatsNew: `${SITE_BASE}whats-new.html`,
  /** «История версий». */
  changelog: `${SITE_BASE}changelog.html`,
  /** «Нужна помощь со входом» — «Как начать» (ST-050). */
  start: `${SITE_BASE}start.html`,
} as const;
