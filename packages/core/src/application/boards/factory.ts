// The R12 surface controllers as one set (architecture.md §16: R12 hands out
// factories; the integrator plugs them into the tab's AppClient router). One
// page context, one open-overlay state and one chat navigator are shared by
// the Spenders board and its statistics, the previews, «Новые» and the fan
// panel. The ports come from the tab's composition root; nothing here touches
// the browser, the network or ChatSpace's DOM.

import { type HostPort } from '@cg/contracts/host';
import { type I18n } from '@cg/contracts/vm';

import { type BoardHandover } from '../board-handover';
import { createFanPanelController, type FanPanelController } from '../fanpanel/controller';
import { createNewcomersController, type NewcomersController } from '../newcomers/controller';
import { createPreviewController, type PreviewController } from '../preview/controller';
import { createPaletteDirectory, type PaletteDirectory } from '../preview/palette';
import { createSpendersController, type SpendersController } from '../spenders/controller';
import { createPageContext, type PageContextPort } from './context';
import { createChatNavigator } from './navigate';
import { type BoardsClock, type BoardsNotifier, type ClipboardWriter, type Connectivity, type DraftStorePort, type IdSource, type PreviewSender, type RandomSource, type TabRpc } from './ports';
import { Surfaces } from './shared';
import { type SurfaceController } from './surface';

export interface BoardsDeps {
  /** The tab ↔ background protocol (@cg/platform `createTabRpcClient`). */
  readonly rpc: TabRpc;
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly clock: BoardsClock;
  readonly ids: IdSource;
  /** The tab side of the R10 send coordinator (`PreviewSendDriver` with its `onView` fanned out); absent — «Отправить» is unavailable. */
  readonly sender?: PreviewSender | null;
  /** `newcomers.drafts` of storage.local; absent — drafts live until the tab reloads. */
  readonly drafts?: DraftStorePort | null;
  readonly clipboard?: ClipboardWriter | null;
  /** Toasts for a surface that has just closed. */
  readonly notifier?: BoardsNotifier | null;
  /** §6.5: «Открыть и вставить» opened the chat — the dock of that chat goes on with the result. */
  readonly handover?: ((handover: BoardHandover) => void) | null;
  readonly connectivity?: Connectivity | null;
  readonly random?: RandomSource;
  /** IANA zone of the statistics' calendar; the browser's own when absent. */
  readonly timeZone?: string;
  /** A page context shared with other controllers of the tab; one is made when absent. */
  readonly context?: PageContextPort;
  /** Rows of one «ждут ответа» page of the Spenders board (100 by default). */
  readonly queuePageSize?: number;
  /** This tab watches for new subscribers while «Новые» is closed (the subscriber sound). */
  readonly watchForSound?: boolean;
  readonly onNewSubscribers?: (events: readonly { readonly eventRef: string; readonly fanRef: string }[]) => void;
}

export interface BoardsControllers {
  readonly spenders: SpendersController;
  readonly preview: PreviewController;
  readonly newcomers: NewcomersController;
  readonly fanPanel: FanPanelController;
  /** The fans ChatSpace shows online, for the palette's group (CS-030). */
  readonly palette: PaletteDirectory;
  /** Every controller, in the order the router offers them an action. */
  readonly controllers: readonly SurfaceController[];
  /** Which of these overlays are open: the composition root mounts and unmounts by it. */
  readonly surfaces: Surfaces;
  readonly context: PageContextPort;
  dispose(): void;
}

function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function createBoardsControllers(deps: BoardsDeps): BoardsControllers {
  const { rpc, host, i18n, clock, ids } = deps;
  const ownContext = deps.context === undefined;
  const context = deps.context ?? createPageContext({ rpc, host });
  const surfaces = new Surfaces();
  const navigator = createChatNavigator({ rpc, host, ids, context });

  const spenders = createSpendersController({
    rpc,
    i18n,
    clock,
    context,
    surfaces,
    navigator,
    timeZone: deps.timeZone ?? browserTimeZone(),
    ...(deps.queuePageSize === undefined ? {} : { queuePageSize: deps.queuePageSize }),
  });
  // The preview keeps the drafts and «Новые» shows whether a fan has one: the two meet through this late binding.
  const late: { preview: PreviewController | null } = { preview: null };
  const newcomers = createNewcomersController({
    rpc,
    host,
    i18n,
    clock,
    context,
    surfaces,
    navigator,
    connectivity: deps.connectivity ?? null,
    random: deps.random ?? Math.random,
    ...(deps.watchForSound === undefined ? {} : { watchForSound: deps.watchForSound }),
    ...(deps.onNewSubscribers === undefined ? {} : { onNewSubscribers: deps.onNewSubscribers }),
    draftOf: (pageId, fanRef) => late.preview?.draftOf('newcomers', pageId, fanRef) ?? null,
  });
  const rowOf = (pageId: number, fanRef: string) => spenders.row(pageId, fanRef);
  const rowsChanged = (listener: () => void): (() => void) => spenders.directory.subscribe(listener);
  const palette = createPaletteDirectory({ host, context, rowOf, rowsChanged });
  const preview = createPreviewController({
    rpc,
    host,
    i18n,
    clock,
    ids,
    context,
    surfaces,
    navigator,
    directories: { spenders: spenders.directory, newcomers: newcomers.directory, palette },
    greeting: newcomers.greeting,
    sender: deps.sender ?? null,
    drafts: deps.drafts ?? null,
    clipboard: deps.clipboard ?? null,
    notifier: deps.notifier ?? null,
    handover: deps.handover ?? null,
  });
  late.preview = preview;
  const offDrafts = preview.onDrafts(() => newcomers.draftsChanged());
  const fanPanel = createFanPanelController({ rpc, host, i18n, clock, context, surfaces, rowOf, rowsChanged });

  const controllers: readonly SurfaceController[] = [preview, spenders, newcomers, fanPanel] as readonly SurfaceController[];
  return {
    spenders,
    preview,
    newcomers,
    fanPanel,
    palette,
    controllers,
    surfaces,
    context,
    dispose() {
      offDrafts();
      for (const controller of controllers) controller.dispose();
      palette.dispose();
      surfaces.clear();
      if (ownContext) context.dispose();
    },
  };
}
