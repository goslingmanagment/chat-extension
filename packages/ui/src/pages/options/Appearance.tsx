// «Вид и звук» (ui-design §4.24, §7, final-21b; ST-122…ST-135): the look of
// the answer, the text size on the site (X49), the theme with what the system is now, the language, tooltips,
// the two sounds with their tones, the volume and the sound state. Every
// change is the person's own and applies at once, in every open tab.

import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { SETTINGS_RANGES, UI_LOCALES, UI_THEMES, type ToneId, type UiLocale, type UiTheme } from '@cg/contracts/settings';
import { type AppearanceBodyVM } from '@cg/contracts/vm';

import { Button, Checkbox, Dot, Segmented, useI18n } from '../../kit';
import { Card, Opt, useAct, withLink } from '../shared';
import { Picker, Slider, StyleChoice, ThemeChoice } from './controls';
import { Slot } from './slots';

const THEME_KEYS: Readonly<Record<UiTheme, I18nKey>> = {
  host: 'settings.appearance.theme.host',
  system: 'settings.appearance.theme.system',
  light: 'settings.appearance.theme.light',
  dark: 'settings.appearance.theme.dark',
};
const LOCALE_KEYS: Readonly<Record<UiLocale, I18nKey>> = {
  system: 'settings.appearance.locale.system',
  ru: 'settings.appearance.locale.ru',
  en: 'settings.appearance.locale.en',
};
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

function SoundRow({
  which,
  label,
  hint,
  body,
  locked,
}: {
  readonly which: 'messages' | 'subscribers';
  readonly label: string;
  readonly hint: string;
  readonly body: AppearanceBodyVM;
  readonly locked: string | null;
}): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const sound = body.sound[which];
  const test = body.sound.test[which];
  return (
    <Opt label={label} hint={hint} center>
      <span class="pg-line">
        <Checkbox
          label={label}
          stateWord={i18n.t('settings.appearance.soundOn')}
          checked={sound.on}
          size={14}
          reason={locked}
          onChange={(value) => void act({ type: 'SetPreference', key: `sound.${which}.on`, value }, { quiet: true })}
        />
        <Picker
          label={i18n.t('settings.appearance.toneLabel')}
          text={i18n.t(TONE_KEYS[sound.tone])}
          value={sound.tone}
          options={body.sound.tones.map((tone) => ({ value: tone, label: i18n.t(TONE_KEYS[tone]) }))}
          reason={locked}
          onChange={(value) => {
            const tone = body.sound.tones.find((entry) => entry === value);
            if (tone !== undefined) void act({ type: 'SetPreference', key: `sound.${which}.tone`, value: tone }, { quiet: true });
          }}
        />
        {/* The failure of a test is said in the sound state below, with its code: no toast on top of it. */}
        <Button label={i18n.text(test.label)} variant="quiet" onClick={() => void act(test.action, { quiet: true })} />
      </span>
    </Opt>
  );
}

function SoundState({ body }: { readonly body: AppearanceBodyVM }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const { status, messages, subscribers } = body.sound;
  const text =
    !messages.on && !subscribers.on
      ? i18n.t('settings.appearance.soundStateOff')
      : status.listeningTabs === null
        ? i18n.t('settings.appearance.soundStateUnknown')
        : status.listeningTabs === 0
          ? i18n.t('settings.appearance.soundStateNoTabs')
          : i18n.t('settings.appearance.soundStateOk');
  const link = (
    <button type="button" class="pg-link" onClick={() => void act({ type: 'OpenSettings', route: { section: 'accounts' } })}>
      «{i18n.t('settings.section.accounts')}»
    </button>
  );
  return (
    <Opt label={i18n.t('settings.appearance.soundState')} hint={i18n.t('settings.appearance.soundStateHint')} anchor="sound">
      {status.error === null ? (
        <span role="status">{text}</span>
      ) : (
        <span class="pg-line" role="alert" data-cg-code={status.error.code}>
          <Dot kind="danger" />
          {i18n.t('settings.appearance.soundFailed', { reason: `${status.error.title} (${status.error.code})` })}
        </span>
      )}
      <div class="pg-sub">{withLink(i18n.t('settings.appearance.muteNote'), link)}</div>
    </Opt>
  );
}

