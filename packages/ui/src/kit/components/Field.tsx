// Our text fields (ui-design §2.8, §4.14, §4.16, §4.19; SP-019): the search
// box, the preview's Fix draft, the Coach question. IME-safe: the DOM owns
// the text while the person types, nothing is emitted or overwritten during
// a composition, Enter never acts mid-composition. The search emits its query
// 150 ms after the last change (on compositionend for an IME), at once on
// Enter, and Esc clears it before anything else closes.

import { type JSX, type Ref, type TargetedCompositionEvent, type TargetedInputEvent, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

import { isComposing, isHeldKey } from '../focus';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export const SEARCH_DEBOUNCE_MS = 150;

type TextElement = HTMLInputElement | HTMLTextAreaElement;

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (ref === undefined || ref === null) return;
  if (typeof ref === 'function') ref(value);
  else ref.current = value;
}

interface ImeState {
  composing: boolean;
  /** What the field last reported, so Firefox's input after compositionend does not report twice. */
  emitted: string;
}

/**
 * Keeps a DOM text control in step with `value` without fighting the person:
 * an outside change is written only when it differs and no composition runs.
 */
function useImeSafeField(element: { current: TextElement | null }, value: string, emit: (value: string) => void) {
  const state = useRef<ImeState>({ composing: false, emitted: value });
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null || state.current.composing || node.value === value) return;
    const root = node.getRootNode() as Partial<DocumentOrShadowRoot>;
    const focused = root.activeElement === node;
    node.value = value;
    state.current.emitted = value;
    if (focused) node.setSelectionRange(value.length, value.length);
  }, [value, element]);
  const report = (next: string): void => {
    if (next === state.current.emitted) return;
    state.current.emitted = next;
    emit(next);
  };
  return {
    onInput: (event: TargetedInputEvent<TextElement>) => {
      if (state.current.composing || (event as unknown as InputEvent).isComposing) return;
      report(event.currentTarget.value);
    },
    onCompositionStart: () => {
      state.current.composing = true;
    },
    onCompositionEnd: (event: TargetedCompositionEvent<TextElement>) => {
      state.current.composing = false;
      report(event.currentTarget.value);
    },
    isComposingNow: () => state.current.composing,
    /** The field changed its own text (Esc cleared it): what it reports next is compared to this. */
    sync: (next: string) => {
      state.current.emitted = next;
    },
  };
}

export interface TextFieldProps {
  readonly value: string;
  /** Every settled change (never mid-composition). */
  readonly onValue: (value: string) => void;
  /** The accessible name. */
  readonly label: string;
  readonly placeholder?: string;
  /** A textarea that grows with its text up to `maxHeight`. */
  readonly multiline?: boolean;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly maxLength?: number;
  /** Enter without Shift, outside a composition (Coach: «↵ спросить, ⇧↵ новая строка»). */
  readonly onEnter?: () => void;
  /** Esc inside; return true when handled (then nothing else closes). */
  readonly onEscape?: () => boolean;
  readonly reason?: string | null;
  readonly inputRef?: Ref<TextElement>;
  readonly class?: string;
}

