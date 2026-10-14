// The page composition root importing the background root: the hub rides along. Its imports of Fansly's own folder
// and of ChatSpace's text pack are allowed: the extension pages carry the texts and the errors of both sites (R20 F9b:
// `chatspace-code-only-from-chatspace` lets the pages' root through as `fansly-code-only-from-fansly` does).
import { CHATSPACE_PHRASES } from '../../../../packages/core/src/domain/hosts/chatspace/i18n/index.ts';
import { FANSLY_DOMAIN } from '../../../../packages/core/src/domain/hosts/fansly/index.ts';
import { B } from './background.ts';
export const P = [B, FANSLY_DOMAIN, CHATSPACE_PHRASES];
