// A fan on other pages of the agency, as our rows and Fansly's chat header show it (hub `otherPages`).

import { type IsoTimestamp, type MoneyMills } from '../primitives';

export interface OtherPageVM {
  /** The page as the hub names it: «lora-2». */
  readonly pageLabel: string;
  /** What he paid there; 0: nothing. */
  readonly grossMills: MoneyMills;
  /** His own newest message there; null: none known. */
  readonly lastFanMessageAt: IsoTimestamp | null;
  /** Whether he subscribes to or follows that page now; null: neither. */
  readonly relation: 'subscriber' | 'follower' | null;
}