export function TextField(props: TextFieldProps): JSX.Element {
  const ref = useRef<TextElement | null>(null);
  const field = useImeSafeField(ref, props.value, props.onValue);
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const tip = useTooltip(unavailable ? (props.reason ?? null) : null);
  const grow = (): void => {
    const node = ref.current;
    if (node === null || props.multiline !== true) return;
    // The box around keeps its height while the field is measured at `auto`: else everything beside it gets that
    // moment's room, and a feed scrolled to its newest message is pushed off it for good.
    const holder = node.parentElement;
    const held = holder?.style.minHeight ?? '';
    if (holder !== null) holder.style.minHeight = `${holder.offsetHeight}px`;
    node.style.height = 'auto';
    const max = props.maxHeight ?? 240;
    node.style.height = `${Math.min(max, Math.max(props.minHeight ?? 0, node.scrollHeight))}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
    if (holder !== null) holder.style.minHeight = held;
  };
  useEffect(grow, [props.value]);

  const common = {
    class: `cg-field${props.multiline === true ? ' cg-field--area' : ''}${props.class === undefined ? '' : ` ${props.class}`}`,
    'aria-label': props.label,
    ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
    ...(props.maxLength === undefined ? {} : { maxLength: props.maxLength }),
    ...(unavailable ? { 'aria-disabled': 'true' as const, readOnly: true } : {}),
    ...tip.props,
    onInput: (event: TargetedInputEvent<TextElement>) => {
      field.onInput(event);
      grow();
    },
    onCompositionStart: field.onCompositionStart,
    onCompositionEnd: field.onCompositionEnd,
    onKeyDown: (event: TargetedKeyboardEvent<TextElement>) => {
      tip.props.onKeyDown(event);
      if (isComposing(event) || field.isComposingNow()) return;
      if (event.key === 'Enter' && !event.shiftKey && props.onEnter !== undefined) {
        event.preventDefault();
        // A held Enter asks once.
        if (!isHeldKey(event)) props.onEnter();
      } else if (event.key === 'Escape' && props.onEscape?.() === true) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
  const setRef = (node: TextElement | null): void => {
    ref.current = node;
    assignRef(props.inputRef, node);
  };
  return (
    <>
      {props.multiline === true ? (
        <textarea ref={setRef} rows={1} {...common} {...(props.minHeight === undefined ? {} : { style: { minHeight: `${props.minHeight}px` } })} />
      ) : (
        <input ref={setRef} type="text" {...common} />
      )}
      {tip.description}
    </>
  );
}

export interface SearchBoxProps {
  /** The query the view model holds (an outside reset clears the field). */
  readonly value: string;
  /** The settled query: 150 ms after the last change, on compositionend for an IME, at once on Enter and Esc. */
  readonly onQuery: (query: string) => void;
  readonly label: string;
  readonly placeholder: string;
  readonly debounceMs?: number;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly class?: string;
  /** Enter, after the query is sent: a list opens its top match (the old Fansly board). */
  readonly onEnter?: (query: string) => void;
  /** ↓ / ↑ in the field, with the query typed: the list takes the keys from here (1 — down, -1 — up); true — taken. */
  readonly onArrow?: (direction: 1 | -1, query: string) => boolean;
  /** The key that focuses the field, printed at its end («/»). */
  readonly hotkey?: string;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(props.value);
  const delay = props.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const send = (query: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (query === sent.current) return;
    sent.current = query;
    props.onQuery(query);
  };
  const field = useImeSafeField(ref, props.value, (query) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(query), delay);
  });
  useEffect(() => {
    // An outside change of the query (a reset of the filters) wins over typing still waiting for its 150 ms.
    if (props.value !== sent.current && timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    sent.current = props.value;
  }, [props.value]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <label class={`cg-search${props.class === undefined ? '' : ` ${props.class}`}`}>
      <Icon name="search" />
      <input
        ref={(node) => {
          ref.current = node;
          assignRef(props.inputRef, node);
        }}
        type="search"
        aria-label={props.label}
        placeholder={props.placeholder}
        autocomplete="off"
        spellcheck={false}
        onInput={field.onInput}
        onCompositionStart={field.onCompositionStart}
        onCompositionEnd={field.onCompositionEnd}
        onKeyDown={(event) => {
          if (isComposing(event) || field.isComposingNow()) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            send(event.currentTarget.value);
            if (!event.repeat) props.onEnter?.(event.currentTarget.value);
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && props.onArrow !== undefined) {
            send(event.currentTarget.value);
            if (props.onArrow(event.key === 'ArrowDown' ? 1 : -1, event.currentTarget.value)) event.preventDefault();
          } else if (event.key === 'Escape' && event.currentTarget.value !== '') {
            // Esc clears the search first; only an empty search lets Esc close the preview or the window.
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.value = '';
            field.sync('');
            send('');
          }
        }}
      />
      {props.hotkey === undefined ? null : <kbd class="cg-search__key" aria-hidden="true">{props.hotkey}</kbd>}
    </label>
  );
}

export { FIELD_CSS } from './field.css';
