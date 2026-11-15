// Workboard's screens over the site, the tab's side (hub package R, 2026-11-15; R-protocol.md; host-kit
// isolated/frame-host.ts draws). One host of Workboard «frame» screens: the board «Отчёт» is the first, «Записать
// кастом» and «Мои деньги» come through the same seam (the coordinator, 2026-11-15): a screen is a path under
// `/workboard/frame/`, its allow-list a table of the background (core domain/report-board.ts).
//
// What the frame says over its port, and what this does with it:
// - `fetch` — one API request; the background runs it with the device token if the screen's allow-list has it, and
//   the answer goes back as `fetch:result`.
// - `state` — the board's phase, chip and count: the bar shows them while the board is collapsed.
// - `collapse` — the layer hides (the frame stays loaded), the bar shows. Esc on the site's page does the same.
// - `find` — «show on the site»: collapse; the sale's page is this tab's — the site's finder frames its row (the
//   prototype's highlight) and the bar says «Сверка: …»; another tab of that page — the background brings it forward
//   and it does the same there; none — the bar says «Откройте вкладку <страница>, строка найдётся сама» and the find
//   waits for that tab. Not found — «Строка на сайте не найдена: 22:30, $48, Viggo»: never a similar row.
// - `copy` — the text to the clipboard (the click in the frame activates this page too); `copy:result`.
// - `statement` — the OnlyFans statements of these pages read again (ChatSpace's tabs of them ask their poll now).

import { REPORT_FETCH_BODY_MAX, ReportSaleSchema, ReportStateSchema, workboardFramePath, type ReportSale, type ReportState, type WorkboardFrameScreen } from '@cg/contracts/report-board';
import type { ColorScheme, ValueSignal } from '@cg/contracts/vm';
import { compareWords, notFoundWords, openTabWords, salesWords, type SaleLook } from '@cg/core/domain/report-board';
import { createFrameHost, createRowHighlight, type FrameBarView, type FrameHost } from '@cg/host-kit/isolated/frame-host';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';
import type { TabRpcClient } from '@cg/platform';

/** The board's title on the bar. */
const TITLE: Readonly<Record<WorkboardFrameScreen, string>> = { report: 'Отчёт смены' };

export interface WorkboardFramesEnv {
  readonly win: Window;
  readonly rpc: TabRpcClient;
  readonly registry?: ShadowRootRegistry;
  /** The kit's token sheet. */
  readonly tokens: string;
  readonly scheme: ValueSignal<ColorScheme>;
  /** The site's finder of a sale's row on this page; null — not found. Absent — the site has none. */
  readonly findRow?: (sale: ReportSale) => Promise<Element | null>;
  /** How the site's own list shows a sale (the compare line's words and mark); null — the site says nothing. */
  readonly saleLook: SaleLook | null;
  readonly log: (message: string, fields: Readonly<Record<string, unknown>>) => void;
}

export interface WorkboardFrames {
  /** The launcher's «Отчёт» or the bar's button: the screen shows (made the first time). */
  open(screen: WorkboardFrameScreen): void;
  /** A find the background handed to this tab (another tab's «show on the site»). */
  find(sale: ReportSale): void;
  /** Said when the bar comes or goes (Fansly's corner card rises over it). */
  onBar(listener: (shown: boolean) => void): () => void;
  /** The bar's left edge (ChatSpace: right of its account rail). */
  inset(left: number): void;
  dispose(): void;
}

const chipOf = (state: ReportState): FrameBarView['chip'] => {
  if (state.chip.trim() === '') return null;
  const tone = state.phase === 'checking' ? 'wait' : state.phase === 'confirm' || state.phase === 'fixing' ? 'clay' : state.phase === 'counted' ? 'good' : 'plain';
  return { text: state.chip, tone };
};

