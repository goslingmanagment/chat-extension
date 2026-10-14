import { C } from '../../../contracts/src/index.ts';
export const I = C;
// Allowed (R20 P5): ChatSpace's adapter over the shared mechanics of host-kit — `host-isolated` lets it through.
import { K } from '../../../host-kit/src/common/index.ts';
export const OVER_THE_KIT = K;
// Allowed (R20 F9b): its profile takes the phrases of ChatSpace's own text pack.
import { CHATSPACE_PHRASES } from '../../../core/src/domain/hosts/chatspace/i18n/index.ts';
export const PHRASES = CHATSPACE_PHRASES;
