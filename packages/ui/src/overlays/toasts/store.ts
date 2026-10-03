// The UI's own toast queue behind ToastPort (architecture.md §9.5, §10.2 п. 6;
// ui-design §3.9, §4.22; ER-009…ER-015): a toast a surface raises itself — a
// render failure (CG-UI-FAILED), «Help пока убран». It lives 4.5 s, an error
// 6.5 s; a toast with the same code and scope replaces the earlier one; at
// most three stay, the newest first; hover or focus inside holds its timer.
// One timer per toast, none when the queue is empty. Toasts of operations and
// of the background come through the `toasts` view; the host draws both.

import { signal, type ReadonlySignal } from '@preact/signals';

import { type CgCode } from '@cg/contracts/errors';
import { type Msg, type ToastId, type ToastKind, type ToastPort, type ToastRequest } from '@cg/contracts/vm';

/** ui-design §4.22: how long a toast stays; errors longer. */
export const TOAST_LIFETIME_MS = { normal: 4500, error: 6500 } as const;
/** ui-design §3.9: at most three on screen. */
export const TOAST_LIMIT = 3;

export interface LocalToast {
  readonly id: ToastId;
  readonly kind: ToastKind;
  readonly code: CgCode | null;
  readonly scope: string;
  readonly title: Msg;
  readonly body: Msg | null;
  /** Epoch ms; null while held by hover or focus. */
  readonly expiresAt: number | null;
}

export interface ToastHost extends ToastPort {
  /** Newest first, at most TOAST_LIMIT. */
  readonly toasts: ReadonlySignal<readonly LocalToast[]>;
  /** Hover or focus inside a toast stops its countdown; leaving resumes what was left. */
  hold(id: ToastId, hold: boolean): void;
  /** Drops every toast and timer. */
  dispose(): void;
}

export interface ToastHostOptions {
  readonly now?: () => number;
}

interface Entry {
  toast: LocalToast;
  timer: ReturnType<typeof setTimeout> | null;
  /** Lifetime left when the hold began. */
  left: number;
}

/** Same code and scope replace each other (ER-009). */
const keyOf = (toast: Pick<ToastRequest, 'code' | 'scope'>): string => `${toast.code ?? 'none'}|${toast.scope}`;

export function createToastHost(options: ToastHostOptions = {}): ToastHost {
  const now = options.now ?? Date.now;
  const toasts = signal<readonly LocalToast[]>([]);
  let entries: Entry[] = [];
  let serial = 0;

  const publish = (): void => {
    toasts.value = entries.map((entry) => entry.toast);
  };
  const stop = (entry: Entry): void => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  };
  const remove = (id: ToastId): void => {
    const gone = entries.filter((entry) => entry.toast.id === id);
    if (gone.length === 0) return;
    for (const entry of gone) stop(entry);
    entries = entries.filter((entry) => entry.toast.id !== id);
    publish();
  };
  const arm = (entry: Entry, lifetime: number): void => {
    stop(entry);
    entry.toast = { ...entry.toast, expiresAt: now() + lifetime };
    entry.timer = setTimeout(() => remove(entry.toast.id), lifetime);
  };

  return {
    toasts,
    show(request) {
      const key = keyOf(request);
      for (const entry of entries.filter((item) => keyOf(item.toast) === key)) stop(entry);
      serial += 1;
      const entry: Entry = {
        toast: { id: `local-${serial}`, kind: request.kind, code: request.code, scope: request.scope, title: request.title, body: request.body, expiresAt: null },
        timer: null,
        left: 0,
      };
      const kept = [entry, ...entries.filter((item) => keyOf(item.toast) !== key)];
      for (const extra of kept.slice(TOAST_LIMIT)) stop(extra);
      entries = kept.slice(0, TOAST_LIMIT);
      arm(entry, request.kind === 'error' ? TOAST_LIFETIME_MS.error : TOAST_LIFETIME_MS.normal);
      publish();
      return entry.toast.id;
    },
    dismiss: remove,
    hold(id, hold) {
      const entry = entries.find((item) => item.toast.id === id);
      if (entry === undefined) return;
      if (hold) {
        if (entry.toast.expiresAt === null) return;
        entry.left = Math.max(0, entry.toast.expiresAt - now());
        stop(entry);
        entry.toast = { ...entry.toast, expiresAt: null };
      } else {
        if (entry.toast.expiresAt !== null) return;
        arm(entry, Math.max(1000, entry.left));
      }
      publish();
    },
    dispose() {
      for (const entry of entries) stop(entry);
      entries = [];
      publish();
    },
  };
}
