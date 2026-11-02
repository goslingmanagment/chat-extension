// A fan's money on other pages of the agency, as our rows and Fansly's chat header show it (hub `otherPagesSpend`).

import { type MoneyMills } from '../primitives';

export interface OtherPageSpendVM {
  /** The page as the hub names it: «lora-2». */
  readonly pageLabel: string;
  readonly grossMills: MoneyMills;
}