export function createWorkboardFrames(env: WorkboardFramesEnv): WorkboardFrames {
  const { win, rpc } = env;
  const doc = win.document;
  const request = (type: string, payload: unknown, options?: { readonly timeoutMs?: number }): Promise<{ readonly ok: boolean; readonly payload?: unknown }> =>
    (rpc.request as unknown as (this: TabRpcClient, type: string, payload: unknown, options?: { readonly timeoutMs?: number }) => Promise<{ readonly ok: boolean; readonly payload?: unknown }>).call(rpc, type, payload, options);
  const highlight = createRowHighlight(doc, env.tokens, () => env.scheme.value);
  const hosts = new Map<WorkboardFrameScreen, FrameHost>();
  let origin: string | null = null;
  let state: ReportState | null = null;
  /** The compare line: a sale framed (or looked for) on the site, or a plain line; null — none. */
  let compare: FrameBarView['compare'] = null;
  let compared: ReportSale | null = null;
  let barLeft = 0;
  let barWas = false;
  const barListeners = new Set<(shown: boolean) => void>();
  /** Tells whoever listens whether a bar shows now (said on change only). */
  const sayBar = (): void => {
    const shown = [...hosts.values()].some((frame) => frame.barShown());
    if (shown === barWas) return;
    barWas = shown;
    for (const listener of [...barListeners]) listener(shown);
  };

  const barView = (screen: WorkboardFrameScreen): FrameBarView => ({
    title: TITLE[screen],
    chip: state === null ? null : chipOf(state),
    compare,
    sales: state === null ? null : salesWords(state.count, state.totalMills),
    button: compare === null ? 'Отчёт' : 'К отчёту',
  });
  const drawBar = (): void => {
    const report = hosts.get('report');
    // The bar shows while a board exists in this tab or a compare goes on here.
    if (report !== undefined) report.bar(barView('report'));
    else if (compare !== null)
      host('report').then(
        (made) => {
          made?.bar(barView('report'));
          sayBar();
        },
        () => undefined,
      );
    sayBar();
  };

  const originOf = async (): Promise<string | null> => {
    if (origin !== null) return origin;
    const answer = await request('report.state', {}).catch(() => null);
    const found = (answer?.payload as { readonly origin?: unknown } | undefined)?.origin;
    origin = typeof found === 'string' && /^https?:\/\/[^/]+$/.test(found) ? found : null;
    return origin;
  };

  const collapse = (screen: WorkboardFrameScreen): void => {
    const frame = hosts.get(screen);
    if (frame === undefined) return;
    frame.hide();
    frame.bar(barView(screen));
    sayBar();
  };

  const findHere = async (sale: ReportSale): Promise<void> => {
    compared = sale;
    const words = compareWords(sale, env.saleLook);
    compare = { page: words.page, rest: words.rest };
    drawBar();
    const row = env.findRow === undefined ? null : await env.findRow(sale).catch(() => null);
    if (compared !== sale) return;
    if (row === null) {
      highlight.clear();
      compare = { words: notFoundWords(sale) };
    } else {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      highlight.show(row);
    }
    drawBar();
    hosts.get('report')?.post({ t: 'found', transactionId: sale.transactionId, ok: row !== null, ...(row === null ? { words: notFoundWords(sale) } : {}) });
    env.log('report row', { found: row !== null, by: sale.platformRef === null ? 'time' : 'number' });
  };

  const onMessage = (screen: WorkboardFrameScreen, raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as Readonly<Record<string, unknown>>;
    const frame = hosts.get(screen);
    if (frame === undefined) return;
    switch (message['t']) {
      case 'fetch': {
        const id = message['id'];
        const method = message['method'];
        const path = message['path'];
        const body = message['body'] ?? null;
        if ((typeof id !== 'string' && typeof id !== 'number') || typeof method !== 'string' || typeof path !== 'string' || (body !== null && (typeof body !== 'string' || body.length > REPORT_FETCH_BODY_MAX))) {
          if (typeof id === 'string' || typeof id === 'number') frame.post({ t: 'fetch:result', id, error: 'refused' });
          return;
        }
        void request('frame.fetch', { screen, method, path, body }, { timeoutMs: 35_000 }).then(
          (answer) => frame.post({ t: 'fetch:result', id, ...(answer.ok ? (answer.payload as object) : { error: 'network' }) }),
          () => frame.post({ t: 'fetch:result', id, error: 'network' }),
        );
        return;
      }
      case 'state': {
        const parsed = ReportStateSchema.safeParse(message);
        if (!parsed.success) return;
        state = parsed.data;
        if (!frame.shown()) drawBar();
        return;
      }
      case 'collapse':
        collapse(screen);
        return;
      case 'find': {
        const parsed = ReportSaleSchema.safeParse(message['sale']);
        if (!parsed.success) return;
        const sale = parsed.data;
        collapse(screen);
        void request('report.find', { sale }).then(
          (answer) => {
            const where = (answer.payload as { readonly where?: unknown } | undefined)?.where;
            if (where === 'here' || !answer.ok) void findHere(sale);
            else if (where === 'tab') {
              // The other tab frames it and shows the bar there; this one keeps its own bar.
              compare = null;
              highlight.clear();
              drawBar();
            } else {
              compare = { words: openTabWords(sale.pageLabel) };
              drawBar();
            }
          },
          () => void findHere(sale),
        );
        return;
      }
      case 'copy': {
        const text = message['text'];
        if (typeof text !== 'string') return;
        void copy(text).then((ok) => frame.post({ t: 'copy:result', ok }));
        return;
      }
      case 'statement': {
        const pages = Array.isArray(message['pages']) ? message['pages'].filter((page): page is string => typeof page === 'string' && page !== '' && page.length <= 120).slice(0, 20) : [];
        void request('report.statement', { pages }).catch(() => undefined);
        return;
      }
      default:
        return;
    }
  };

  /** The clipboard: the click in the frame activated this page too; the old way where the browser refuses. */
  const copy = async (text: string): Promise<boolean> => {
    try {
      await win.navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = doc.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      doc.documentElement.append(area);
      area.select();
      let ok: boolean;
      try {
        ok = doc.execCommand('copy');
      } catch {
        ok = false;
      }
      area.remove();
      return ok;
    }
  };

  const host = async (screen: WorkboardFrameScreen): Promise<FrameHost | null> => {
    const made = hosts.get(screen);
    if (made !== undefined) return made;
    const teamOrigin = await originOf();
    if (teamOrigin === null) return null;
    const again = hosts.get(screen);
    if (again !== undefined) return again;
    const frame = createFrameHost({
      doc,
      ...(env.registry === undefined ? {} : { registry: env.registry }),
      origin: teamOrigin,
      url: `${teamOrigin}${workboardFramePath(screen)}`,
      tokens: env.tokens,
      scheme: () => env.scheme.value,
      onMessage: (message) => onMessage(screen, message),
      onConnected: () => env.log('frame port', { screen }),
      onEscape: () => collapse(screen),
      onBarButton: () => open(screen),
    });
    frame.inset(barLeft);
    hosts.set(screen, frame);
    return frame;
  };

  const open = (screen: WorkboardFrameScreen): void => {
    void host(screen).then((frame) => {
      if (frame === null) {
        env.log('frame not opened', { screen, reason: 'origin' });
        return;
      }
      const sale = compared;
      compare = null;
      compared = null;
      highlight.clear();
      frame.show();
      sayBar();
      frame.post({ t: 'show', ...(sale === null ? {} : { transactionId: sale.transactionId }) });
    });
  };

  const offScheme = env.scheme.subscribe(() => {
    for (const frame of hosts.values()) frame.scheme();
  });

  return {
    open,
    find(sale) {
      void findHere(sale);
    },
    onBar(listener) {
      barListeners.add(listener);
      return () => {
        barListeners.delete(listener);
      };
    },
    inset(left) {
      barLeft = left;
      for (const frame of hosts.values()) frame.inset(left);
    },
    dispose() {
      offScheme();
      highlight.clear();
      for (const frame of hosts.values()) frame.dispose();
      hosts.clear();
    },
  };
}
