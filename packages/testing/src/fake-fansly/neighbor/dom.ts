// E. FBuddy's DOM work on a creator's page (S5 §2.5, §2.7, §6.2 E), emulated
// from the page world (its effect on the DOM is the same as from its isolated
// world):
// - ONE MutationObserver on `document.body ?? documentElement` with
//   `{childList, subtree, attributes, attributeFilter: ["href"]}`; per record
//   `closest(union)` of the target and `querySelectorAll(union)` of each added
//   element with children; the queue runs after a 50-ms throttle in batches of
//   ≤ 32 targets and ≤ 8 ms; each target runs every feature it matches;
// - a full rescan on window `focus`, `pageshow` and `visibilitychange` to
//   visible; a theme observer on `<html>` that re-dresses every host;
// - the features: two hosts first in the top bar's `.right-side`; one badge
//   per inbox row (under the row's `.message-contact` grandparent); three
//   inline-flex widgets right after the composer's `.collapsable-actions` —
//   templates, emoji, translate — on every new composer, and the translate key
//   on its field; plain-DOM pin and translate entries in each message's
//   `.actions` (`width:auto`); the fan panel by `panel=`; the `<body>` layer;
//   `style#fb-fansly-style-fixes` and `style#fb-dynamic-tweaks-css`.
// Every mount checks first, so its own records end the loop: a feature that
// finds its node in place writes nothing.
// Not here: the wallet badge (the stand has no `app-wallet-balance`) and the
// inbox header menu (off by default: `showAutomatedMessageReadAction`).

import { EMOJI_TEXT, TEMPLATE_TEXT, insertAtCaret, type Translator } from './composer';
import { FBUDDY_IDS, type NeighborPanel } from './protocol';
import { DYNAMIC_TWEAKS, STYLE_FIXES } from './styles';
import type { NeighborUi } from './ui';
import { routeGroup } from './util';

export const THROTTLE_MS = 50;
export const BATCH_TARGETS = 32;
export const BATCH_MS = 8;
export const DESKTOP_PANEL_PX = 400;

export const NEIGHBOR_TAGS = {
  menu: 'fb-header-extension-button-ui',
  badges: 'fb-header-badges-ui',
  inboxBadge: 'fb-dm-earnings-badge-ui',
  templates: 'fb-text-templates-ui',
  emoji: 'fb-emoji-picker-ui',
  translate: 'fb-translate-button-ui',
  panelDesktop: 'fb-user-profile-panel-desktop-ui',
  panelMobile: 'fb-user-profile-panel-mobile-ui',
} as const;

const COMPOSER_WIDGETS = [NEIGHBOR_TAGS.templates, NEIGHBOR_TAGS.emoji, NEIGHBOR_TAGS.translate] as const;
const WIDGET_STYLE = 'display:inline-flex;margin-left:.25rem';

interface Feature {
  readonly name: string;
  readonly selector: string;
  mount(owner: Element): void;
}

export interface DomStats {
  records: number;
  batches: number;
  targets: number;
  rescans: number;
}

export interface DomOptions {
  readonly win: Window & typeof globalThis;
  readonly ui: NeighborUi;
  readonly panel: NeighborPanel;
  readonly translator: Translator;
}

const button = (doc: Document, label: string, onClick: () => void): HTMLButtonElement => {
  const element = doc.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
};

export class NeighborDom {
  readonly stats: DomStats = { records: 0, batches: 0, targets: 0, rescans: 0 };
  private readonly features: readonly Feature[];
  private readonly union: string;
  private readonly queue = new Set<Element>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private readonly onRescan = (event: Event): void => {
    if (event.type === 'visibilitychange' && this.doc.visibilityState !== 'visible') return;
    this.rescan();
  };

  constructor(private readonly options: DomOptions) {
    const features: Feature[] = [
      { name: 'route', selector: 'app-messages-route', mount: () => undefined },
      { name: 'top-bar', selector: 'app-nav-bar-top .nav-content-wrapper > .right-side', mount: (owner) => this.topBar(owner) },
      { name: 'inbox-row', selector: 'app-messaging-group', mount: (owner) => this.inboxRow(owner) },
      { name: 'composer', selector: 'app-group-message-input .collapsable-actions', mount: (owner) => this.composer(owner) },
      { name: 'message-actions', selector: 'app-group-message .actions', mount: (owner) => this.messageActions(owner) },
    ];
    if (options.panel === 'desktop') features.push({ name: 'panel-desktop', selector: 'app-messages-route .messages-wrapper', mount: (owner) => this.panelDesktop(owner) });
    if (options.panel === 'mobile') features.push({ name: 'panel-mobile', selector: 'app-messages-conversation-route > .message-content-header', mount: (owner) => this.panelMobile(owner) });
    this.features = features;
    this.union = features.map((feature) => feature.selector).join(', ');
  }

