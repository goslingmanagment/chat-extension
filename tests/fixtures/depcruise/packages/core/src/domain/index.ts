// core/domain reaching into platform by a relative path: two rules at once.
import { P } from '../../../platform/src/index.ts';
import { cycleA } from './cycle-a.ts';
export const D = P + cycleA;
