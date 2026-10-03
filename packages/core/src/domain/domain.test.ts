import { describe, expect, it } from 'vitest';

import { OP_LIMITS, hotkeySchemeVersion } from './index';

describe('core/domain scaffold', () => {
  it('keeps the А3 operation limits', () => {
    expect(OP_LIMITS).toEqual({ perChat: 1, perTab: 3 });
  });

  it('loads the vendored hotkey scheme', () => {
    expect(hotkeySchemeVersion).toBeGreaterThanOrEqual(1);
  });
});
