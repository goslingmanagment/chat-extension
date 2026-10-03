// «Генерация» (architecture.md §9.4, §9.9; ST-090…ST-097): how many messages
// each group of features reads (Б5), Split by default, Coach's memory and
// its Recap, and debug mode. The deep window never exceeds what the hub
// takes: a larger one is cut and the page says so.

import { type JSX } from 'preact';

import { COACH_AUTO_RECAP, SETTINGS_RANGES, type CoachAutoRecap } from '@cg/contracts/settings';
import { type GenerationBodyVM, type PreferenceKey } from '@cg/contracts/vm';

import { Checkbox, Segmented, useI18n } from '../../kit';
import { Opt, useAct } from '../shared';
import { Stepper } from './controls';

type WindowKey = Extract<PreferenceKey, `generation.windows.${string}`>;

export function GenerationSection({ body, readOnly }: { readonly body: GenerationBodyVM; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const locked = readOnly ? i18n.t('cg.storageVersion.title') : null;
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
    <>
      <h2 class="pg-h2">{i18n.t('settings.generation.windows')}</h2>
      <p class="pg-note" style={{ margin: 0 }}>
        {i18n.t('settings.generation.windowsHint')}
      </p>
      {windows.map((entry) => (
        <Opt key={entry.key} label={entry.label} hint={i18n.t('settings.generation.range', { min: entry.min, max: entry.max })}>
          <Stepper
            label={entry.label}
            value={Math.min(entry.value, entry.max)}
            min={entry.min}
            max={entry.max}
            step={entry.step}
            reason={locked}
            savedAs={entry.key === 'generation.windows.deep' ? body.windows.savedAs : null}
            onChange={(value) => void act({ type: 'SetPreference', key: entry.key, value }, { quiet: true })}
          />
          {entry.key === 'generation.windows.deep' && body.windows.deepMax !== null && body.windows.deepMax < SETTINGS_RANGES.windowDeep.max ? (
            <div class="pg-sub">{i18n.t('settings.generation.deepClipped', { max: body.windows.deepMax })}</div>
          ) : null}
        </Opt>
      ))}

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

      <h2 class="pg-h2">{i18n.t('dock.action.coach')}</h2>
      <Opt label={i18n.t('settings.generation.coachHistory')} hint={i18n.t('settings.generation.coachHistoryHint')}>
        <Stepper
          label={i18n.t('settings.generation.coachHistory')}
          value={body.coach.historyLimit}
          {...SETTINGS_RANGES.coachHistoryLimit}
          reason={locked}
          onChange={(value) => void act({ type: 'SetPreference', key: 'generation.coach.historyLimit', value }, { quiet: true })}
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

      <h2 class="pg-h2">{i18n.t('settings.generation.debugTitle')}</h2>
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
    </>
  );
}
