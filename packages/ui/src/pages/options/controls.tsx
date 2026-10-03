// Controls of the settings page (ui-design §4.24; ST-090…ST-096, ST-130):
// the message-window stepper, the volume slider, the «Вид ответа» choice
// cards, a picker and plain fields. A control only says what the person
// chose; whether it was saved is the save state's word, not the control's.

import { type JSX, type TargetedFocusEvent, type TargetedInputEvent, type TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type UiResultStyle } from '@cg/contracts/settings';

import { Button, Icon, Menu, MenuAnchor, menuTriggerKeys, useI18n, useTooltip, type MenuItem } from '../../kit';

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  /** The read-only barrier or a missing right: the control keeps focus and says why. */
  readonly reason?: string | null;
  /** A whole number inside [min, max]: what the person chose. */
  readonly onChange: (value: number) => void;
  /** The value the controller stored instead of the chosen one («сохранено как N», Б5). */
  readonly savedAs?: number | null;
}

/**
 * A number typed by hand or stepped with − and +. It is a text field on
 * purpose: the mouse wheel over it scrolls the page and never changes the
 * value (ST-094). What was typed is brought into range when the field is
 * left; if that changed it, the chip says what was saved.
 */
export function Stepper(props: StepperProps): JSX.Element {
  const i18n = useI18n();
  const step = props.step ?? 1;
  const [text, setText] = useState(String(props.value));
  const [chip, setChip] = useState<number | null>(null);
  const editing = useRef(false);
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const tip = useTooltip(unavailable ? (props.reason ?? null) : null);

  // The stored value shows unless the person is typing right now.
  useEffect(() => {
    if (!editing.current) setText(String(props.value));
  }, [props.value]);
  useEffect(() => {
    if (props.savedAs !== null && props.savedAs !== undefined) setChip(props.savedAs);
  }, [props.savedAs]);

  const clamp = (value: number): number => Math.min(props.max, Math.max(props.min, Math.round(value)));
  const commit = (raw: string): void => {
    editing.current = false;
    const typed = raw.trim();
    const parsed = /^\d{1,6}$/.test(typed) ? Number(typed) : Number.NaN;
    const next = Number.isNaN(parsed) ? props.value : clamp(parsed);
    setText(String(next));
    // What was typed is not what is kept: say so next to the field.
    setChip(typed !== '' && String(next) !== typed ? next : null);
    if (next !== props.value) props.onChange(next);
  };
  const stepBy = (direction: 1 | -1): void => {
    if (unavailable) return;
    const next = clamp(props.value + direction * step);
    editing.current = false;
    setChip(null);
    setText(String(next));
    if (next !== props.value) props.onChange(next);
  };

  return (
    <span class="pg-line">
      <span class="pg-step" role="group" aria-label={props.label}>
        <button type="button" class="pg-step__b" aria-label={i18n.t('settings.generation.less')} {...(unavailable || props.value <= props.min ? { 'aria-disabled': 'true' } : {})} onClick={() => stepBy(-1)}>
          −
        </button>
        <input
          class="pg-step__i"
          type="text"
          inputMode="numeric"
          autocomplete="off"
          aria-label={props.label}
          value={text}
          {...tip.props}
          {...(unavailable ? { readOnly: true, 'aria-disabled': 'true' } : {})}
          onInput={(event) => {
            editing.current = true;
            setChip(null);
            setText(event.currentTarget.value);
          }}
          onBlur={(event) => {
            tip.props.onBlur(event);
            if (editing.current) commit(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            tip.props.onKeyDown(event);
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(event.currentTarget.value);
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              stepBy(event.key === 'ArrowUp' ? 1 : -1);
            }
          }}
        />
        <button type="button" class="pg-step__b" aria-label={i18n.t('settings.generation.more')} {...(unavailable || props.value >= props.max ? { 'aria-disabled': 'true' } : {})} onClick={() => stepBy(1)}>
          +
        </button>
      </span>
      {tip.description}
      {chip === null ? null : (
        <span class="pg-chip" role="status">
          {i18n.t('settings.generation.savedAs', { n: chip })}
        </span>
      )}
    </span>
  );
}

export interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly reason?: string | null;
  readonly onChange: (value: number) => void;
}

/** The volume: 5–100 in steps of 5, the number next to the track (ST-130). */
export function Slider(props: SliderProps): JSX.Element {
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const [value, setValue] = useState(props.value);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setValue(props.value);
  }, [props.value]);
  return (
    <span class="pg-line">
      <input
        class="pg-range"
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={value}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        onInput={(event) => {
          if (unavailable) {
            event.currentTarget.value = String(props.value);
            return;
          }
          dragging.current = true;
          const next = Number(event.currentTarget.value);
          setValue(next);
          props.onChange(next);
        }}
        onChange={() => {
          dragging.current = false;
        }}
      />
      <span class="pg-range__v">{value}</span>
    </span>
  );
}

