// «Генерация» (architecture.md §9.4, §9.9; ST-090…ST-097): how many messages
// each group of features reads (Б5), Split by default, «Учитывать Recap» per
// feature (1.52.0), Coach's depth (2026-10-27), memory and
// its Recap, and debug mode. The deep window never exceeds what the hub
// takes: a larger one is cut when it is saved and the page says so. The
// field always shows the number that is stored: one stored above the hub's
// limit stays as it is, with a note that the hub takes less.

import { type JSX } from 'preact';

import { RECAP_READERS } from '@cg/contracts/features';
import { COACH_AUTO_RECAP, COACH_WINDOW_DEFAULT, SETTINGS_RANGES, type CoachAutoRecap } from '@cg/contracts/settings';
import { type GenerationBodyVM, type PreferenceKey, type UiAction } from '@cg/contracts/vm';

import { Checkbox, Segmented, useI18n } from '../../kit';
import { Card, Columns, Opt, useAct } from '../shared';
import { Stepper } from './controls';
import { Slot } from './slots';

type WindowKey = Extract<PreferenceKey, `generation.windows.${string}`>;

export function GenerationSection({ body, readOnly }: { readonly body: GenerationBodyVM; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const locked = readOnly ? i18n.t('cg.storageVersion.title') : null;
  /** A number is saved once the background confirmed it with a revision (ST-014): that is what a stepper's chip waits for. */
  const save = (action: UiAction): Promise<boolean> => act(action, { quiet: true }).then((receipt) => receipt?.ok === true && receipt.revision !== undefined);
  const deepMax = Math.min(SETTINGS_RANGES.windowDeep.max, Math.max(SETTINGS_RANGES.windowDeep.min, body.windows.deepMax ?? SETTINGS_RANGES.windowDeep.max));
  const windows: readonly { readonly key: WindowKey; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly step: number }[] = [
    { key: 'generation.windows.quick', label: i18n.t('settings.generation.windowQuick'), value: body.windows.quick, ...SETTINGS_RANGES.windowQuick, step: 5 },
    { key: 'generation.windows.ping', label: i18n.t('settings.generation.windowPing'), value: body.windows.ping, ...SETTINGS_RANGES.windowPing, step: 5 },
    { key: 'generation.windows.improve', label: i18n.t('settings.generation.windowImprove'), value: body.windows.improve, ...SETTINGS_RANGES.windowImprove, step: 5 },
    { key: 'generation.windows.deep', label: i18n.t('settings.generation.windowDeep'), value: body.windows.deep, min: SETTINGS_RANGES.windowDeep.min, max: deepMax, step: 100 },
  ];
  const recap: Readonly<Record<CoachAutoRecap, string>> = {
    off: i18n.t('settings.generation.coachAutoRecap.off'),
    short: i18n.t('settings.generation.coachAutoRecap.short'),
    full: i18n.t('settings.generation.coachAutoRecap.full'),
  };
  return (
    <Columns
      main={
        <Card title={i18n.t('settings.generation.windows')} lead={i18n.t('settings.generation.windowsHint')}>
          {windows.map((entry) => (
            <Opt key={entry.key} label={entry.label} hint={i18n.t('settings.generation.range', { min: entry.min, max: entry.max })}>
              <Stepper
                label={entry.label}
                value={entry.value}
                min={entry.min}
                max={entry.max}
                step={entry.step}
                reason={locked}
                savedAs={entry.key === 'generation.windows.deep' ? body.windows.savedAs : null}
                onChange={(value) => save({ type: 'SetPreference', key: entry.key, value })}
              />
              {entry.key === 'generation.windows.deep' && body.windows.deepMax !== null && body.windows.deepMax < SETTINGS_RANGES.windowDeep.max ? (
                <div class="pg-sub" data-pg-deep={entry.value > entry.max ? 'over' : 'clipped'}>
                  {entry.value > entry.max ? i18n.t('settings.generation.deepOver', { n: entry.value, max: body.windows.deepMax }) : i18n.t('settings.generation.deepClipped', { max: body.windows.deepMax })}
                </div>
              ) : null}
            </Opt>
          ))}
          {/* A site's own window (R20 P14b1): Fansly's Recap depth above 3000, when the hub takes more. */}
          <Slot name="generationWindows" />

          <Opt label={i18n.t('settings.generation.splitDefault')} hint={i18n.t('settings.generation.splitHint')}>
            <Checkbox
              label={i18n.t('settings.generation.splitDefault')}
              stateWord={i18n.t('settings.generation.on')}
              checked={body.split}
              size={14}
              reason={locked}
              onChange={(value) => void act({ type: 'SetPreference', key: 'generation.split', value }, { quiet: true })}
            />
          </Opt>

          {/* 1.52.0: where a chat's «с Recap» of each feature starts (its answer's head, Coach's «Учитывать Recap»). */}
          <Opt label={i18n.t('settings.generation.recapDefault')} hint={i18n.t('settings.generation.recapHint')}>
            <div class="pg-line">
              {RECAP_READERS.map((feature) => (
                <Checkbox
                  key={feature}
                  label={i18n.t(`dock.action.${feature}`)}
                  checked={body.recapBy?.[feature] !== false}
                  size={14}
                  reason={locked}
                  onChange={(value) => void act({ type: 'SetPreference', key: `generation.recapBy.${feature}`, value }, { quiet: true })}
                />
              ))}
            </div>
          </Opt>

          {/* X68: «Помнить тон в чате» is retired — a tone lasts for one Reply, as in the old extension. */}
        </Card>
      }
      aside={
        <>
          <Card title={i18n.t('dock.action.coach')}>
            {/* 2026-10-27: how many of the chat's latest messages Coach reads (its own since then, 300); the window changes it for one chat. */}
            <Opt label={i18n.t('settings.generation.coachWindow')} hint={i18n.t('settings.generation.coachWindowHint')}>
              <Stepper
                label={i18n.t('settings.generation.coachWindow')}
                value={body.coach.window ?? COACH_WINDOW_DEFAULT}
                min={SETTINGS_RANGES.coachWindow.min}
                max={Math.min(SETTINGS_RANGES.coachWindow.max, Math.max(SETTINGS_RANGES.coachWindow.min, body.windows.deepMax ?? SETTINGS_RANGES.coachWindow.max))}
                step={50}
                reason={locked}
                onChange={(value) => save({ type: 'SetPreference', key: 'generation.coach.window', value })}
              />
            </Opt>
            <Opt label={i18n.t('settings.generation.coachHistory')} hint={i18n.t('settings.generation.coachHistoryHint')}>
              <Stepper
                label={i18n.t('settings.generation.coachHistory')}
                value={body.coach.historyLimit}
                {...SETTINGS_RANGES.coachHistoryLimit}
                reason={locked}
                onChange={(value) => save({ type: 'SetPreference', key: 'generation.coach.historyLimit', value })}
              />
            </Opt>
            <Opt label={i18n.t('settings.generation.coachAutoRecap')} hint={i18n.t('settings.generation.coachAutoRecapHint')}>
              <Segmented
                label={i18n.t('settings.generation.coachAutoRecap')}
                size="md"
                value={body.coach.autoRecap}
                options={COACH_AUTO_RECAP.map((value) => ({ value, label: recap[value], reason: locked }))}
                onChange={(value) => void act({ type: 'SetPreference', key: 'generation.coach.autoRecap', value }, { quiet: true })}
              />
              {body.coach.autoRecap === 'full' ? <div class="pg-sub">{i18n.t('settings.generation.coachAutoRecapFullNote')}</div> : null}
            </Opt>
          </Card>
          <Card title={i18n.t('settings.generation.debugTitle')}>
            <Opt label={i18n.t('settings.generation.debug')} hint={i18n.t('settings.generation.debugHint')}>
              <Checkbox
                label={i18n.t('settings.generation.debug')}
                stateWord={i18n.t('settings.generation.on')}
                checked={body.debug.enabled}
                size={14}
                reason={locked}
                onChange={(value) => void act({ type: 'SetPreference', key: 'debug.enabled', value }, { quiet: true })}
              />
            </Opt>
            {body.debug.enabled ? (
              <Opt label={i18n.t('settings.generation.renderTrace')} hint={i18n.t('settings.generation.renderTraceHint')}>
                <Checkbox
                  label={i18n.t('settings.generation.renderTrace')}
                  stateWord={i18n.t('settings.generation.on')}
                  checked={body.debug.renderTrace}
                  size={14}
                  reason={locked}
                  onChange={(value) => void act({ type: 'SetPreference', key: 'debug.renderTrace', value }, { quiet: true })}
                />
              </Opt>
            ) : null}
          </Card>
        </>
      }
    />
  );
}
