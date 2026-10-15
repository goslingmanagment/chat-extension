// @cg/ui/hosts/fansly/pages — Fansly on the settings page (R20 P14b1; docs/project-unite/architecture.md §1.5, §1.7,
// §4; FS-SET-1, FS-PERM-1; ST-012, ST-067…ST-079). A site's own parts of the shared sections (ui/pages/options/
// slots.tsx), drawn from Fansly's control (core application/hosts/fansly/pages.ts) in the pages' identity (X32): the
// shared cards, rows and controls — nothing of a look of its own.
//
// - «Аккаунты»: Fansly's card above the groups — «Включить Fansly», the tabs (open, waiting for a reload with
//   «Перезагрузить вкладки», «без атрибуции»), «Fansly через вкладку». Its models are rows of the shared groups.
// - The sign-in screen: the same card without the settings — Fansly is switched on before the first sign-in too.
// - «Вид и звук»: the tones on Fansly (messages, subscribers) with «Проверить»; on, volume and muted models are shared.
// - «Генерация»: the Recap depth on Fansly above 3000, only when the hub takes more than 3000.
// - The first run: Fansly's three steps under the eight.
// Only to whom Fansly concerns (it is switched on, a page of the sign-in is on Fansly, or a Fansly account was seen):
// a ChatSpace chatter's settings stay as they were. Imported by the pages' composition root and the stand only.

import { type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import type { CgErrorWire, I18nKey } from '@cg/contracts/errors';
import { HOST_PLATFORM } from '@cg/contracts/hosts';
import type { FanslyPageFacts, FanslyPagesControl, FanslyPagesView, FanslyPageTextKey, FanslyStep, FanslyToneKey } from '@cg/contracts/pages-fansly';
import { SETTINGS_RANGES, SOUND_TONE_IDS, type ToneId } from '@cg/contracts/settings';
import { SETTINGS_EXT_RANGES } from '@cg/contracts/settings-ext';
import type { I18n } from '@cg/contracts/vm';

import { Button, Checkbox, CodeLine, Dot, Icon, Spinner, useI18n, useView } from '../../../kit';
import { Picker, Stepper } from '../../../pages/options/controls';
import type { OptionsSlots } from '../../../pages/options/slots';
import { Card, Opt } from '../../../pages/shared';

const FANSLY = 'fansly-web';

/** A Fansly page text (its pack is laid over the page's I18n by the composition root). */
const text = (i18n: I18n, key: FanslyPageTextKey, params?: Parameters<I18n['t']>[1]): string => i18n.t(key as unknown as I18nKey, params);

const TONE_KEYS: Readonly<Record<ToneId, I18nKey>> = {
  chime: 'sound.tone.chime',
  drop: 'sound.tone.drop',
  bell: 'sound.tone.bell',
  arpeggio: 'sound.tone.arpeggio',
  knock: 'sound.tone.knock',
  double: 'sound.tone.double',
  soft: 'sound.tone.soft',
  blip: 'sound.tone.blip',
};

/** The control's view, live. */
function useFansly(control: FanslyPagesControl): FanslyPagesView {
  const [view, setView] = useState(control.value);
  useEffect(() => {
    setView(control.value);
    return control.subscribe(() => setView(control.value));
  }, [control]);
  return view;
}

/** What the shared page knows that Fansly's part asks about: the sign-in's pages, the accounts this browser saw. */
function useFacts(): FanslyPageFacts {
  const personas = useView({ of: 'options', section: 'personas' }).value.body;
  const accounts = useView({ of: 'options', section: 'accounts' }).value.body;
  return {
    fanslyPage: personas?.pages.some((page) => page.page?.platform === HOST_PLATFORM[FANSLY]) ?? false,
    seenAccount: accounts?.rows.some((row) => row.accountHandle.startsWith(`${FANSLY}:`) && row.status !== 'no-sessions') ?? false,
  };
}

/** «Сохранено ✓» (for a few seconds after each confirmed revision) or «Не сохранено · Повторить», as the shared page says it. */
function SaveNote({ view, control }: { readonly view: FanslyPagesView; readonly control: FanslyPagesControl }): JSX.Element | null {
  const i18n = useI18n();
  const save = view.save;
  const revision = save.s === 'saved' ? save.revision : null;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (revision === null) return undefined;
    setShown(revision);
    const timer = setTimeout(() => setShown(null), 3000);
    return () => clearTimeout(timer);
  }, [revision]);
  if (save.s === 'saving') {
    return (
      <span class="pg-save" role="status" data-pg-fansly-save="saving">
        <Spinner />
        {i18n.t('common.saving')}
      </span>
    );
  }
  if (save.s === 'failed') {
    return (
      <span class="pg-save pg-save--failed" role="alert" data-pg-fansly-save="failed" data-cg-code={save.error.code}>
        <Dot kind="danger" />
        <span>
          {i18n.t('settings.save.failed')} · <CodeLine code={save.error.code} class="pg-code" />
        </span>
        <Button label={i18n.t('common.retry')} variant="line" size="sm" onClick={() => void control.retry()} />
      </span>
    );
  }
  if (save.s === 'saved' && shown === save.revision) {
    return (
      <span class="pg-save" role="status" data-pg-fansly-save="saved" data-pg-revision={save.revision}>
        {i18n.t('settings.save.saved')}
      </span>
    );
  }
  return null;
}

