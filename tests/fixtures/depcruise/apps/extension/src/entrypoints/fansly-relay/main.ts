// The relay frame: contracts and the platform port are its own; fansly-api is the background's.
import { C } from '../../../../../packages/contracts/src/index.ts';
import { FANSLY_API } from '../../../../../packages/fansly-api/src/index.ts';
import { P } from '../../../../../packages/platform/src/index.ts';
export const RELAY = [C, FANSLY_API, P];
