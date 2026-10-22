// The card of «Новые» as every site draws it (X59, X60; ui-design §3.6, §3.12): the old Fansly extension's card — the
// fan's picture, name and line under it, the way into the chat at the top right, what the site says of the fan, the
// conversation, the site's verdict, and the greeting: one field (the draft, in the serif of AI text, «AI» while it is a
// generation unchanged), «Сгенерировать», «Открыть и вставить» and «Отправить →», and under them where the last click
// stands. A site fills it from its own model (ChatSpace's preview, ./hub-card.tsx; a pass's card on Fansly,
// ui/hosts/fansly/newcomers): the look, the order and the keys are one.
//
// «Отправить →» is a click only, never a key; it goes off on the first click and stays off until the model says what
// happened — a double click never makes two sends. Enter on the card's own row (X55) asks the card here: «Сгенерировать»
// while the field is empty and it can run, the field otherwise.

import { createContext, type ComponentChildren, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type ActionReceipt, type UiAction } from '@cg/contracts/vm';

import { Button, TextField, focusQuietly, useDispatch, useHints, useTooltip } from '../kit';
import { useOwnEchoes } from '../spenders/ownEchoes';
import { NewcomerAvatar } from './frame';

// ── the window's hold of the card ──

/** What the window asks of the card on Enter of the card's own row, and what it does after a send went (X59). */
export interface CardKeys {
  handle: string;
  /** Enter: «Сгенерировать» while the field is empty and it can run, the field otherwise; null — the card has no greeting. */
  enter: (() => void) | null;
}

export interface CardHold {
  current: CardKeys | null;
  /** A send of the card went (its receipt took): the window may move on to the next draft of a batch. */
  sent: (handle: string) => void;
}

export const CardHoldContext = createContext<CardHold | null>(null);
const CardKeysContext = createContext<CardKeys | null>(null);

// ── the card ──

export interface NewcomerCardProps {
  readonly handle: string;
  readonly label: string;
  readonly name: string;
  /** The creator's own name for the fan, beside the name. */
  readonly custom?: string | null;
  /** The fan's picture as the site gives it; none — the initial. */
  readonly avatarUrl?: string | null;
  readonly meta: ComponentChildren;
  readonly metaTitle?: string;
  /** At the top right: the way into the fan's chat (`CardOpen`). */
  readonly open: ComponentChildren;
  /** Under the head: what the site says of the fan — the archive and that the chat stays unread; the bio, the proof. */
  readonly notes?: ComponentChildren;
  /** Between the conversation and the greeting: the site's verdict over the fan. */
  readonly verdict?: ComponentChildren;
  /** The greeting (`GreetingEditor`); null — none for this fan. */
  readonly greeting: ComponentChildren;
  readonly onKeyDown?: (event: TargetedKeyboardEvent<HTMLElement>) => void;
  /** The conversation (`.cg-feed`). */
  readonly children: ComponentChildren;
}

export function NewcomerCard({ handle, label, name, custom = null, avatarUrl = null, meta, metaTitle, open, notes, verdict, greeting, onKeyDown, children }: NewcomerCardProps): JSX.Element {
  const hold = useContext(CardHoldContext);
  const keys = useRef<CardKeys>({ handle, enter: null });
  keys.current.handle = handle;
  useLayoutEffect(() => {
    if (hold === null) return undefined;
    const own = keys.current;
    hold.current = own;
    return () => {
      if (hold.current === own) hold.current = null;
    };
  }, [hold]);
  return (
    <section class="cg-nc" aria-label={label} data-cg-card={handle} {...(onKeyDown === undefined ? {} : { onKeyDown })}>
      <header class="cg-nc__head">
        <NewcomerAvatar name={name} url={avatarUrl} size="card" />
        <div class="cg-nc__who">
          <h3 class="cg-nc__name">
            {name}
            {custom === null ? null : <span class="cg-nw__custom"> ({custom})</span>}
          </h3>
          <div class="cg-nc__meta cg-num" {...(metaTitle === undefined ? {} : { title: metaTitle })}>
            {meta}
          </div>
        </div>
        {open}
      </header>
      {notes}
      {children}
      {verdict}
      <CardKeysContext.Provider value={keys.current}>{greeting}</CardKeysContext.Provider>
    </section>
  );
}