/** Why a control of Fansly's part cannot be changed: a newer build stored the key (CG-STORAGE-VERSION). */
const lockOf = (i18n: I18n, view: FanslyPagesView): string | null => (view.settings?.readOnly === true ? i18n.t('cg.storageVersion.title') : null);

function stateText(i18n: I18n, view: FanslyPagesView): string {
  const state = view.access.state;
  if (state === null) return text(i18n, 'fansly.pages.stateUnknown');
  if (view.on) return text(i18n, 'fansly.pages.stateOn');
  return text(i18n, state.enabled ? 'fansly.pages.stateNoAccess' : 'fansly.pages.stateOff');
}

/**
 * Fansly's card: switching it on, its tabs, and — on the settings page, while it is on — «Fansly через вкладку». The
 * button of «Включить Fansly» keeps the P9a hook `.pg-site-access button` (the signed builds' spec presses it there).
 */
export function FanslyCard({ control, settings }: { readonly control: FanslyPagesControl; readonly settings: boolean }): JSX.Element {
  const i18n = useI18n();
  const view = useFansly(control);
  const site = text(i18n, 'fansly.pages.card');
  const state = view.access.state;
  const waiting = state?.waitingReload ?? 0;
  const accounts = view.accounts;
  const unattributed = accounts?.unattributedTabs ?? 0;
  const locked = lockOf(i18n, view);
  return (
    <Card title={site} lead={text(i18n, view.on ? 'fansly.pages.leadOn' : 'fansly.pages.leadOff')} class="pg-sitecard" anchor="fansly">
      {settings ? (
        <div class="pg-sitecard__save">
          <SaveNote view={view} control={control} />
        </div>
      ) : null}
      <Opt label={text(i18n, 'fansly.pages.state')} hint={text(i18n, 'fansly.pages.stateHint')} anchor="fansly-access">
        <span class="pg-line">
          <span class={view.on ? 'pg-value' : 'pg-muted'} data-pg-fansly-state={state === null ? 'unknown' : view.on ? 'on' : state.enabled ? 'no-access' : 'off'}>
            {stateText(i18n, view)}
          </span>
          <span class="pg-site-access">
            <Button
              variant={view.on ? 'quiet' : 'line'}
              busy={view.access.busy}
              label={i18n.t(view.on ? 'siteAccess.disable' : 'siteAccess.enable', { site })}
              // The browser's prompt runs inside this very click (§4): nothing is awaited before `enable`.
              onClick={() => void (view.on ? control.disable() : control.enable())}
            />
          </span>
        </span>
        {view.access.error === null ? null : (
          <div class="pg-sub pg-line" role="alert" data-cg-code={view.access.error}>
            <Dot kind="danger" />
            <span>
              {i18n.t('cg.runtimeUnreachable.title')} · <CodeLine code="CG-RUNTIME-UNREACHABLE" class="pg-code" />
            </span>
            <Button label={i18n.t('common.retry')} variant="line" size="sm" busy={view.access.busy} onClick={() => void control.refresh()} />
          </div>
        )}
      </Opt>
      {view.on || waiting > 0 ? (
        <Opt label={text(i18n, 'fansly.pages.tabs')} hint={text(i18n, 'fansly.pages.tabsHint')} anchor="fansly-tabs">
          <span class="pg-line">
            <span data-pg-fansly-tabs={accounts?.openTabs ?? 'unknown'}>
              {accounts === null || accounts.openTabs === null ? text(i18n, 'fansly.pages.tabsUnknown') : text(i18n, 'fansly.pages.tabsOpen', { n: accounts.openTabs })}
            </span>
            {waiting > 0 ? (
              <>
                <span class="pg-value" data-pg-fansly-waiting={waiting}>
                  {i18n.t('siteAccess.waiting', { count: waiting })}
                </span>
                <Button variant="line" size="sm" busy={view.access.busy} label={i18n.t('siteAccess.reload')} onClick={() => void control.reload()} />
              </>
            ) : null}
            {state?.reloaded === undefined ? null : <span role="status">{i18n.t('siteAccess.reloaded', { count: state.reloaded })}</span>}
          </span>
          {unattributed > 0 ? (
            <div class="pg-sub" data-pg-unattributed={unattributed}>
              {text(i18n, 'fansly.pages.tabsUnattributed', { n: unattributed })}
            </div>
          ) : null}
        </Opt>
      ) : null}
      {settings && view.on && view.settings !== null ? (
        <Opt label={text(i18n, 'fansly.pages.viaTab')} hint={text(i18n, 'fansly.pages.viaTabHint')} anchor="fansly-via-tab">
          <Checkbox
            label={text(i18n, 'fansly.pages.viaTab')}
            stateWord={i18n.t('settings.generation.on')}
            checked={view.settings.ext.hosts[FANSLY].viaTab}
            size={14}
            reason={locked}
            onChange={(on) => void control.setViaTab(on)}
          />
        </Opt>
      ) : null}
      {settings && view.on && view.settings === null && view.settingsError !== null ? <ReadFailed error={view.settingsError} control={control} /> : null}
    </Card>
  );
}

