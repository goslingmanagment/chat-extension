// The fixed lists of «Рассылка»'s window (1.63.0), apart from its view model: the actions' schema reads them, and
// the view model's module reads the view's types, which read the actions — so these live with no imports at all.

/** «К отправке N» — fans whose version waits for a click (or is still written); «Все M» — everyone of the outreach. */
export const OUTREACH_TABS = ['todo', 'all'] as const;
export type OutreachTab = (typeof OUTREACH_TABS)[number];

/**
 * The conditions of «Кому» over the chosen tiers: `spent` — spent more than the amount; `active` — wrote or bought in the
 * last 7 days; `notBought` — has not bought the paid media of the offer (only with a paid medium, and only where the site
 * says who bought it); `noWaiting` — leaves out the fans who wait for an answer.
 */
export const OUTREACH_CONDITIONS = ['spent', 'active', 'notBought', 'noWaiting'] as const;
export type OutreachCondition = (typeof OUTREACH_CONDITIONS)[number];

/** Which pane is on the right while no fan is chosen: the offer, or what the outreach did. */
export const OUTREACH_PANES = ['offer', 'summary'] as const;
export type OutreachPane = (typeof OUTREACH_PANES)[number];
