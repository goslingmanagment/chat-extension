// Fansly's background chunk (`bg/fansly.ts`): its API package and its tab protocol are its own; a module of
// ChatSpace's chunk is not.
import { FANSLY_API } from '../../../packages/fansly-api/src/index.ts';
import { FANSLY_TAB } from '../../../packages/contracts/src/tab-messages-fansly.ts';
import { JOURNAL } from './chatspace/journal.ts';
export const FANSLY_CHUNK = [FANSLY_API, FANSLY_TAB, JOURNAL];