function ReadFailed({ error, control }: { readonly error: CgErrorWire; readonly control: FanslyPagesControl }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="pg-sub pg-line" role="alert" data-cg-code={error.code}>
      <Dot kind="danger" />
      <span>
        {text(i18n, 'fansly.pages.readFailed')} · <CodeLine code={error.code} class="pg-code" />
      </span>
      <Button label={i18n.t('common.retry')} variant="line" size="sm" onClick={() => void control.refresh()} />
    </div>
  );
}

/** «Аккаунты»: Fansly's card, to whom Fansly concerns. */
function AccountsCard({ control }: { readonly control: FanslyPagesControl }): JSX.Element | null {
  const facts = useFacts();
  useFansly(control);
  return control.concerns(facts) ? <FanslyCard control={control} settings /> : null;
}

/** One tone of Fansly: the picker and «Проверить», at the volume of the settings. */
function ToneRow({ control, view, which, label }: { readonly control: FanslyPagesControl; readonly view: FanslyPagesView; readonly which: FanslyToneKey; readonly label: string }): JSX.Element | null {
  const i18n = useI18n();
  const appearance = useView({ of: 'options', section: 'appearance' }).value.body;
  const [failed, setFailed] = useState<CgErrorWire | null>(null);
  if (view.settings === null) return null;
  const tone = view.settings.ext.hosts[FANSLY].sound[which];
  const volume = appearance?.sound.volume ?? SETTINGS_RANGES.volume.max;
  return (
    <Opt label={label} hint={text(i18n, 'fansly.pages.tonesHint')} center>
      <span class="pg-line" data-pg-fansly-tone={which}>
        {/* Where the shared rows have their switch: the pickers stand in one column. */}
        <span class="pg-tone-pad" aria-hidden="true" />
        <Picker
          label={text(i18n, 'fansly.pages.tones')}
          text={i18n.t(TONE_KEYS[tone])}
          value={tone}
          options={SOUND_TONE_IDS.map((id) => ({ value: id, label: i18n.t(TONE_KEYS[id]) }))}
          reason={lockOf(i18n, view)}
          onChange={(value) => {
            const next = SOUND_TONE_IDS.find((id) => id === value);
            if (next !== undefined) void control.setTone(which, next);
          }}
        />
        <Button label={i18n.t('settings.appearance.testSound')} variant="quiet" onClick={() => void control.preview(tone, volume).then(setFailed)} />
      </span>
      {failed === null ? null : (
        <div class="pg-sub pg-line" role="alert" data-cg-code={failed.code}>
          <Dot kind="danger" />
          <CodeLine code={failed.code} class="pg-code" />
        </div>
      )}
    </Opt>
  );
}