export function AppearanceSection({ body, readOnly }: { readonly body: AppearanceBodyVM; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const locked = readOnly ? i18n.t('cg.storageVersion.title') : null;
  const scheme = i18n.t(body.systemScheme === 'dark' ? 'settings.appearance.scheme.dark' : 'settings.appearance.scheme.light');
  return (
    <>
      <Card>
        <Opt label={i18n.t('settings.appearance.resultStyle')} hint={i18n.t('settings.appearance.resultStyleHint')}>
          <StyleChoice
            label={i18n.t('settings.appearance.resultStyle')}
            value={body.resultStyle}
            labels={{ bare: i18n.t('settings.appearance.resultStyle.bare'), sheet: i18n.t('settings.appearance.resultStyle.sheet') }}
            reason={locked}
            onChange={(value) => void act({ type: 'SetPreference', key: 'ui.resultStyle', value }, { quiet: true })}
          />
        </Opt>
        <Opt label={i18n.t('settings.appearance.theme')} hint={i18n.t('settings.appearance.themeHint')}>
          <ThemeChoice
            label={i18n.t('settings.appearance.theme')}
            value={body.theme}
            options={UI_THEMES.map((value) => ({ value, label: i18n.t(THEME_KEYS[value]) }))}
            reason={locked}
            onChange={(value) => void act({ type: 'SetPreference', key: 'ui.theme', value }, { quiet: true })}
          />
          <div class="pg-sub">{i18n.t('settings.appearance.theme.systemNow', { scheme })}</div>
        </Opt>
        <Opt label={i18n.t('settings.appearance.locale')} hint={i18n.t('settings.appearance.localeHint')}>
          <Segmented
            label={i18n.t('settings.appearance.locale')}
            size="md"
            value={body.locale}
            options={UI_LOCALES.map((value) => ({ value, label: i18n.t(LOCALE_KEYS[value]), reason: locked }))}
            onChange={(value) => void act({ type: 'SetPreference', key: 'ui.locale', value }, { quiet: true })}
          />
        </Opt>
        <Opt label={i18n.t('settings.appearance.hints')} hint={i18n.t('settings.appearance.hintsHint')}>
          <Checkbox
            label={i18n.t('settings.appearance.hints')}
            stateWord={i18n.t('settings.appearance.hintsOn')}
            checked={body.hints}
            size={14}
            reason={locked}
            onChange={(value) => void act({ type: 'SetPreference', key: 'ui.hints', value }, { quiet: true })}
          />
          <div class="pg-sub">{i18n.t('settings.appearance.hintsNote')}</div>
        </Opt>
        {/* «Размер текста» (decision X49): the type scale of our surfaces on the site, both sites; the pages keep theirs. */}
        <Opt label={i18n.t('settings.appearance.textSize')} hint={i18n.t('settings.appearance.textSizeHint')}>
          <Checkbox
            label={i18n.t('settings.appearance.textSize')}
            stateWord={i18n.t('settings.appearance.textSizeLarge')}
            checked={body.textSize === 'large'}
            size={14}
            reason={locked}
            onChange={(value) => void act({ type: 'SetPreference', key: 'ui.textSize', value: value ? 'large' : 'normal' }, { quiet: true })}
          />
          <div class="pg-sub">{i18n.t('settings.appearance.textSizeNote')}</div>
        </Opt>
      </Card>

      <Card title={i18n.t('settings.appearance.sounds')}>
        <SoundRow which="messages" label={i18n.t('settings.appearance.soundMessage')} hint={i18n.t('settings.appearance.soundMessageHint')} body={body} locked={locked} />
        <SoundRow which="subscribers" label={i18n.t('settings.appearance.soundSubscriber')} hint={i18n.t('settings.appearance.soundSubscriberHint')} body={body} locked={locked} />
        {/* A site's own tones (R20 P14b1): Fansly's messages and subscribers, as its old extension rang them. */}
        <Slot name="appearanceSound" />
        <Opt label={i18n.t('settings.appearance.volume')} hint={i18n.t('settings.appearance.volumeHint')} center>
          <Slider
            label={i18n.t('settings.appearance.volume')}
            value={body.sound.volume}
            {...SETTINGS_RANGES.volume}
            reason={locked}
            onChange={(value) => void act({ type: 'SetPreference', key: 'sound.volume', value }, { quiet: true })}
          />
        </Opt>
        <SoundState body={body} />
        <Opt label={i18n.t('settings.appearance.notifications')} hint={i18n.t('settings.appearance.notificationsHint')}>
          {i18n.t('settings.appearance.notificationsText')}
        </Opt>
      </Card>
    </>
  );
}
