// Sentry on the stand — the gate of decision X22 (architecture.md §5.3
// «Правила MAIN-мира»). ChatSpace 0.195.0 runs the public Sentry browser SDK
// 10.45.0 (errors with every breadcrumb: console lines, clicks, fetch,
// navigation; no Replay, no tracing, no URL filter). The stand runs the same
// public package set up the same way (fixture-chatspace/src/sentry.ts),
// reporting to a collector of the stand server. A person works through the
// extension — the dock, an insert, the palette, a preview with an X8 send,
// «Открыть чат» — and a failure is forced into our MAIN code; then the page's
// own code throws, and Sentry sends that error with all it holds. Nothing it
// sends may name us: no frame of an extension script, no console line, our
// clicks only as a bare `div`, nothing of our fields as typing, and the
// forced failure not at all (it reaches our own logs instead).
//
// The last test is the positive control and the record of what Firefox does
// with a MAIN-world script's error: the TEST build's bridge throws on a page
// event, unguarded (apps/extension/build/main-world-entry.ts), and ChatSpace's
// own `new WebSocket(<bad URL>)` throws through the tap's constructor. What
// the page and Sentry saw goes to .cache/e2e/sentry-gate.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';

import { MOD, PANEL } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { oursExists, pressOurs, readOurs, waitOursText } from '../support/ours';
import { eventText, sentryEnvelopes, sentryEvents, type SentryEvent } from '../support/sentry';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a4 } = STAND_IDS.fans;
const reply = (fan: string): readonly [string, string] => [`Hey you, thanks for writing! @${fan}`, `How was your day? @${fan}`];
const evidenceDir = fileURLToPath(new URL('../../../../.cache/e2e/', import.meta.url));

/** What would name us in what the page's telemetry sends. */
const OURS_IN_TEXT = /moz-extension:|chatgoose|data-cg\b|data-cg-|\.cg-[a-z]|cg-root|wsTap|mainRuntime/i;

/** An error the page saw (window `error` / `unhandledrejection`), as its own listener recorded it. */
interface PageError {
  readonly kind: 'error' | 'rejection';
  readonly message: string;
  readonly filename: string | null;
  readonly line: number | null;
  readonly stack: string | null;
}

/** The page's own listener for errors (ChatSpace's Sentry has its own; this one records what it was given). */
async function recordPageErrors(): Promise<void> {
  await browser.execute(() => {
    const store = window as unknown as { __sentryGate?: PageError[] };
    if (store.__sentryGate !== undefined) return;
    const seen: PageError[] = [];
    store.__sentryGate = seen;
    window.addEventListener('error', (event) => {
      const error = event.error as { stack?: unknown } | null | undefined;
      seen.push({ kind: 'error', message: event.message, filename: event.filename || null, line: event.lineno || null, stack: typeof error?.stack === 'string' ? error.stack : null });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason as { message?: unknown; stack?: unknown } | null | undefined;
      seen.push({ kind: 'rejection', message: typeof reason?.message === 'string' ? reason.message : JSON.stringify(reason ?? null), filename: null, line: null, stack: typeof reason?.stack === 'string' ? reason.stack : null });
    });
  });
}
const pageErrors = (): Promise<PageError[]> => browser.execute(() => [...((window as unknown as { __sentryGate?: PageError[] }).__sentryGate ?? [])]);

/** The page's own code throws; Sentry sends that error with every breadcrumb it holds, and whatever it still held. */
async function probe(message: string): Promise<SentryEvent> {
  expect(await callStand('sentryProbe', message)).toBe(true);
  let found: SentryEvent | undefined;
  await browser.waitUntil(
    async () => {
      found = sentryEvents(await sentryEnvelopes()).find((event) => eventText(event).includes(message));
      return found !== undefined;
    },
    { timeout: 10_000, interval: 100, timeoutMsg: `Sentry did not send «${message}» to the stand` },
  );
  return found as unknown as SentryEvent;
}

const framesOf = (event: SentryEvent): string[] => (event.exception?.values ?? []).flatMap((value) => (value.stacktrace?.frames ?? []).map((frame) => `${frame.function ?? '?'}@${frame.filename ?? frame.abs_path ?? '?'}`));