/** The card's place while no fan is chosen: a spinner while the list loads, else what to do. */
export function NoCard({ label, loading, text }: { readonly label: string; readonly loading: ComponentChildren; readonly text: string | null }): JSX.Element {
  return (
    <section class="cg-nc cg-nc--none" aria-label={label}>
      <div class="cg-nc__empty">{loading ?? text}</div>
    </section>
  );
}

/**
 * «Открыть в Fansly ↗», «Открыть чат»: the way into the fan's chat at the card's top right — a link of the site (a new
 * tab, the window stays), or the site's own navigation by an action.
 */
export function CardOpen({ label, tooltip = null, href = null, action = null, reason = null }: { readonly label: string; readonly tooltip?: string | null; readonly href?: string | null; readonly action?: UiAction | null; readonly reason?: string | null }): JSX.Element {
  const hints = useHints();
  const dispatch = useDispatch();
  const tip = useTooltip(href !== null && hints ? tooltip : null);
  if (href !== null) {
    return (
      <>
        <a class="cg-nc__open" href={href} target="_blank" rel="noopener noreferrer" {...tip.props}>
          {label}
        </a>
        {tip.description}
      </>
    );
  }
  return <Button label={label} variant="quiet" size="sm" class="cg-nc__open" tooltip={tooltip} reason={reason} onClick={() => (action === null ? undefined : void dispatch(action))} />;
}

// ── the greeting ──

export interface EditorButton {
  readonly label: string;
  /** What a click dispatches; null — nothing (then `reason` says why). */
  readonly action: UiAction | null;
  /** Why it is off; null — it is on. */
  readonly reason: string | null;
  readonly busy?: boolean;
  readonly tooltip?: string | null;
}

export interface EditorSend extends EditorButton {
  /** The send's state as the model names it: a new one lifts the click's lock. */
  readonly state: string;
  /** The model's snapshot of what is sent (identity): a newer one after an accepted click lifts the lock too. */
  readonly stamp: unknown;
  /** After this send went the window may move on to the next draft of a batch (the last part of a greeting). */
  readonly last: boolean;
}

export interface GreetingModel {
  /** Whose text the field holds and of what (a fan's draft, a part of a result): another scope starts the field afresh. */
  readonly scope: string;
  readonly text: string;
  readonly label: string;
  readonly placeholder: string;
  readonly maxChars: number;
  /** The action of an edit; null — the field cannot be edited now (`locked` says why). */
  readonly edit: ((text: string) => UiAction) | null;
  readonly locked: string | null;
  /** The «AI» mark: the field holds a generation unchanged. */
  readonly ai: { readonly label: string; readonly tooltip: string } | null;
  /** Above the field, strong: the history changed after the draft. */
  readonly note: string | null;
  /** Above the field, quiet: which part of a greeting in parts the field holds. */
  readonly lead?: string | null;
  readonly generate: EditorButton;
  /** «Открыть и вставить»; null — this site has none for what the field holds. */
  readonly insert: EditorButton | null;
  readonly send: EditorSend;
  /** In the bar before «Отправить →»: the media picker's toggle. */
  readonly extra?: ComponentChildren;
  /** Under the bar: where the last click stands. */
  readonly state: ComponentChildren;
  /** Under it all: the media picker's panel. */
  readonly below?: ComponentChildren;
  /** `data-cg-greeting`: what the greeting is doing (for the tests and the journal). */
  readonly stage: string;
}

/** «Отправить →» with its own lock: off from the first click until the model says what happened (§6.7.7, lock 1). */
function SendButton({ send, onSent }: { readonly send: EditorSend; readonly onSent: () => void }): JSX.Element {
  const dispatch = useDispatch();
  const [locked, setLocked] = useState(false);
  const lock = useRef<{ readonly stamp: unknown; accepted: boolean } | null>(null);
  const latest = useRef(send.stamp);
  latest.current = send.stamp;
  const unlock = (): void => {
    lock.current = null;
    setLocked(false);
  };
  useEffect(unlock, [send.state]);
  useEffect(() => {
    const held = lock.current;
    if (held !== null && held.accepted && held.stamp !== send.stamp) unlock();
  }, [send.stamp]);
  const action = send.action;
  return (
    <Button
      label={send.label}
      variant="send"
      class="cg-nc__send"
      busy={send.busy === true || locked}
      tooltip={send.tooltip ?? null}
      reason={send.busy === true ? null : send.reason}
      onClick={() => {
        if (lock.current !== null || action === null || send.reason !== null) return;
        const held = { stamp: send.stamp, accepted: false };
        lock.current = held;
        setLocked(true);
        void dispatch(action).then((receipt: ActionReceipt | null) => {
          if (lock.current !== held) {
            if (receipt?.ok === true && send.last) onSent();
            return;
          }
          if (receipt === null || !receipt.ok) {
            unlock();
            return;
          }
          held.accepted = true;
          if (latest.current !== held.stamp) unlock();
          if (send.last) onSent();
        });
      }}
    />
  );
}

