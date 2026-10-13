// The background core importing Fansly's own code — its tab protocol, its API package, its domain folder: all of it
// runs in Fansly's chunk, never in the core.
import { FANSLY_TAB } from '../../../../../packages/contracts/src/tab-messages-fansly.ts';
import { FANSLY_DOMAIN } from '../../../../../packages/core/src/domain/hosts/fansly/index.ts';
import { FANSLY_API } from '../../../../../packages/fansly-api/src/index.ts';
export const PERMISSIONS = [FANSLY_TAB, FANSLY_DOMAIN, FANSLY_API];
