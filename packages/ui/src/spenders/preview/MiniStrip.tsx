// The mini strip of a preview (ui-design §4.16, §4.1; SP-055, AI-038): the
// goose, Reply · Fix · Hi · Ping (only Hi in «Новые») without key labels and
// without the persona, Tone and Split on the right. A click starts a
// generation from the hub's context of that fan; nothing here sends. The Ping
// button says which segment the hub put the fan in. The pane is 392–420 px
// wide, so the buttons are the dock's narrow ones (ui-design §3.3: 0 5, gap 4).

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type DockActionVM, type I18n, type PingSegmentVM, type PreviewActionId, type PreviewVM, type UiAction } from '@cg/contracts/vm';

import { CheckGlyph, Divider, GooseMark, Icon, Menu, MenuAnchor, StripButton, focusQuietly, menuTriggerKeys, rovingIndex, useDispatch, useHints, useI18n, type MenuItem } from '../../kit';

/** UI-002 order; the model says which of them this preview has. */
const ORDER: readonly PreviewActionId[] = ['reply', 'fix', 'hi', 'ping'];

const ACTION_KEYS: Readonly<Record<PreviewActionId, I18nKey>> = {
  reply: 'dock.action.reply',
  fix: 'dock.action.fix',
  hi: 'dock.action.hi',
  ping: 'dock.action.ping',
};

type Tone = NonNullable<PreviewVM['bar']['tone']>;

const TONE_KEYS: Readonly<Record<Tone, I18nKey>> = {
  casual: 'dock.tone.casual',
  flirty: 'dock.tone.flirty',
  upsell: 'dock.tone.upsell',
  spicy: 'dock.tone.spicy',
};

const NO_TONE = 'none';
const SEGMENT_LETTERS: Readonly<Partial<Record<PingSegmentVM['segment'], string>>> = { 'segment-a': 'A', 'segment-b': 'B' };

/** «Фан молчит 19 д, сегмент B»: what the hub computed with the generation's own window rules; unknown stays unknown. */
export function pingHint(i18n: I18n, ping: PingSegmentVM): string {
  const letter = SEGMENT_LETTERS[ping.segment];
  if (letter === undefined) return i18n.t(ping.segment === 'active' ? 'preview.ping.active' : 'preview.ping.unknown');
  if (ping.fanSilenceDays === null) return i18n.t('preview.ping.segmentNoDays', { segment: letter });
  return i18n.t('preview.ping.segment', { silence: i18n.t('common.age.days', { n: ping.fanSilenceDays }), segment: letter });
}

/** Starts a generation for the previewed fan. «Новые» greet with one variant; a tone belongs to Reply only. */
export function generateAction(vm: PreviewVM, feature: PreviewActionId, tone: Tone | null = vm.bar.tone): UiAction | null {
  if (vm.handle === null) return null;
  if (feature === 'reply' && tone !== null) return { type: 'Generate', targetHandle: vm.handle, feature, options: { tone } };
  if (feature === 'hi' && vm.from === 'newcomers') return { type: 'Generate', targetHandle: vm.handle, feature, options: { variants: 1 } };
  return { type: 'Generate', targetHandle: vm.handle, feature, options: {} };
}

function reasonText(i18n: I18n, action: string, vm: DockActionVM): string | null {
  if (vm.enabled) return null;
  return i18n.t('dock.action.unavailable', { action, reason: vm.reason === null ? i18n.t('common.unknown') : i18n.text(vm.reason.text) });
}

export interface MiniStripProps {
  readonly vm: PreviewVM;
  /** A hint at the Hi button (the «Новые» card: «AI ничего не отправляет сам…», NF-028). */
  readonly hiHint?: string | null;
}

