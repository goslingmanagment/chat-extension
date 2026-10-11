// The mini strip of a preview (ui-design §4.16, §4.1; SP-055, AI-038): the
// goose, Reply · Fix · Hi · Ping (only Hi in «Новые») as the dock's chips,
// without key labels and without the persona, and the capsule of options —
// the four tones and Split — right after Reply (on the right where a preview
// has no Reply). A click starts a generation from the hub's context of that
// fan; nothing here sends. The Ping chip says which segment the hub put the
// fan in. The pane is 392–420 px wide, so the chips are the dock's narrow
// ones.

import { Fragment, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useRef } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type DockActionVM, type I18n, type PingSegmentVM, type PreviewActionId, type PreviewVM, type UiAction } from '@cg/contracts/vm';

import { CheckGlyph, GooseMark, Icon, StripButton, focusQuietly, rovingIndex, useDispatch, useHints, useI18n } from '../../kit';

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

/** The tones in the chatters' own language, as in the dock's capsule. */
const TONE_EMOJI: Readonly<Record<Tone, string>> = { casual: '😌', flirty: '😏', upsell: '💰', spicy: '🔥' };
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

  const chooseTone = (tone: Tone): void => {
    if (vm.handle === null) return;
    const reply = bar.actions.reply;
    // A second click on the chosen tone only takes it off (AI-006); another tone starts Reply in it (AI-005).
    const start = tone !== bar.tone && reply !== undefined && reply.enabled ? generateAction(vm, 'reply', tone) : null;
    void dispatch(start ?? { type: 'SetTone', targetHandle: vm.handle, tone: tone === bar.tone ? null : tone });
  };
  const capsule = (
    <span class="cg-tones">
      <span class="cg-tones__track" role="group" aria-label={i18n.t('dock.option.tone')} data-cg-strip="tone">
        {bar.tones.map((tone) => {
          const name = i18n.t(TONE_KEYS[tone]);
          return (
            <StripButton
              key={tone}
              label={name}
              class="cg-opt cg-tone"
              pressed={bar.tone === tone}
              reason={toneReason}
              tooltip={hints ? `${TONE_EMOJI[tone]} ${i18n.t('dock.option.toneValue', { tone: name })}\n${i18n.t(`dock.hint.tone.${tone}`)}` : null}
              tabIndex={-1}
              leading={
                <span class="cg-tone__e" aria-hidden="true">
                  {TONE_EMOJI[tone]}
                </span>
              }
              onClick={() => chooseTone(tone)}
            />
          );
        })}
      </span>
      <span class="cg-tones__seam" aria-hidden="true" />
      <span data-cg-strip="split" class="cg-pvb__slot">
        <StripButton
          label={i18n.t('dock.option.split')}
          class="cg-opt cg-split"
          pressed={bar.split}
          reason={splitReason}
          tooltip={hints ? `${i18n.t('dock.option.splitTooltip', { hotkey: '' }).trim()}\n${i18n.t('dock.hint.split')}` : null}
          tabIndex={-1}
          leading={<CheckGlyph on={bar.split} />}
          onClick={() => void dispatch({ type: 'SetPreference', key: 'generation.split', value: !bar.split })}
        />
      </span>
      {locked ? <Icon name="lock" size={12} class="cg-lock" /> : null}
    </span>
  );

  return (
    <div ref={barRef} class="cg-pvb" role="toolbar" aria-label={i18n.t('dock.label')} onKeyDown={onKeyDown}>
      <span class="cg-pvb__mark" aria-hidden="true">
        <GooseMark />
      </span>
      <div class="cg-pvb__acts">
        {ids.flatMap((id) => {
          const action = bar.actions[id];
          if (action === undefined) return [];
          const label = i18n.t(ACTION_KEYS[id]);
          const letter = id === 'ping' && vm.ping !== null ? SEGMENT_LETTERS[vm.ping.segment] : undefined;
          const start = generateAction(vm, id);
          return [
            <span key={id} data-cg-strip={id} class="cg-pvb__slot">
              <StripButton
                label={label}
                {...(id === first ? { class: 'cg-act--main' } : {})}
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
            // The capsule is Reply's own: right after it, as in the dock.
            id === 'reply' ? <Fragment key="capsule">{capsule}</Fragment> : null,
          ];
        })}
      </div>
      {bar.actions.reply === undefined ? <div class="cg-pvb__opts">{capsule}</div> : null}
    </div>
  );
}

export const MINI_STRIP_CSS = `
.cg-pvb { display: flex; align-items: center; gap: 3px; height: 38px; min-width: 0; padding: 0 5px 0 0; }
.cg-pvb__mark { width: 30px; height: 28px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--cg-clay); }
.cg-pvb__acts { flex: none; display: flex; align-items: center; gap: 3px; }
.cg-pvb .cg-act:not(.cg-opt) { padding: 0 7px; gap: 4px; }
.cg-pvb .cg-opt { width: 24px; }
.cg-pvb .cg-split .cg-act__t { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.cg-pvb .cg-split { padding: 0; }
.cg-pvb__slot { display: inline-flex; flex: none; }
.cg-pvb__opts { display: flex; align-items: center; min-width: 0; margin-left: auto; }
.cg-pvb__seg { font-size: var(--cg-text-2xs); font-weight: 500; color: var(--cg-ink-muted); }
`;
