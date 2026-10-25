// «Кому» of «Рассылка»: the button names who the outreach is for («Whale, Top и Prime · 1 условие»), the panel under it
// holds the tiers with their fans and the conditions over them — «Потратил больше $…», «Писал или покупал за 7 дней»,
// «Не купил это видео» (only with a paid medium the site can tell of), «Без тех, кто ждёт ответа» — each with what it
// does to the list, and at its foot the live count. Once the versions are written who is in no longer changes: the
// button says so and opens nothing.

import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type OutreachConditionNoteVM, type OutreachConditionVM, type OutreachWindowVM } from '@cg/contracts/vm';

import { Button, CheckGlyph, Icon, useDispatch, useI18n, useKit } from '../kit';
import { audienceLabel, namesText, tierWords } from './words';

const CONDITION_KEYS = {
  spent: 'outreach.condition.spent',
  active: 'outreach.condition.active',
  notBought: 'outreach.condition.notBought',
  noWaiting: 'outreach.condition.noWaiting',
} as const satisfies Record<OutreachConditionVM['id'], string>;

/** The offer's paid media are one video: «Не купил это видео». */
function onlyVideo(vm: OutreachWindowVM): boolean {
  const paid = vm.media === null || vm.media.priceCents === 0 ? [] : vm.media.items.filter((item) => !item.free);
  return paid.length === 1 && paid[0]?.type === 'video';
}

/** Under a condition: whom it leaves out, or why it cannot tell yet. */
function noteText(i18n: ReturnType<typeof useI18n>, note: OutreachConditionNoteVM): string {
  switch (note.kind) {
    case 'bought':
      return i18n.plural('outreach.note.bought', note.fans.names.length + note.fans.more, { names: namesText(i18n, note.fans) });
    case 'none-bought':
      return i18n.t('outreach.note.noneBought');
    case 'checking':
      return i18n.t('outreach.note.checking');
    case 'unknown':
      return i18n.t('outreach.note.unknown');
    case 'waiting':
      return i18n.plural('outreach.note.waiting', note.fans.names.length + note.fans.more, { names: namesText(i18n, note.fans) });
    case 'none-waiting':
      return i18n.t('outreach.note.noneWaiting');
  }
}

function Item({ on, label, note, onToggle, children }: { readonly on: boolean; readonly label: string; readonly note?: string | null; readonly onToggle: () => void; readonly children?: JSX.Element | null }): JSX.Element {
  return (
    <div class={`cg-ow__pi${on ? ' is-on' : ''}`}>
      <button type="button" class="cg-ow__pib" role="checkbox" aria-checked={on ? 'true' : 'false'} onClick={onToggle}>
        <CheckGlyph on={on} size={14} />
        <span>
          {label}
          {note === null || note === undefined ? null : <small>{note}</small>}
        </span>
      </button>
      {children ?? null}
    </div>
  );
}

/** «Потратил больше [1,000]»: the amount as typed, sent as it settles. */
function Amount({ value }: { readonly value: string }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      class="cg-field cg-ow__minin cg-num"
      inputMode="decimal"
      value={text}
      aria-label={i18n.t('outreach.condition.amount')}
      onInput={(event) => {
        const next = event.currentTarget.value.slice(0, 16);
        setText(next);
        void dispatch({ type: 'SetOutreach', condition: { id: 'spent', amount: next } });
      }}
    />
  );
}

export function Audience({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const audience = vm.audience;
  const locked = audience.locked;

  // A press outside the panel closes it; Esc closes it before anything else of the window.
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: Event): void => {
      const path = event.composedPath();
      if (box.current !== null && !path.includes(box.current)) setOpen(false);
    };
    root.addEventListener('pointerdown', away, true);
    return () => root.removeEventListener('pointerdown', away, true);
  }, [open, root]);
  useEffect(() => {
    if (locked) setOpen(false);
  }, [locked]);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>('.cg-ow__pib')?.focus();
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <span
      class="cg-nw__period-box cg-ow__kom"
      ref={box}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span class="cg-nw__label">{i18n.t('outreach.audience.lead')}</span>
      <Button
        label={audienceLabel(i18n, audience)}
        variant="quiet"
        class="cg-choice cg-ow__komb"
        haspopup="dialog"
        expanded={open}
        buttonRef={button}
        reason={locked ? i18n.t('outreach.audience.locked') : null}
        trailing={<Icon name="chevronDown" size={14} />}
        onClick={() => {
          if (!locked) setOpen((value) => !value);
        }}
      />
      {open ? (
        <div class="cg-ow__pop" role="dialog" aria-label={i18n.t('outreach.audience.lead')}>
          {audience.source === 'picked' ? (
            <div class="cg-ow__popnote">{i18n.plural('outreach.audience.pickedNote', audience.picked)}</div>
          ) : null}
          <div class="cg-ow__poph">{i18n.t('outreach.audience.tiers')}</div>
          {audience.tiers.map((tier) => (
            <Item key={tier.id} on={tier.on} label={tierWords(i18n, tier.range)} onToggle={() => void dispatch({ type: 'SetOutreach', tier: { id: tier.id, on: !tier.on } })}>
              <i class="cg-num">{tier.fans}</i>
            </Item>
          ))}
          <div class="cg-ow__poph">{i18n.t('outreach.audience.conditionsHead')}</div>
          {audience.conditions.map((condition) => (
            <Item
              key={condition.id}
              on={condition.on}
              label={i18n.t(condition.id === 'notBought' && onlyVideo(vm) ? 'outreach.condition.notBoughtVideo' : CONDITION_KEYS[condition.id])}
              note={condition.note === null ? null : noteText(i18n, condition.note)}
              onToggle={() => void dispatch({ type: 'SetOutreach', condition: { id: condition.id, on: !condition.on } })}
            >
              {condition.id === 'spent' ? <Amount value={condition.amount ?? ''} /> : null}
            </Item>
          ))}
          <div class="cg-ow__popf">
            <b>{i18n.t('outreach.line.count', { n: audience.count })}</b>
            {audience.spent === null || audience.spent === 0 ? null : ` · ${i18n.t('outreach.line.spent', { money: i18n.formatMoneyMills(audience.spent) })}`}
          </div>
        </div>
      ) : null}
    </span>
  );
}
