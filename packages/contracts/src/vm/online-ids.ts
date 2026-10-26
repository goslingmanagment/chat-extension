// The fixed lists of «Онлайн»'s window (1.65.0), apart from its view model: the actions' schema reads them, and the
// view model's module reads the view's types, which read the actions — so these live with no imports at all.

/** «К разбору» — the fans to write to, not done yet; «Все онлайн» — everyone online, the set aside and the done too. */
export const ONLINE_TABS = ['todo', 'all'] as const;
export type OnlineTab = (typeof ONLINE_TABS)[number];

/** «Зашли за»: the presence window, minutes. */
export const ONLINE_PERIODS = [10, 30, 120] as const;
export type OnlinePeriod = (typeof ONLINE_PERIODS)[number];

/**
 * What the person may have written for a fan by a click on the card: the AI's Reply, Hi or Ping, the guide's text, or
 * Fix — the AI's rewrite of the person's own words in the card's field «Свой текст».
 */
export const ONLINE_CHOICES = ['reply', 'hi', 'ping', 'template', 'fix'] as const;
export type OnlineChoice = (typeof ONLINE_CHOICES)[number];