function BarButton({ button, variant, class: own }: { readonly button: EditorButton; readonly variant: 'line' | 'quiet'; readonly class: string }): JSX.Element {
  const dispatch = useDispatch();
  const action = button.action;
  return (
    <Button
      label={button.label}
      variant={variant}
      size="sm"
      class={own}
      busy={button.busy === true}
      tooltip={button.tooltip ?? null}
      reason={button.busy === true ? null : button.reason}
      onClick={() => (action === null ? undefined : void dispatch(action))}
    />
  );
}

/** The card's greeting: the field, «AI», «Сгенерировать», «Открыть и вставить», «Отправить →», where it stands. */
export function GreetingEditor({ model }: { readonly model: GreetingModel }): JSX.Element {
  const dispatch = useDispatch();
  const hold = useContext(CardHoldContext);
  const keys = useContext(CardKeysContext);
  const draft = useOwnEchoes(model.text, model.scope);
  const field = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const latest = useRef(model);
  latest.current = model;
  if (keys !== null) {
    keys.enter = () => {
      const now = latest.current;
      const start = now.generate.action;
      if (draft.latest().trim() === '' && start !== null && now.generate.reason === null && now.generate.busy !== true) void dispatch(start);
      else focusQuietly(field.current);
    };
  }
  useLayoutEffect(
    () => () => {
      if (keys !== null) keys.enter = null;
    },
    [keys],
  );
  const edit = model.edit;
  return (
    <div class="cg-nc__greet" data-cg-greeting={model.stage}>
      {model.note === null ? null : <div class="cg-nc__gnote is-strong">{model.note}</div>}
      {model.lead === null || model.lead === undefined ? null : <div class="cg-nc__gnote cg-num">{model.lead}</div>}
      <div class="cg-nc__field">
        <TextField
          value={draft.shown}
          label={model.label}
          placeholder={model.placeholder}
          multiline
          minHeight={72}
          maxHeight={180}
          maxLength={model.maxChars}
          inputRef={field}
          reason={edit === null ? model.locked : null}
          onValue={(typed) => {
            if (edit === null) return;
            const text = typed.slice(0, model.maxChars);
            draft.sent(text);
            void dispatch(edit(text));
          }}
        />
        {model.ai === null ? null : (
          <span class="cg-nc__ai" title={model.ai.tooltip}>
            {model.ai.label}
          </span>
        )}
      </div>
      <div class="cg-nc__gbar">
        <BarButton button={model.generate} variant="line" class="cg-nc__gen" />
        {model.insert === null ? null : <BarButton button={model.insert} variant="quiet" class="cg-nc__insert" />}
        <span class="cg-nw__grow" />
        {model.extra}
        <SendButton send={model.send} onSent={() => hold?.sent(keys?.handle ?? '')} />
      </div>
      {model.state}
      {model.below}
    </div>
  );
}

/** One line under the bar: a mark (a spinner, a dot, a tick), its words, and the code's line under them. */
export function GreetingState({ mark = null, strong = true, words = null, tail = null, children, code = null, class: own = '', attrs = {} }: { readonly mark?: ComponentChildren; readonly strong?: boolean; readonly words?: string | null; readonly tail?: ComponentChildren; readonly children?: ComponentChildren; readonly code?: string | null; readonly class?: string; readonly attrs?: Readonly<Record<string, string>> }): JSX.Element {
  return (
    <div class={`cg-nc__gst${own === '' ? '' : ` ${own}`}`} role="status" {...(code === null ? {} : { 'data-cg-code': code })} {...attrs}>
      {mark}
      {words === null ? null : strong ? <b>{words}</b> : <span>{words}</span>}
      {children}
      {tail === null ? null : <span class="cg-nc__gcode">{tail}</span>}
    </div>
  );
}
