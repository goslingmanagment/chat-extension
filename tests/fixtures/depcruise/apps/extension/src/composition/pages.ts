// The page composition root importing the background root: the hub rides along. Its import of Fansly's own folder is
// allowed: the extension pages carry the texts and the errors of both sites.
import { FANSLY_DOMAIN } from '../../../../packages/core/src/domain/hosts/fansly/index.ts';
import { B } from './background.ts';
export const P = [B, FANSLY_DOMAIN];