/** The miniature of the chat under a result: two bubbles, the result, the strip, the composer. */
function Miniature({ sheet }: { readonly sheet: boolean }): JSX.Element {
  return (
    <div class="pg-mini" aria-hidden="true">
      <i style={{ width: '46%' }} />
      <i style={{ width: '34%', alignSelf: 'flex-end' }} />
      <div class={`pg-mini__res${sheet ? ' is-sheet' : ''}`}>
        <i style={{ width: '80%' }} />
        <i style={{ width: '64%' }} />
        <i style={{ width: '72%' }} />
      </div>
      <div class="pg-mini__strip">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div class="pg-mini__comp" />
    </div>
  );
}

export interface StyleChoiceProps {
  readonly label: string;
  readonly value: UiResultStyle;
  readonly labels: Readonly<Record<UiResultStyle, string>>;
  readonly reason?: string | null;
  readonly onChange: (value: UiResultStyle) => void;
}

/** «Вид ответа»: a radiogroup of two cards with a picture of the panel in the chat (ST-124). */
export function StyleChoice(props: StyleChoiceProps): JSX.Element {
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const refs = useRef<Partial<Record<UiResultStyle, HTMLButtonElement | null>>>({});
  const order: readonly UiResultStyle[] = ['bare', 'sheet'];
  return (
    <div class="pg-choices" role="radiogroup" aria-label={props.label}>
      {order.map((style) => (
        <button
          key={style}
          type="button"
          role="radio"
          class="pg-choice"
          ref={(node) => {
            refs.current[style] = node;
          }}
          aria-checked={props.value === style ? 'true' : 'false'}
          tabIndex={props.value === style ? 0 : -1}
          {...(unavailable ? { 'aria-disabled': 'true' } : {})}
          onClick={() => {
            if (!unavailable && props.value !== style) props.onChange(style);
          }}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            const other: UiResultStyle = style === 'bare' ? 'sheet' : 'bare';
            refs.current[other]?.focus();
            if (!unavailable) props.onChange(other);
          }}
        >
          <Miniature sheet={style === 'sheet'} />
          <span class="pg-choice__t">
            <i class="pg-radio" />
            {props.labels[style]}
          </span>
        </button>
      ))}
    </div>
  );
}

export interface PickerProps {
  readonly label: string;
  /** What the button prints: the chosen item, or the words for «nothing chosen». */
  readonly text: string;
  readonly value: string | null;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly reason?: string | null;
  readonly onChange: (value: string) => void;
}

/** A button that opens a radio menu under it: the tone of a sound, the persona of a page. */
export function Picker(props: PickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = props.options.map((option) => ({ id: option.value, label: option.label, checked: option.value === props.value }));
  return (
    <MenuAnchor>
      <Button
        label={props.text}
        variant="line"
        class="pg-pick"
        buttonRef={trigger}
        haspopup="menu"
        expanded={open}
        tooltip={props.label}
        reason={props.reason ?? null}
        trailing={<Icon name="chevronDown" size={14} />}
        onClick={() => setOpen((before) => !before)}
        onKeyDown={(event) => {
          if (!open) menuTriggerKeys(event, () => setOpen(true));
        }}
      />
      <Menu open={open} kind="radio" label={props.label} items={items} placement="bottom" onSelect={(id) => props.onChange(id)} onClose={() => setOpen(false)} returnFocusTo={() => trigger.current} />
    </MenuAnchor>
  );
}

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly type?: 'text' | 'password';
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly autocomplete?: string;
  readonly wide?: boolean;
  readonly reason?: string | null;
  /** Every change of the text. */
  readonly onInput?: (value: string) => void;
  /** The field was left or Enter was pressed: the text as it stands. */
  readonly onCommit?: (value: string) => void;
  readonly onEnter?: () => void;
}

/**
 * A one-line field. The DOM keeps the text while the person types; a new
 * `value` from outside replaces it only when the field is not being edited,
 * so a save answer never fights the cursor.
 */
export function Field(props: FieldProps): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const tip = useTooltip(unavailable ? (props.reason ?? null) : null);
  useEffect(() => {
    const node = ref.current;
    if (node !== null && !editing.current && node.value !== props.value) node.value = props.value;
  }, [props.value]);
  const common = {
    ref,
    class: `cg-field pg-field${props.wide === true ? ' pg-field--wide' : ''}`,
    'aria-label': props.label,
    defaultValue: props.value,
    spellcheck: false,
    autocomplete: props.autocomplete ?? 'off',
    ...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
    ...(props.maxLength === undefined ? {} : { maxLength: props.maxLength }),
    ...(unavailable ? { readOnly: true, 'aria-disabled': 'true' as const } : {}),
    ...tip.props,
    onInput: (event: TargetedInputEvent<HTMLInputElement>) => {
      editing.current = true;
      props.onInput?.(event.currentTarget.value);
    },
    onBlur: (event: TargetedFocusEvent<HTMLInputElement>) => {
      tip.props.onBlur(event);
      if (!editing.current) return;
      editing.current = false;
      props.onCommit?.(event.currentTarget.value);
    },
    onKeyDown: (event: TargetedKeyboardEvent<HTMLInputElement>) => {
      tip.props.onKeyDown(event);
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      editing.current = false;
      props.onCommit?.(event.currentTarget.value);
      props.onEnter?.();
    },
  };
  return (
    <>
      {props.type === 'password' ? <input type="password" {...common} /> : <input type="text" {...common} />}
      {tip.description}
    </>
  );
}
