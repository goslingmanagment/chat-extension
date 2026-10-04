// Choices (ui-design §4.11, §4.14, §4.18, §4.24; §6.1, §6.4): the segmented
// control («Коротко | Полностью», the theme and language segments), the
// check box (Split, settings flags) and tabs (period tabs, fan panel tabs).
// Segments and Split are `aria-pressed` buttons; settings flags are
// `role="checkbox"`; tabs are a `tablist` with one tab stop and arrows.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';

import { focusQuietly, rovingIndex } from '../focus';
import { CheckGlyph } from './Icon';
import { useTooltip } from './Tooltip';

export interface ChoiceOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** Unavailable with a reason (aria-disabled, the reason in the tooltip). */
  readonly reason?: string | null;
}

export interface SegmentedProps<V extends string> {
  readonly label: string;
  readonly options: readonly ChoiceOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** `sm` — 22 px inside the result head (Recap); `md` — 28 px in the settings. */
  readonly size?: 'sm' | 'md';
}

export function Segmented<V extends string>(props: SegmentedProps<V>): JSX.Element {
  return (
    <span class={`cg-seg cg-seg--${props.size ?? 'sm'}`} role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <SegmentButton key={option.value} option={option} pressed={option.value === props.value} onPress={() => props.onChange(option.value)} />
      ))}
    </span>
  );
}

function SegmentButton<V extends string>({ option, pressed, onPress }: { readonly option: ChoiceOption<V>; readonly pressed: boolean; readonly onPress: () => void }): JSX.Element {
  const unavailable = option.reason !== null && option.reason !== undefined && option.reason !== '';
  const tip = useTooltip(unavailable ? (option.reason ?? null) : null);
  return (
    <>
      <button
        type="button"
        class="cg-seg__b"
        aria-pressed={pressed ? 'true' : 'false'}
        {...tip.props}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        onClick={() => {
          if (!unavailable && !pressed) onPress();
        }}
      >
        {option.label}
      </button>
      {tip.description}
    </>
  );
}

export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** `toggle` — an `aria-pressed` button (Split, ui-design §4.1); `checkbox` — `role="checkbox"` (settings). */
  readonly semantics?: 'toggle' | 'checkbox';
  /** 12 px in the strip, 14 px in the settings. */
  readonly size?: 12 | 14;
  readonly reason?: string | null;
  readonly tooltip?: string | null;
  /** «Включён» next to a settings flag, 500 ink-strong. */
  readonly stateWord?: string;
}

export function Checkbox(props: CheckboxProps): JSX.Element {
  const unavailable = props.reason !== null && props.reason !== undefined && props.reason !== '';
  const tip = useTooltip(unavailable ? (props.reason ?? null) : (props.tooltip ?? null));
  const toggle = (props.semantics ?? 'checkbox') === 'toggle';
  return (
    <>
      <button
        type="button"
        class={`cg-check cg-check--${props.size ?? 12}`}
        {...(toggle ? { 'aria-pressed': props.checked ? 'true' : 'false' } : { role: 'checkbox', 'aria-checked': props.checked ? 'true' : 'false' })}
        {...(props.stateWord === undefined ? {} : { 'aria-label': props.label })}
        {...tip.props}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        onClick={() => {
          if (!unavailable) props.onChange(!props.checked);
        }}
      >
        <CheckGlyph on={props.checked} size={props.size ?? 12} />
        <span class="cg-check__t">{props.stateWord ?? props.label}</span>
      </button>
      {tip.description}
    </>
  );
}

export interface TabsProps<V extends string> {
  readonly label: string;
  readonly tabs: readonly ChoiceOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** id prefix of the panels the tabs control (`${idPrefix}-${value}`), when there are panels. */
  readonly idPrefix?: string;
}

/**
 * Tabs (28 px, radius 8): one tab stop, ← → / Home End move and select
 * (§6.4). An unavailable tab (`reason`) is aria-disabled and says why in its
 * tooltip: arrows still move focus onto it, so the reason is heard, but
 * neither arrows nor a click select it.
 */