/** «Вид и звук» → «Звук»: the tones on Fansly, while Fansly is on. */
function SoundRows({ control }: { readonly control: FanslyPagesControl }): JSX.Element | null {
  const i18n = useI18n();
  const view = useFansly(control);
  if (!view.on || view.settings === null) return null;
  return (
    <>
      <ToneRow control={control} view={view} which="messagesTone" label={text(i18n, 'fansly.pages.toneMessages')} />
      <ToneRow control={control} view={view} which="subscribersTone" label={text(i18n, 'fansly.pages.toneSubscribers')} />
    </>
  );
}

/**
 * «Генерация» → the windows: the Recap depth on Fansly (`settings.ext` `windows.deep`, 3001…5000; P4b2), while Fansly is
 * on and only when the hub takes more than 3000 (`limits.deepMax`). 3000 here means «as above»: no wish is stored.
 */
function DeepRow({ control }: { readonly control: FanslyPagesControl }): JSX.Element | null {
  const i18n = useI18n();
  const view = useFansly(control);
  const generation = useView({ of: 'options', section: 'generation' }).value.body;
  const deepMax = generation?.windows.deepMax ?? null;
  if (!view.on || view.settings === null || deepMax === null || deepMax <= SETTINGS_RANGES.windowDeep.max) return null;
  const max = Math.min(SETTINGS_EXT_RANGES.windowDeep.max, deepMax);
  const label = text(i18n, 'fansly.pages.deep');
  return (
    <Opt label={label} hint={text(i18n, 'fansly.pages.deepHint', { max })} anchor="fansly-deep">
      <Stepper
        label={label}
        value={view.settings.ext.windows.deep ?? SETTINGS_RANGES.windowDeep.max}
        min={SETTINGS_RANGES.windowDeep.max}
        max={max}
        step={100}
        reason={lockOf(i18n, view)}
        onChange={(value) => control.setDeep(value)}
      />
    </Opt>
  );
}

const STEP_KEYS: Readonly<Record<FanslyStep['id'], FanslyPageTextKey>> = {
  'fansly-enable': 'fansly.pages.stepEnable',
  'fansly-open': 'fansly.pages.stepOpen',
  'fansly-reload': 'fansly.pages.stepReload',
};

/** The first run (ST-012): Fansly's three steps under the eight, to whom Fansly concerns. */
function Steps({ control }: { readonly control: FanslyPagesControl }): JSX.Element | null {
  const i18n = useI18n();
  const view = useFansly(control);
  const facts = useFacts();
  if (!control.concerns(facts)) return null;
  const steps = control.steps(facts);
  const done = steps.filter((step) => step.done).length;
  return (
    <div class="pg-check__group" data-pg-site={FANSLY}>
      <div class="pg-check__sub">
        <b>{text(i18n, 'fansly.pages.steps')}</b>
        <span>{i18n.t('settings.onboarding.progress', { done, total: steps.length })}</span>
      </div>
      <ol class="pg-check__list">
        {steps.map((step) => (
          <li key={step.id} class={`pg-check__item${step.done ? ' is-done' : ''}`} data-pg-step={step.id}>
            {step.done ? <Icon name="check" size={14} /> : <Dot kind="ring" />}
            <span class="pg-check__t">
              {text(i18n, STEP_KEYS[step.id])}
              <span class="cg-sr"> — {i18n.t(step.done ? 'settings.onboarding.stepDone' : 'settings.onboarding.stepTodo')}</span>
            </span>
            {step.action === null ? (
              <span />
            ) : (
              <span class={step.action === 'enable' ? 'pg-site-access' : undefined}>
                <Button
                  label={step.action === 'enable' ? i18n.t('siteAccess.enable', { site: text(i18n, 'fansly.pages.card') }) : i18n.t('siteAccess.reload')}
                  variant="quiet"
                  busy={view.access.busy}
                  // «Включить Fansly»: the browser's prompt inside this click, nothing awaited before it.
                  onClick={() => void (step.action === 'enable' ? control.enable() : control.reload())}
                />
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Fansly's parts of the settings page, over its control: what the composition root hands to `mountOptions`. */
export function fanslyOptionsSlots(control: FanslyPagesControl): OptionsSlots {
  return {
    accounts: () => <AccountsCard control={control} />,
    signIn: () => <FanslyCard control={control} settings={false} />,
    appearanceSound: () => <SoundRows control={control} />,
    generationWindows: () => <DeepRow control={control} />,
    checklist: () => <Steps control={control} />,
  };
}
