// The keyboard-hint footer (ui-design §4.3 «Подвал клавиш», §10 SP-034, §12
// п. 1): «↑↓ часть · ↵ вставить · ⌘C копировать · Esc свернуть» under a
// result (and the same under the Spenders board), 12 px muted words with the
// keys in ink-2, a quiet small «Скрыть» on the right. Items marked
// `optional` hide on a narrow surface (≤ 600 px); the whole footer hides at
// ≤ 430 px, where «Скрыть» would otherwise run out of the dock (§12 п. 1).

import { type JSX } from 'preact';

import { Button } from './Button';

export interface KeyHint {
  /** As printed: «↑↓», «↵», «⌘C», «Esc». */
  readonly keys: string;
  readonly label: string;
  /** The first to go on a narrow surface («⌘C копировать»). */
  readonly optional?: boolean;
}

export interface KeysFooterProps {
  readonly hints: readonly KeyHint[];
  /** «Скрыть» with its tooltip; null hides the button (the board's footer keeps the hints). */
  readonly hide: { readonly label: string; readonly tooltip: string; readonly onHide: () => void } | null;
  /** Accessible name of the footer. */
  readonly label?: string;
}

export function KeysFooter({ hints, hide, label }: KeysFooterProps): JSX.Element {
  return (
    <div class="cg-keys" {...(label === undefined ? {} : { role: 'note', 'aria-label': label })}>
      {hints.map((hint) => (
        <span key={`${hint.keys}-${hint.label}`} class={`cg-key${hint.optional === true ? ' cg-key--x' : ''}`}>
          <kbd>{hint.keys}</kbd>
          {hint.label}
        </span>
      ))}
      {hide === null ? null : <Button label={hide.label} tooltip={hide.tooltip} variant="quiet" size="sm" class="cg-keys__hide" onClick={hide.onHide} />}
    </div>
  );
}

export const KEYS_FOOTER_CSS = `
.cg-keys {
  flex: none; display: flex; align-items: center; gap: 4px 14px; min-height: 30px; padding: 0 4px 0 12px;
  border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden;
}
.cg-keys kbd {
  display: inline-block; margin-right: 5px; padding: 0 4px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--cg-rule-3), 0 1px 0 var(--cg-rule-3);
  font-family: var(--cg-mono); font-size: var(--cg-text-2xs); line-height: 16px; letter-spacing: 0; color: var(--cg-ink-2);
}
.cg-keys__hide { margin-left: auto; }
@container cg (max-width: 600px) { .cg-key--x { display: none; } }
@container cg (max-width: 430px) { .cg-keys { display: none; } }
`;
