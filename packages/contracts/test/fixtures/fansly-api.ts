import type { FanslyApiCall, FanslyApiPort } from '../../src/fansly-api';

/** Compile-time fixtures of the background port; there is no new RPC wire schema. */
export const fanslyRegistrationCall = {
  accountId: '100', tabId: 1, purpose: 'registration', mode: 'cooldown', method: 'GET', path: '/group/55',
} as const satisfies FanslyApiCall;
export const fanslyApiFixture: FanslyApiPort = {
  prepare: () => Promise.resolve({ dispatch: () => Promise.resolve({ id: '55' }), cancel() {} }),
  request: () => Promise.resolve({ id: '55' }),
};