describe('[X22] Sentry on the stand: what ChatSpace’s telemetry could send of us', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  const evidence: Record<string, unknown> = {};

  before(async () => {
    await standServer.reset();
    await standServer.sentryReset();
    // The stand's socket names its accounts soon after their subscription: X8's freshness is known from then on.
    await standServer.traffic({ firstSummaryMs: 150 });
    await hub().command({ op: 'config', patch: { aiNameFan: true } });
    shift = await startShift(hub(), { previewSend: true, sentry: true, settings: { generation: { split: true } }, viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
    await recordPageErrors();
  });

  after(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}sentry-gate.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('a person’s work through the extension and a failure forced into MAIN: Sentry sends nothing that names us', async () => {
    // The dock: Reply, then «Вставить» of the first part into ChatSpace's field.
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the dock’s result', 20_000);
    await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
    await browser.waitUntil(async () => (await callStand('composerState', ACC, a1))?.text === reply(a1)[0], { timeout: 10_000, timeoutMsg: 'the part is in the field' });

    // The palette, with typing in its own field (our closed root: to the page the target is our host).
    await browser.keys([MOD, 'k']);
    await browser.waitUntil(() => oursExists('modal', '.cg-pal__item'), { timeout: 10_000, timeoutMsg: 'the palette' });
    await browser.keys(['s', 'p']);
    await browser.keys('Escape');

    // Spenders, a fan's preview, Reply there, then X8: «Отправить» of the first part, through ChatSpace's own queue.
    await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', 'Fan Dune', 'the board lists Fan Dune', { timeout: 20_000, selector: '[aria-label="Доска Spenders"]' });
    await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Dune/);
    await waitOursText('modal', 'Fan Dune', 'the preview of Fan Dune', { selector: '.cg-pv' });
    await pressOurs('modal', '.cg-pv button', /^Reply/);
    await waitOursText('modal', reply(a4)[1], 'the preview’s result', { timeout: 20_000, selector: '.cg-pvr' });
    await pressOurs('modal', '.cg-pv [data-cg-part="0"] .cg-pvs__send', /^Отправить/);
    await browser.waitUntil(async () => (await readOurs('modal', '.cg-pv [data-cg-part="0"]', (node) => node.getAttribute('data-cg-send-state'))) === 'sent', {
      timeout: 15_000,
      timeoutMsg: 'the first part is sent',
    });

    // «Открыть чат» of the preview: ChatSpace's router opens that chat.
    await pressOurs('modal', '.cg-pv button', /^Открыть чат$/);
    await waitForChatReady(ACC, a4);

    // A failure forced into our MAIN code, inside a listener Sentry wraps: our `input` listener reads the event's target,
    // whose `closest` throws (a page element of its own making).
    await browser.execute(() => {
      const element = document.createElement('div');
      Object.defineProperty(element, 'closest', {
        value: () => {
          throw new Error('sentry-gate: a failure forced into our MAIN code');
        },
      });
      document.body.append(element);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.remove();
    });
    // It went to our own logs: the day's errors count it (tab.host «main-fault», CG-UNKNOWN).
    await browser.waitUntil(
      async () => {
        const diagnostics = await shift.rpc<{ counters: Record<string, number> }>('diagnostics.get');
        return diagnostics.ok && (diagnostics.payload.counters['CG-UNKNOWN'] ?? 0) >= 1;
      },
      { timeout: 10_000, interval: 200, timeoutMsg: 'the forced failure did not reach our logs as CG-UNKNOWN' },
    );

    // ChatSpace's own error: Sentry sends it with every breadcrumb it holds.
    const event = await probe('sentry-gate: an error of the page itself');
    const envelopes = await sentryEnvelopes();
    const events = sentryEvents(envelopes);
    const crumbs = event.breadcrumbs ?? [];
    evidence['work'] = {
      envelopes: envelopes.length,
      events: events.map(eventText),
      breadcrumbs: crumbs.map((crumb) => `${crumb.category ?? crumb.type ?? '?'}: ${crumb.message ?? JSON.stringify(crumb.data ?? {})}`),
    };

    // The page saw no error of ours: only its own probe.
    expect((await pageErrors()).filter((error) => !error.message.includes('an error of the page itself'))).toEqual([]);
    // One event, the page's own; the forced failure is not one.
    expect(events.map(eventText)).toEqual([expect.stringContaining('sentry-gate: an error of the page itself') as unknown]);
    // Nothing of what went out names us: no extension frame, URL or name.
    for (const envelope of envelopes) expect([envelope.seq, OURS_IN_TEXT.exec(envelope.raw)?.[0] ?? null]).toEqual([envelope.seq, null]);
    // No console line at all; nothing typed into our fields; every click of ours a bare `div`.
    expect(crumbs.filter((crumb) => crumb.category === 'console')).toEqual([]);
    expect(crumbs.filter((crumb) => crumb.category === 'ui.input')).toEqual([]);
    // At the document every click in a closed root is a click on its host, the same element each time: Sentry merges
    // repeats on one target within a second, so a few breadcrumbs stand for all of them.
    const clicks = crumbs.filter((crumb) => crumb.category === 'ui.click').map((crumb) => crumb.message ?? '');
    expect(clicks.length).toBeGreaterThan(0);
    for (const click of clicks) expect(click).toMatch(/(?:^| > )div$/);
    // The person's work is there as ChatSpace's own: its navigation and its POST of the X8 part.
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    expect(crumbs.some((crumb) => crumb.category === 'navigation' && text(crumb.data?.['to']).includes(`/chats/${a4}`))).toBe(true);
    expect(crumbs.some((crumb) => crumb.category === 'fetch' && crumb.data?.['method'] === 'POST' && text(crumb.data['url']).includes(`/chats/${a4}/messages`))).toBe(true);
  });

  it('our hosts in the page are plain divs with neutral attributes, and no name of ours is on the page’s window', async () => {
    const seen = await browser.execute(() => ({
      hosts: [...document.querySelectorAll('[data-host]')].map((host) => ({
        tag: host.localName,
        editable: (host as HTMLElement).isContentEditable,
        attributes: [...host.attributes].map((attribute) => attribute.name).sort(),
        values: [...host.attributes].map((attribute) => attribute.value).join(' '),
        children: host.childNodes.length,
      })),
      symbols: Object.getOwnPropertySymbols(window)
        .map((symbol) => Symbol.keyFor(symbol) ?? '')
        .filter((key) => key !== ''),
    }));
    evidence['hosts'] = seen;
    expect(seen.hosts.length).toBeGreaterThanOrEqual(2);
    const allowed = new Set(['data-host', 'data-mode', 'data-layer', 'data-pending', 'data-scheme', 'data-dismissible-open', 'aria-busy', 'style']);
    for (const host of seen.hosts) {
      expect([host.tag, host.editable, host.children]).toEqual(['div', false, 0]);
      expect(host.attributes.filter((name) => !allowed.has(name))).toEqual([]);
      expect(host.values).not.toMatch(/cg|goose/i);
    }
    expect(seen.symbols.filter((key) => /cg|goose/i.test(key))).toEqual([]);
  });

  it('the positive control, and what Firefox does with an error of a MAIN-world script', async () => {
    // A listener of the TEST build's bridge throws, unguarded: what a failure that escaped us would look like.
    await browser.execute(() => {
      setTimeout(() => window.dispatchEvent(new Event('cg-e2e-main-throw')), 0);
    });
    let escaped: SentryEvent | undefined;
    try {
      await browser.waitUntil(
        async () => {
          escaped = sentryEvents(await sentryEnvelopes()).find((event) => eventText(event).includes('MAIN-world script'));
          return escaped !== undefined;
        },
        { timeout: 5000, interval: 100 },
      );
    } catch {
      // Not sent: recorded below (a muted «Script error.» is dropped by Sentry's default filter).
    }
    const page = await pageErrors();
    const mainThrow = page.find((error) => error.message.includes('MAIN-world script') || error.message === 'Script error.');
    // ChatSpace's own `new WebSocket(<bad URL>)`: the constructor's error passes through the tap — as it is, with our frame.
    // (A relative URL is a valid one, resolved against the page; a scheme other than ws/wss/http/https is not.)
    const caught = await browser.execute(() => {
      try {
        new WebSocket('ftp://example.invalid/');
        return null;
      } catch (error) {
        return { name: (error as Error).name, message: (error as Error).message, stack: (error as Error).stack ?? null };
      }
    });
    await browser.execute(() => {
      setTimeout(() => new WebSocket('ftp://example.invalid/'), 0);
    });
    let throughTap: SentryEvent | undefined;
    try {
      await browser.waitUntil(
        async () => {
          throughTap = sentryEvents(await sentryEnvelopes()).find((event) => (event.exception?.values ?? []).some((value) => value.type === caught?.name && value.value === caught?.message));
          return throughTap !== undefined;
        },
        { timeout: 5000, interval: 100 },
      );
    } catch {
      // Recorded below.
    }
    evidence['firefox'] = {
      mainThrowSeenByPage: mainThrow ?? null,
      mainThrowSentBySentry: escaped === undefined ? null : { text: eventText(escaped), frames: framesOf(escaped), mechanism: escaped.exception?.values?.[0]?.mechanism ?? null },
      webSocketErrorStack: caught,
      webSocketErrorSentBySentry: throughTap === undefined ? null : { text: eventText(throughTap), frames: framesOf(throughTap) },
    };
    // The control proves the gate can see an escape: the page heard the MAIN script's error, and Sentry sent it.
    expect(mainThrow).toBeDefined();
    expect(escaped === undefined ? null : eventText(escaped)).toContain('MAIN-world script');
    // The constructor's own error reached the page unchanged: a SyntaxError of the browser's.
    expect(caught?.name).toBe('SyntaxError');
  });
});