export function Tabs<V extends string>(props: TabsProps<V>): JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    const elements = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const focused = elements.findIndex((element) => element === event.target);
    const current = focused >= 0 ? focused : props.tabs.findIndex((tab) => tab.value === props.value);
    const next = rovingIndex(event.key, current, props.tabs.length, 'horizontal');
    if (next === null || next === current) return;
    event.preventDefault();
    const target = props.tabs[next];
    if (target === undefined) return;
    if (!isUnavailable(target) && target.value !== props.value) props.onChange(target.value);
    focusQuietly(elements[next]);
  };
  return (
    <div ref={listRef} class="cg-tabs" role="tablist" aria-label={props.label} onKeyDown={onKeyDown}>
      {props.tabs.map((tab) => (
        <TabButton
          key={tab.value}
          tab={tab}
          selected={tab.value === props.value}
          {...(props.idPrefix === undefined ? {} : { idPrefix: props.idPrefix })}
          onSelect={() => props.onChange(tab.value)}
        />
      ))}
    </div>
  );
}

function isUnavailable(option: ChoiceOption<string>): boolean {
  return option.reason !== null && option.reason !== undefined && option.reason !== '';
}

function TabButton<V extends string>({
  tab,
  selected,
  idPrefix,
  onSelect,
}: {
  readonly tab: ChoiceOption<V>;
  readonly selected: boolean;
  readonly idPrefix?: string;
  readonly onSelect: () => void;
}): JSX.Element {
  const unavailable = isUnavailable(tab);
  const tip = useTooltip(unavailable ? (tab.reason ?? null) : null);
  return (
    <>
      <button
        type="button"
        role="tab"
        class="cg-tab"
        aria-selected={selected ? 'true' : 'false'}
        tabIndex={selected ? 0 : -1}
        {...(idPrefix === undefined ? {} : { id: `${idPrefix}-tab-${tab.value}`, 'aria-controls': `${idPrefix}-${tab.value}` })}
        {...tip.props}
        {...(unavailable ? { 'aria-disabled': 'true' } : {})}
        onClick={() => {
          if (!selected && !unavailable) onSelect();
        }}
      >
        {tab.label}
      </button>
      {tip.description}
    </>
  );
}

export const CHOICE_CSS = `
.cg-seg { display: inline-flex; align-items: center; flex: none; padding: 2px; border-radius: 7px; box-shadow: inset 0 0 0 1px var(--cg-rule-2); }
.cg-seg__b { height: 22px; padding: 0 8px; border-radius: 5px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; }
.cg-seg--md { border-radius: var(--cg-r-md); }
.cg-seg--md .cg-seg__b { height: 28px; padding: 0 12px; border-radius: var(--cg-r-sm); font-size: inherit; }
.cg-seg__b:hover { color: var(--cg-ink); }
.cg-seg__b[aria-pressed="true"] { background: var(--cg-seg-on); color: var(--cg-ink-strong); font-weight: 500; }
.cg-seg__b[aria-disabled="true"] { color: var(--cg-ink-faint); cursor: default; }
.cg-check {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 7px; flex: none; border-radius: var(--cg-r-sm);
  color: var(--cg-ink-2); font-weight: 500; white-space: nowrap;
}
.cg-check[aria-pressed="true"], .cg-check[aria-checked="true"] { color: var(--cg-ink-strong); }
.cg-check:hover { background: var(--cg-hover); color: var(--cg-ink-strong); }
.cg-check[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
.cg-check--14 { gap: 8px; height: 28px; padding: 0; }
.cg-check--14:hover { background: none; }
.cg-tabs { display: flex; align-items: center; gap: 2px; min-width: 0; }
.cg-tab { height: 28px; padding: 0 10px; border-radius: var(--cg-r-md); color: var(--cg-ink-muted); white-space: nowrap; flex: none; }
.cg-tab:hover { background: var(--cg-hover); color: var(--cg-ink); }
.cg-tab[aria-selected="true"] { background: var(--cg-hover); color: var(--cg-ink-strong); font-weight: 500; }
.cg-tab[aria-disabled="true"] { color: var(--cg-ink-faint); background: none; cursor: default; }
`;