  private get doc(): Document {
    return this.options.win.document;
  }

  start(): void {
    const { win, ui } = this.options;
    const doc = this.doc;
    this.style(FBUDDY_IDS.styleFixes, STYLE_FIXES);
    this.style(FBUDDY_IDS.dynamicTweaks, DYNAMIC_TWEAKS);
    ui.bodyLayer();
    this.observer = new win.MutationObserver((records) => this.onRecords(records));
    this.observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    this.themeObserver = new win.MutationObserver(() => ui.retheme());
    this.themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    win.addEventListener('focus', this.onRescan);
    win.addEventListener('pageshow', this.onRescan);
    doc.addEventListener('visibilitychange', this.onRescan);
    this.rescan();
  }

  stop(): void {
    const { win } = this.options;
    this.observer?.disconnect();
    this.themeObserver?.disconnect();
    win.removeEventListener('focus', this.onRescan);
    win.removeEventListener('pageshow', this.onRescan);
    this.doc.removeEventListener('visibilitychange', this.onRescan);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }

  /** Targets waiting for a batch: its work is behind a 50-ms throttle, so a node it will mount on may not carry it yet. */
  get queued(): number {
    return this.queue.size;
  }

  /** The queue's work now, without the throttle (tests). */
  flushNow(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    while (this.queue.size > 0) this.flush();
  }

  rescan(): void {
    this.stats.rescans += 1;
    for (const element of this.doc.querySelectorAll(this.union)) this.queue.add(element);
    this.schedule();
  }

  private style(id: string, text: string): void {
    if (this.doc.getElementById(id) !== null) return;
    const style = this.doc.createElement('style');
    style.id = id;
    style.textContent = text;
    (this.doc.head ?? this.doc.documentElement).append(style);
  }

