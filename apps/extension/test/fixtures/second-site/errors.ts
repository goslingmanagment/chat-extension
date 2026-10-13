// A second site's own error codes, as its errors table will be (errors-fansly.ts): a table of its own, never a row
// of the shared CG registry ChatSpace's chunks carry. Fixture of test/lazy-sites.test.ts.

import { CG_CODE_PATTERN } from '@cg/contracts';

export const SITE_ERRORS = ['CG-SITEFIX-NOTES', 'CG-SITEFIX-VAULT'] as const;

export const isSiteError = (code: string): boolean => CG_CODE_PATTERN.test(code) && (SITE_ERRORS as readonly string[]).includes(code);
