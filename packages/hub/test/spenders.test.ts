// Spenders (architecture.md §8.5, §8.7; H-8): a board whose hub read failed is an error or a board marked
// incomplete — never an empty or a complete-looking board, never cached (parity SP-029).

import { isHubCallError, isHubCheckError, type CgCode, type SpendersBoard } from '@cg/contracts';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorWireOf } from '../src/index';
import { hubError, json, type RecordedRequest } from './support/fake-hub';
import { makeHarness, signIn, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const BOARD = scenarioNamed(HTTP_SCENARIOS, 'spenders-board-1000');
const pageOf = (offset: number) => BOARD.exchanges.find((exchange) => exchange.route === 'spenders' && (exchange.request as { offset: number }).offset === offset)?.response.body;
const TIERS = okBody(BOARD, 'pageSpenderAutoLists');

async function codeOf(promise: Promise<unknown>): Promise<CgCode | null> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
  if (!isHubCallError(error) && !isHubCheckError(error)) throw error as Error;
  return errorWireOf(error)?.code ?? null;
}

/** Answers after `ms` of the (fake) clock. */
const later = (ms: number, response: () => Response) => () => new Promise<Response>((resolve) => setTimeout(() => resolve(response()), ms));

let h: Harness;
let open = 0;
let maxOpen = 0;
/** The spenders pages answer after 100 ms each; the open count shows the parallelism. */
function serveBoard(harness: Harness, page: (request: RecordedRequest) => Response | 'hang' = (request) => json(200, pageOf(Number(request.query['offset'])))): void {
  harness.hub
    .on('spenders', (request) => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      const answer = page(request);
      if (answer === 'hang') return 'hang';
      return later(100, () => {
        open -= 1;
        return answer;
      })();
    })
    .on('pageSpenderAutoLists', () => json(200, TIERS));
}

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  open = 0;
  maxOpen = 0;
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
  await signIn(h, WORLD_PILOT);
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

async function board(harness: Harness, request: Parameters<Harness['facade']['spendersBoard']>[0], options?: Parameters<Harness['facade']['spendersBoard']>[1]): Promise<SpendersBoard> {
  const settled = harness.facade.spendersBoard(request, options).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

describe('[SP-029] errors are not empty boards', () => {
  it('[SP-029] a failed first page is an error, never an empty board', async () => {
    serveBoard(h, () => hubError(500, 'internal_error'));
    expect(await codeOf(board(h, { pageLabel: PAGE, period: '30d' }))).toBe('CG-HUB-UNAVAILABLE');
  });

  it('[SP-029] a failed later page gives a board marked incomplete, never cached', async () => {
    serveBoard(h, (request) => (request.query['offset'] === '600' ? hubError(503, 'service_unavailable') : json(200, pageOf(Number(request.query['offset'])))));
    const result = await board(h, { pageLabel: PAGE, period: '30d' });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(800);
    await board(h, { pageLabel: PAGE, period: '30d' });
    expect(h.hub.of('spenders').length).toBeGreaterThan(5);
  });
});
