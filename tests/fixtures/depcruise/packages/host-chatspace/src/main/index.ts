// The MAIN bridge importing contracts: it must stay self-contained.
import { C } from '../../../contracts/src/index.ts';
export const M = C;
// Allowed (R20 P5): ChatSpace's MAIN code over the MAIN boot of host-kit — `host-main-self-contained` lets it through.
import { BOOT } from '../../../host-kit/src/main/index.ts';
export const OVER_THE_BOOT = BOOT;