  private onRecords(records: readonly MutationRecord[]): void {
    this.stats.records += records.length;
    for (const record of records) {
      const target = record.target instanceof this.options.win.Element ? record.target : record.target.parentElement;
      const owner = target?.closest(this.union);
      if (owner !== null && owner !== undefined) this.queue.add(owner);
      for (const node of record.addedNodes) {
        if (!(node instanceof this.options.win.Element)) continue;
        if (node.matches(this.union)) this.queue.add(node);
        if (node.childElementCount > 0) for (const found of node.querySelectorAll(this.union)) this.queue.add(found);
      }
    }
    if (this.queue.size > 0) this.schedule();
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.flush();
      if (this.queue.size > 0) this.schedule();
    }, THROTTLE_MS);
  }

  private flush(): void {
    this.stats.batches += 1;
    const started = performance.now();
    let done = 0;
    for (const target of this.queue) {
      this.queue.delete(target);
      if (target.isConnected) for (const feature of this.features) if (target.matches(feature.selector)) feature.mount(target);
      done += 1;
      if (done >= BATCH_TARGETS || performance.now() - started >= BATCH_MS) break;
    }
    this.stats.targets += done;
  }

  // ── features ──

  private topBar(rightSide: Element): void {
    const [first, second] = [rightSide.children[0], rightSide.children[1]];
    if (first?.localName === NEIGHBOR_TAGS.menu && second?.localName === NEIGHBOR_TAGS.badges) return;
    for (const stale of rightSide.querySelectorAll(`:scope > ${NEIGHBOR_TAGS.menu}, :scope > ${NEIGHBOR_TAGS.badges}`)) stale.remove();
    const { ui } = this.options;
    const menu = ui.host({ tag: NEIGHBOR_TAGS.menu, feature: 'header-extension-button', key: 'menu', owner: rightSide, content: (root) => root.append(button(this.doc, 'FBuddy', () => undefined)) });
    const badges = ui.host({ tag: NEIGHBOR_TAGS.badges, feature: 'header-badges', key: 'badges', owner: rightSide });
    rightSide.prepend(menu, badges);
  }

  private inboxRow(row: Element): void {
    const place = row.querySelector('.message-contact')?.parentElement?.parentElement;
    if (place === null || place === undefined || place.querySelector(`:scope > ${NEIGHBOR_TAGS.inboxBadge}`) !== null) return;
    const groupId = /\/messages\/(\d+)/.exec(row.closest('a')?.getAttribute('href') ?? '')?.[1] ?? 'row';
    place.append(this.options.ui.host({ tag: NEIGHBOR_TAGS.inboxBadge, feature: 'dm-earnings-badge', key: groupId, owner: row }));
  }

  private composer(actions: Element): void {
    const composer = actions.parentElement;
    if (composer === null) return;
    const field = composer.querySelector<HTMLTextAreaElement>('textarea.message-input');
    if (field !== null) this.options.translator.attach(field);
    if (this.widgetsInPlace(actions)) return;
    for (const stale of composer.querySelectorAll(`:scope > ${COMPOSER_WIDGETS.join(', :scope > ')}`)) stale.remove();
    const { ui, translator } = this.options;
    const fieldOf = (): HTMLTextAreaElement | null => composer.querySelector<HTMLTextAreaElement>('textarea.message-input');
    const act = (run: (target: HTMLTextAreaElement) => void) => () => {
      const target = fieldOf();
      if (target !== null) run(target);
    };
    const widgets = [
      ui.host({ tag: NEIGHBOR_TAGS.templates, feature: 'text-templates', key: 'composer', owner: composer, style: WIDGET_STYLE, content: (root) => root.append(button(this.doc, 'Templates', act((target) => insertAtCaret(target, TEMPLATE_TEXT)))) }),
      ui.host({ tag: NEIGHBOR_TAGS.emoji, feature: 'emoji-picker', key: 'composer', owner: composer, style: WIDGET_STYLE, content: (root) => root.append(button(this.doc, '🙂', act((target) => insertAtCaret(target, EMOJI_TEXT)))) }),
      ui.host({ tag: NEIGHBOR_TAGS.translate, feature: 'translate-button', key: 'composer', owner: composer, style: WIDGET_STYLE, content: (root) => root.append(button(this.doc, 'Translate', act((target) => translator.translate(target)))) }),
    ];
    actions.after(...widgets);
  }

  /** Its three widgets stand right after the composer's actions, in order. */
  private widgetsInPlace(actions: Element): boolean {
    let node = actions.nextElementSibling;
    for (const tag of COMPOSER_WIDGETS) {
      if (node?.localName !== tag) return false;
      node = node.nextElementSibling;
    }
    return true;
  }

  private messageActions(actions: Element): void {
    if (actions.querySelector(':scope > .fb-pin-message') !== null) return;
    const pin = this.doc.createElement('div');
    pin.className = 'fb-pin-message';
    pin.textContent = '📌';
    const translate = this.doc.createElement('div');
    translate.className = 'fb-translate-message-entry';
    translate.textContent = 'Aa';
    actions.append(pin, translate);
    actions.classList.add('fb-message-actions-attached');
    if (actions instanceof this.options.win.HTMLElement) {
      actions.style.width = 'auto';
      actions.style.gap = '.25rem';
    }
  }

  private panelDesktop(wrapper: Element): void {
    const list = wrapper.querySelector<HTMLElement>(':scope > .messages-list-wrapper');
    if (list !== null && list.style.flexGrow !== '3') list.style.flexGrow = '3';
    if (wrapper.lastElementChild?.localName === NEIGHBOR_TAGS.panelDesktop) return;
    wrapper.querySelector(`:scope > ${NEIGHBOR_TAGS.panelDesktop}`)?.remove();
    wrapper.append(
      this.options.ui.host({ tag: NEIGHBOR_TAGS.panelDesktop, feature: 'user-profile-panel-desktop', key: 'panel', owner: wrapper, style: `display:block;flex:0 0 ${DESKTOP_PANEL_PX}px;width:${DESKTOP_PANEL_PX}px` }),
    );
  }

  /** At the END of the header, made anew for every chat (≤ 1200 px, S5 §2.5); never in `.content-header-sub-row`. */
  private panelMobile(header: Element): void {
    const group = routeGroup(this.options.win.location) ?? '';
    const last = header.lastElementChild;
    if (last?.localName === NEIGHBOR_TAGS.panelMobile && last.getAttribute('data-group') === group) return;
    header.querySelector(`:scope > ${NEIGHBOR_TAGS.panelMobile}`)?.remove();
    const node = this.options.ui.host({ tag: NEIGHBOR_TAGS.panelMobile, feature: 'user-profile-panel-mobile', key: group, owner: header, content: (root) => root.append(button(this.doc, 'Fan', () => undefined)) });
    node.setAttribute('data-group', group);
    header.append(node);
  }
}