export function MiniStrip({ vm, hiHint = null }: MiniStripProps): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  const barRef = useRef<HTMLDivElement>(null);
  const toneRef = useRef<HTMLButtonElement>(null);
  const [toneOpen, setToneOpen] = useState(false);
  const { bar } = vm;
  const ids = ORDER.filter((id) => bar.actions[id] !== undefined);
  const first = ids[0];
  const locked = bar.locked;

  const toneReason = locked
    ? i18n.t('dock.option.toneLocked')
    : bar.toneReason === null
      ? null
      : i18n.t('dock.option.toneUnavailable', { reason: i18n.text(bar.toneReason.text) });
  const splitReason = locked
    ? i18n.t('dock.option.splitLocked')
    : bar.splitReason === null
      ? null
      : i18n.t('dock.option.splitUnavailable', { reason: i18n.text(bar.splitReason.text) });

  const toneItems: MenuItem[] = [
    ...bar.tones.map((tone) => ({ id: tone, label: i18n.t(TONE_KEYS[tone]), checked: bar.tone === tone })),
    { id: NO_TONE, label: i18n.t('dock.option.toneNone'), checked: bar.tone === null },
  ];

  // One tab stop for the strip, arrows inside (ui-design §6.4).
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    const buttons = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-cg-strip] > button') ?? [])];
    const current = buttons.findIndex((button) => button === event.target);
    if (current < 0) return;
    const next = rovingIndex(event.key, current, buttons.length, 'horizontal');
    if (next === null || next === current) return;
    event.preventDefault();
    focusQuietly(buttons[next]);
  };

  const closeTone = useCallback(() => setToneOpen(false), []);
  const returnToTone = useCallback(() => toneRef.current, []);

  return (
    <div ref={barRef} class="cg-pvb" role="toolbar" aria-label={i18n.t('dock.label')} onKeyDown={onKeyDown}>
      <span class="cg-pvb__mark" aria-hidden="true">
        <GooseMark />
      </span>
      <div class="cg-pvb__acts">
        {ids.flatMap((id, index) => {
          const action = bar.actions[id];
          if (action === undefined) return [];
          const label = i18n.t(ACTION_KEYS[id]);
          const letter = id === 'ping' && vm.ping !== null ? SEGMENT_LETTERS[vm.ping.segment] : undefined;
          const start = generateAction(vm, id);
          return [
            index === 0 ? null : <Divider key={`d:${id}`} />,
            <span key={id} data-cg-strip={id} class="cg-pvb__slot">
              <StripButton
                label={label}
                active={action.active}
                busy={action.busy}
                reason={reasonText(i18n, label, action)}
                tooltip={id === 'ping' && vm.ping !== null ? pingHint(i18n, vm.ping) : id === 'hi' ? hiHint : null}
                tabIndex={id === first ? 0 : -1}
                trailing={letter === undefined ? null : <span class="cg-pvb__seg">{letter}</span>}
                onClick={() => {
                  if (start !== null) void dispatch(start);
                }}
              />
            </span>,
          ];
        })}
      </div>
      <div class="cg-pvb__opts">
        <MenuAnchor>
          <span data-cg-strip="tone" class="cg-pvb__slot">
            <StripButton
              label={bar.tone === null ? i18n.t('dock.option.tone') : i18n.t('dock.option.toneValue', { tone: i18n.t(TONE_KEYS[bar.tone]) })}
              reason={toneReason}
              tooltip={hints ? i18n.t('dock.option.toneMenuTitle') : null}
              haspopup="menu"
              expanded={toneOpen}
              tabIndex={-1}
              buttonRef={toneRef}
              trailing={locked ? <Icon name="lock" size={12} /> : null}
              onClick={() => setToneOpen((open) => !open)}
              onKeyDown={(event) => {
                if (toneReason === null && !toneOpen) menuTriggerKeys(event, () => setToneOpen(true));
              }}
            />
          </span>
          <Menu
            open={toneOpen}
            kind="radio"
            label={i18n.t('dock.option.toneMenuTitle')}
            caption={{ text: i18n.t('dock.option.toneMenuTitle') }}
            items={toneItems}
            align="end"
            placement="top"
            onClose={closeTone}
            returnFocusTo={returnToTone}
            onSelect={(id) => {
              if (vm.handle === null) return;
              const tone = bar.tones.find((value) => value === id) ?? null;
              const reply = bar.actions.reply;
              // Choosing a tone starts Reply in it (AI-005); «Без тона» only clears the one-off tone.
              const start = tone !== null && reply !== undefined && reply.enabled ? generateAction(vm, 'reply', tone) : null;
              void dispatch(start ?? { type: 'SetTone', targetHandle: vm.handle, tone });
            }}
          />
        </MenuAnchor>
        <Divider />
        <span data-cg-strip="split" class="cg-pvb__slot">
          <StripButton
            label={i18n.t('dock.option.split')}
            pressed={bar.split}
            reason={splitReason}
            tooltip={hints ? i18n.t('dock.option.splitTooltip', { hotkey: '' }).trim() : null}
            tabIndex={-1}
            leading={<CheckGlyph on={bar.split} />}
            trailing={locked ? <Icon name="lock" size={12} /> : null}
            onClick={() => void dispatch({ type: 'SetPreference', key: 'generation.split', value: !bar.split })}
          />
        </span>
      </div>
    </div>
  );
}

export const MINI_STRIP_CSS = `
.cg-pvb { display: flex; align-items: center; height: 36px; min-width: 0; }
.cg-pvb__mark { width: var(--cg-gutter); height: 36px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--cg-ink-2); }
.cg-pvb__acts { flex: none; display: flex; align-items: center; margin-left: -5px; }
.cg-pvb .cg-act { padding: 0 5px; gap: 4px; }
.cg-pvb__slot { display: inline-flex; flex: none; }
.cg-pvb__opts { display: flex; align-items: center; min-width: 0; margin-left: auto; padding-left: 8px; padding-right: 2px; }
.cg-pvb__opts > * { flex: none; }
.cg-pvb__seg { font-size: var(--cg-text-2xs); font-weight: 400; color: var(--cg-ink-muted); }
`;
