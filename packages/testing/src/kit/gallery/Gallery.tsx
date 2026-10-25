// The ui/kit gallery (architecture.md §10.2 п. 8; ui-design §11): every kit
// component in all its states, rendered by the real kit inside a closed
// shadow root with the shipped I18n. The page picks the theme, the language
// and a column width; the visual e2e adds the zoom. Section titles are the
// stand's own chrome; every product word comes from the catalog.

import { useState } from 'preact/hooks';
import { type ComponentChildren, type JSX } from 'preact';

import { type I18nKey, type PartVM, type ToastVM } from '@cg/contracts';
import {
  ACCENT_USES,
  ActionButton,
  Age,
  Boundary,
  Button,
  Caret,
  CheckGlyph,
  Checkbox,
  ConfirmDialog,
  Countdown,
  Divider,
  Dot,
  Duration,
  ErrorCard,
  GooseMark,
  ICON_NAMES,
  Icon,
  KeysFooter,
  Markdown,
  Menu,
  MenuAnchor,
  Money,
  PartRow,
  SearchBox,
  Segmented,
  Spinner,
  StageLine,
  StatusBanner,
  StripButton,
  Tabs,
  TextField,
  Time,
  ToastItem,
  ViewState,
  VirtualList,
  useI18n,
  useT,
} from '@cg/ui/kit';

import { aiReadyToast, button, cgError, greetToast, hotkey, part, phase, reason, toast, uuid, views, type ScenarioCtx } from '../../scenarios/app-client';

const OP = uuid(101);
const MIN = 60_000;

const REPLY_TEXTS = {
  ru: ['Привет, я как раз о тебе думала', 'Сегодня есть кое-что новое — показать?', 'Только если расскажешь, как прошли выходные'],
  en: ['Hey you, I was just thinking about you', 'Got something new today — want a peek?', 'Only if you tell me about your weekend first'],
};

const RECAP = {
  ru: '## Кто это\n\nHubert, **китовый** фан: $12,480 за всё время, последний тип — 3 дня назад.\n\n- любит короткие ответы\n- просит фото по вечерам\n- не любит, когда торопят\n\n> «скинь что-нибудь новое»\n\nСсылка на правила: https://example.com/rules.',
  en: '## Who this is\n\nHubert, a **whale** fan: $12,480 lifetime, last tip 3 days ago.\n\n- likes short replies\n- asks for photos in the evening\n- dislikes being rushed\n\n> “send me something new”\n\nRules: https://example.com/rules.',
};

function Section({ id, title, children, wide = false }: { readonly id: string; readonly title: string; readonly children: ComponentChildren; readonly wide?: boolean }): JSX.Element {
  return (
    <section class={`gal-sec${wide ? ' gal-sec--wide' : ''}`} data-gal={id}>
      <h2 class="gal-h">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { readonly label: string; readonly children: ComponentChildren }): JSX.Element {
  return (
    <div class="gal-row">
      <span class="gal-l">{label}</span>
      <div class="gal-v">{children}</div>
    </div>
  );
}

function Buttons({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  const t = useT();
  const reply = hotkey(ctx, 'reply');
  const off = t('dock.reason.hubDown');
  return (
    <Section id="buttons" title="Кнопки · §4.0">
      <Row label="простая">
        <Button label={t('common.again')} hotkey={reply} tooltip={t('result.againTooltip')} />
        <Button label={t('common.again')} hotkey={reply} reason={off} />
        <Button label={t('part.insert')} hotkey="↵" busy />
      </Row>
      <Row label="линия">
        <Button label={t('part.insert')} variant="line" hotkey="↵" />
        <Button label={t('fix.replace')} variant="line" reason={t('fix.cannotCheck')} />
        <Button label={t('common.openChat')} variant="line" size="sm" />
      </Row>
      <Row label="тихая">
        <Button label={t('common.hide')} variant="quiet" hotkey="Esc" />
        <Button label={t('common.copyCode')} variant="quiet" />
        <Button label={t('common.copy')} variant="quiet" icon="copy" iconOnly />
        <Button label={t('common.close')} variant="quiet" icon="x" iconOnly size="sm" />
      </Row>
      <Row label="отправка">
        <Button label={t('send.button')} variant="send" />
        <Button label={t('send.button')} variant="send" reason={t('send.reason.off')} />
      </Row>
      <Row label="из модели">
        <ActionButton vm={button('common.retry', { type: 'RecheckStatus' })} variant="line" />
        <ActionButton vm={button('common.retry', { type: 'RecheckStatus' }, { enabled: false, reason: reason('wait-until', { n: 24 }) })} />
      </Row>
    </Section>
  );
}

/** The tones of the capsule, as the dock draws them. */
const TONE_CELLS = [
  ['casual', '😌'],
  ['flirty', '😏'],
  ['upsell', '💰'],
  ['spicy', '🔥'],
] as const;

function Strip({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(true);
  // The narrow rules of ui-design §3.3 belong to the dock (R14); the gallery mirrors the few it needs to fit a 320 px column.
  return (
    <Section id="strip" title="Панель дока · §4.1" wide>
      <div class="gal-strip gal-strip--menu" role="toolbar" aria-label={t('dock.label')}>
        <span class="gal-mark">
          <GooseMark />
        </span>
        <div class="gal-acts">
          <StripButton label={t('dock.action.reply')} class="cg-act--main" hotkey={hotkey(ctx, 'reply')} active />
          <span class="cg-tones">
            <span class="cg-tones__track" role="group" aria-label={t('dock.option.tone')}>
              {TONE_CELLS.map(([tone, emoji]) => (
                <StripButton
                  key={tone}
                  label={t(`dock.tone.${tone}` as I18nKey)}
                  class="cg-opt cg-tone"
                  pressed={tone === 'flirty'}
                  leading={
                    <span class="cg-tone__e" aria-hidden="true">
                      {emoji}
                    </span>
                  }
                />
              ))}
            </span>
            <span class="cg-tones__seam" aria-hidden="true" />
            <StripButton label={t('dock.option.split')} class="cg-opt cg-split" pressed leading={<CheckGlyph on />} />
          </span>
          <Divider />
          <StripButton label={t('dock.action.fix')} hotkey={hotkey(ctx, 'fix')} busy />
          <Divider />
          <StripButton label={t('dock.action.hi')} hotkey={hotkey(ctx, 'hi')} reason={t('dock.reason.chatBusy')} />
          <span class="gal-flex gal-wide">
            <StripButton label={t('dock.action.ping')} hotkey={hotkey(ctx, 'ping')} />
            <StripButton label={t('dock.action.recap')} hotkey={hotkey(ctx, 'recap')} ready />
          </span>
          <MenuAnchor>
            <StripButton label={t('dock.action.more')} class="cg-more" expanded={moreOpen} haspopup="menu" ready onClick={() => setMoreOpen(!moreOpen)} />
            <Menu
              open={moreOpen}
              kind="action"
              label={t('dock.action.more')}
              align="end"
              items={[
                { id: 'review', label: t('dock.action.review'), hint: hotkey(ctx, 'review').display },
                { id: 'recap', label: t('dock.action.recap'), hint: hotkey(ctx, 'recap').display },
                { id: 'coach', label: t('dock.action.coach'), reason: t('dock.reason.chatBusy') },
                { id: 'spenders', label: t('spenders.title') },
                { id: 'newcomers', label: t('newcomers.title') },
              ]}
              onSelect={() => undefined}
              onClose={() => setMoreOpen(false)}
              returnFocusTo={() => null}
              autoFocus={false}
            />
          </MenuAnchor>
        </div>
      </div>
      <div class="gal-strip">
        <span class="gal-mark gal-mark--off">
          <GooseMark />
        </span>
        <div class="gal-acts">
          {(['reply', 'fix', 'hi', 'ping'] as const).map((id) => (
            <StripButton key={id} label={t(`dock.action.${id}` as I18nKey)} reason={t('dock.reason.notSignedIn')} />
          ))}
          <span class="cg-tones gal-wide-420">
            <span class="cg-tones__track">
              {TONE_CELLS.map(([tone, emoji]) => (
                <StripButton
                  key={tone}
                  label={t(`dock.tone.${tone}` as I18nKey)}
                  class="cg-opt cg-tone"
                  reason={t('dock.option.toneLocked')}
                  leading={
                    <span class="cg-tone__e" aria-hidden="true">
                      {emoji}
                    </span>
                  }
                />
              ))}
            </span>
            <span class="cg-tones__seam" aria-hidden="true" />
            <StripButton label={t('dock.option.split')} class="cg-opt cg-split" leading={<CheckGlyph on={false} />} reason={t('dock.option.splitLocked')} />
            <Icon name="lock" size={12} class="cg-lock" />
          </span>
        </div>
        <div class="gal-opts">
          <span class="gal-status">
            <Spinner />
            <span class="gal-wide">{t('dock.status.chatLoading')}</span>
          </span>
        </div>
      </div>
    </Section>
  );
}

function Tooltips(): JSX.Element {
  const t = useT();
  return (
    <Section id="tooltip" title="Подсказка и меню · §4.1">
      <div class="gal-tips">
        <div class="cg-tip gal-static" role="tooltip">
          {t('dock.action.reply')}  ⌘E
        </div>
        <div class="cg-tip gal-static" role="tooltip">
          {t('dock.action.unavailable', { action: t('dock.action.fix'), reason: t('dock.reason.needsDraft') })}
        </div>
      </div>
      <div class="gal-menu-host">
        <MenuAnchor>
          <StripButton label={t('dock.action.more')} expanded haspopup="menu" />
          <Menu
            open
            kind="action"
            label={t('dock.action.more')}
            placement="bottom"
            items={[
              { id: 'review', label: t('dock.action.review'), hint: '⌘⇧B' },
              { id: 'recap', label: t('dock.action.recap'), hint: '⌘⇧S' },
              { id: 'coach', label: t('dock.action.coach'), hint: '⌘⇧C', reason: t('dock.reason.coachBusy') },
            ]}
            onSelect={() => undefined}
            onClose={() => undefined}
            returnFocusTo={() => null}
            autoFocus={false}
          />
        </MenuAnchor>
      </div>
    </Section>
  );
}

/** A drawn stand-in for a fan's picture: head and shoulders on a warm ground. */
const GALLERY_AVATAR = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' fill='#e9b8a2'/><circle cx='40' cy='31' r='15' fill='#fbe6da'/><path d='M10 80c3-19 16-28 30-28s27 9 30 28z' fill='#8c4a3a'/><path d='M24 30c0-12 7-19 16-19s17 7 17 19c-4-6-10-9-17-9s-12 3-16 9z' fill='#5b3326'/></svg>")}`;

function toastsOf(ctx: ScenarioCtx): ToastVM[] {
  const hub = cgError(ctx, 'CG-HUB-UNAVAILABLE');
  const contract = cgError(ctx, 'CG-HOST-CONTRACT');
  const rate = cgError(ctx, 'CG-PROVIDER-RATE-LIMIT');
  const settings = button('common.settings', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } });
  return [
    toast(ctx, 'e', 'error', { code: 'CG-HUB-UNAVAILABLE', title: hub.title, body: hub.body, copyCode: true, actions: [settings] }),
    toast(ctx, 'r', 'error', {
      code: 'CG-PROVIDER-RATE-LIMIT',
      title: rate.title,
      body: rate.body,
      copyCode: true,
      detail: 'HTTP 429 • retry-after 24 • req 7f3a',
      retryAt: ctx.now + 24_000,
    }),
    toast(ctx, 'w', 'warning', { code: 'CG-HOST-CONTRACT', title: contract.title, actions: [settings] }),
    aiReadyToast(ctx, 'Theodore Whitfield', 'h-chat'),
    // A greeting reminder: with the fan's picture (a drawn stand-in, nobody's photo), and with none — the initial.
    greetToast(ctx, 'g1', { name: 'Anya', handle: 'anya_k', avatarUrl: GALLERY_AVATAR, minutesAgo: 11 }),
    greetToast(ctx, 'g2', { name: 'Theodore Whitfield', handle: null, avatarUrl: null, minutesAgo: 14 }),
    toast(ctx, 'i', 'info', { title: ctx.lang === 'ru' ? 'Split включён: ответ придёт частями' : 'Split is on: the answer comes in parts' }),
  ];
}

function Toasts({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  return (
    <Section id="toasts" title="Тосты · §4.22">
      <div class="gal-toasts">
        {toastsOf(ctx).map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={() => undefined} onHold={() => undefined} />
        ))}
      </div>
    </Section>
  );
}

function Errors({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  const t = useT();
  const regenerate = button('common.retry', { type: 'Regenerate', operationId: OP }, { enabled: false, reason: reason('wait-until', { n: 24 }) });
  return (
    <Section id="errors" title="Карточки ошибок и баннеры · §4.8, §4.10" wide>
      <div class="gal-sheet">
        <ErrorCard error={cgError(ctx, 'CG-PROVIDER-RATE-LIMIT', { retryAt: ctx.now + 24_000, detail: 'HTTP 429 • rate_limited • retryAfter=24' })} tone="failure" actions={[regenerate]} alert={false} />
        <ErrorCard error={cgError(ctx, 'CG-QUOTA-DAILY', { retryAt: ctx.now + (17 * 60 + 39) * MIN + 30_000, detail: 'HTTP 429 • quota_denied • resetsAt=2026-10-04T00:00:00Z' })} tone="state" alert={false} />
        <ErrorCard
          error={cgError(ctx, 'CG-OP-INTERRUPTED', { detail: 'operation 7f3a… interrupted • tab unloaded' })}
          tone="failure"
          actions={[button('common.again', { type: 'Regenerate', operationId: OP }, { hotkey: hotkey(ctx, 'reply') })]}
          alert={false}
        />
      </div>
      <div class="gal-sheet">
        <StatusBanner error={cgError(ctx, 'CG-HUB-UNAVAILABLE')} dot="danger" action={button('common.retry', { type: 'RecheckStatus' })} />
        <StatusBanner error={cgError(ctx, 'CG-AUTH-REQUIRED')} dot="ring" action={button('common.signIn', { type: 'OpenSettings', route: { section: 'status' } })} />
        <StatusBanner error={cgError(ctx, 'CG-HOST-CONTRACT')} dot="ring" action={button('common.details', { type: 'OpenSettings', route: { section: 'status', code: 'CG-HOST-CONTRACT' } })} />
        <StatusBanner error={cgError(ctx, 'CG-GATE-FAN-BLOCKED')} dot="ring" />
      </div>
      <p class="gal-note">{t('cg.uiFailed.reload')}:</p>
      <div class="gal-sheet">
        <Boundary surface="dock">
          <Thrower />
        </Boundary>
      </div>
    </Section>
  );
}

function Thrower(): null {
  throw new TypeError('gallery: a render failure on purpose');
}

function partsOf(ctx: ScenarioCtx): PartVM[] {
  const texts = REPLY_TEXTS[ctx.lang];
  return [
    part(0, texts[0] ?? '', { opId: OP, collapsed: true, insert: 'done' }),
    part(1, texts[1] ?? '', { opId: OP, next: true, copy: 'done' }),
    part(2, texts[2] ?? '', { opId: OP }),
  ];
}

function Parts({ ctx, bare }: { readonly ctx: ScenarioCtx; readonly bare: boolean }): JSX.Element {
  const t = useT();
  const texts = REPLY_TEXTS[ctx.lang];
  const noop = (): void => undefined;
  return (
    <Section id={bare ? 'parts-bare' : 'parts-sheet'} title={`Части ответа · §4.3 · ${bare ? 'без подложки' : 'на подложке'}`} wide>
      <div class={bare ? 'gal-bare cg-bare' : 'gal-sheet'}>
        <div class="gal-head">
          <span class="gal-head__g">
            <Spinner />
          </span>
          <b>{t('dock.action.reply')}</b>
          <StageLine phase={phase(OP, ctx.now - 3_000, ['context', 'thinking'], 'writing')} startedAt={ctx.now - 3_000} />
        </div>
        <div class="gal-stream">
          {texts[0]}
          <Caret />
        </div>
        {bare ? null : (
          <div class="gal-head gal-head--top">
            <span class="gal-head__g">
              <Spinner />
            </span>
            <b>{t('dock.action.reply')}</b>
            <StageLine phase={phase(OP, ctx.now - 2_000, [], 'context', ctx.now + 5_000)} startedAt={ctx.now - 2_000} />
          </div>
        )}
      </div>
      <div class={bare ? 'gal-bare cg-bare' : 'gal-sheet'}>
        {partsOf(ctx).map((vm) => (
          <PartRow key={vm.index} part={vm} mode="insert" onInsert={noop} onCopy={noop} onInsertAgain={noop} tabIndex={vm.next ? 0 : -1} />
        ))}
        <KeysFooter
          hints={[
            { keys: '↑↓', label: t('result.keys.part') },
            { keys: '↵', label: t('result.keys.insert') },
            { keys: hotkey(ctx, 'copy').display, label: t('result.keys.copy'), optional: true },
            { keys: 'Esc', label: t('result.keys.collapse') },
          ]}
          hide={{ label: t('common.hide'), tooltip: t('result.keys.hideTooltip'), onHide: noop }}
        />
      </div>
      {bare ? null : (
        <div class="gal-sheet">
          <PartRow part={part(0, texts[0] ?? '', { opId: OP, next: true, insert: 'pending' })} mode="insert" onInsert={noop} onCopy={noop} />
          <PartRow part={part(1, texts[1] ?? '', { opId: OP, next: true, insert: 'failed', insertError: cgError(ctx, 'CG-INSERT-FAILED') })} mode="insert" onInsert={noop} onCopy={noop} />
          <PartRow part={part(2, texts[2] ?? '', { opId: OP, copy: 'failed', copyError: cgError(ctx, 'CG-CLIPBOARD') })} mode="insert" onInsert={noop} onCopy={noop} />
          <PartRow part={part(0, texts[1] ?? '', { opId: OP, next: true, numbered: false })} mode="copy-only" onInsert={noop} onCopy={noop} />
          <PartRow part={part(1, texts[2] ?? '', { opId: OP, collapsed: true, send: { s: 'sent', at: new Date(ctx.now - 2 * MIN).toISOString() } })} mode="insert" onInsert={noop} onCopy={noop} />
        </div>
      )}
    </Section>
  );
}

function Choices(): JSX.Element {
  const t = useT();
  const [length, setLength] = useState<'short' | 'full'>('short');
  const [period, setPeriod] = useState<'lifetime' | 'd30' | 'd7'>('lifetime');
  const [hints, setHints] = useState(true);
  return (
    <Section id="choices" title="Сегменты, флажки, вкладки">
      <Row label="сегмент">
        <Segmented
          label={t('recap.lengthLabel')}
          value={length}
          onChange={setLength}
          options={[
            { value: 'short', label: t('recap.short') },
            { value: 'full', label: t('recap.full') },
          ]}
        />
        <Segmented
          label={t('recap.lengthLabel')}
          size="md"
          value="full"
          onChange={() => undefined}
          options={[
            { value: 'short', label: t('recap.short') },
            { value: 'full', label: t('recap.full') },
          ]}
        />
      </Row>
      <Row label="флажок">
        <Checkbox label={t('dock.option.split')} semantics="toggle" checked onChange={() => undefined} />
        <Checkbox label={t('dock.option.split')} semantics="toggle" checked={false} onChange={() => undefined} />
        <Checkbox label={t('dock.option.split')} semantics="toggle" checked={false} onChange={() => undefined} reason={t('dock.option.splitNotMessage')} />
        <Checkbox label={t('common.settings')} size={14} checked={hints} onChange={setHints} />
      </Row>
      <Row label="вкладки">
        <Tabs
          label={t('spenders.period.label')}
          value={period}
          onChange={setPeriod}
          tabs={[
            { value: 'lifetime', label: t('spenders.period.lifetime') },
            { value: 'd30', label: t('spenders.period.d30') },
            { value: 'd7', label: t('spenders.period.d7') },
          ]}
        />
      </Row>
    </Section>
  );
}

function Fields(): JSX.Element {
  const t = useT();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  return (
    <Section id="fields" title="Поля ввода и поиск">
      <SearchBox value={query} onQuery={setQuery} label={t('spenders.search.placeholder')} placeholder={t('spenders.search.placeholder')} />
      <TextField value={draft} onValue={setDraft} label={t('fix.yourText')} placeholder={t('fix.yourText')} multiline minHeight={56} maxHeight={120} />
      <TextField value="Hey you" onValue={() => undefined} label={t('fix.yourText')} reason={t('fix.cannotCheck')} />
    </Section>
  );
}

function Values({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  return (
    <Section id="values" title="Деньги, возраст, время · §1 п. 6">
      <Row label="деньги">
        <Money mills={12_480_000} />
        <Money mills={320_000} sign="plus" />
        <Money mills={-45_000} />
        <span class="gal-empty">
          [<Money mills={0} />]
        </span>
        <Money mills={null} />
      </Row>
      <Row label="возраст">
        <Age from={ctx.now - 20_000} />
        <Age from={ctx.now - 7 * MIN} />
        <Age from={ctx.now - 3 * 60 * MIN} suffix />
        <Age from={ctx.now - 12 * 24 * 60 * MIN} />
      </Row>
      <Row label="время">
        <Time at={ctx.now} />
        <Time at={ctx.now} style="date" />
        <Time at={ctx.now} style="datetime" />
        <Duration ms={84_000} style="m:ss" />
        <Duration ms={(17 * 60 + 39) * MIN} style="h:mm:ss" />
      </Row>
      <Row label="отсчёт">
        <Countdown until={ctx.now + 24_000} />
        <Countdown until={ctx.now + (39 * 60 + 12) * 1000} />
        <Countdown until={ctx.now + (17 * 60 + 39) * MIN + 1000} />
      </Row>
    </Section>
  );
}

function Marks(): JSX.Element {
  const i18n = useI18n();
  return (
    <Section id="marks" title="Точки, значки, гусь · §2.10">
      <Row label="точки">
        <Dot kind="danger" />
        <Dot kind="ring" />
        <Dot kind="ink" />
        <Dot kind="pulse" />
        {ACCENT_USES.map((use) => (
          <Dot key={use} kind="accent" use={use} size={6} />
        ))}
        <Spinner label={i18n.t('common.loading')} />
      </Row>
      <Row label="значки">
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </Row>
      <Row label="гусь">
        <span class="gal-ink2">
          <GooseMark />
        </span>
        <span class="gal-ink2">
          <GooseMark size={22} />
        </span>
        <span class="gal-ink2">
          <GooseMark size={24} />
        </span>
        <span class="gal-faint">
          <GooseMark />
        </span>
        <span class="gal-ink2">
          <CheckGlyph on />
        </span>
        <span class="gal-ink2">
          <CheckGlyph on={false} />
        </span>
      </Row>
    </Section>
  );
}

function States({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  return (
    <Section id="states" title="Семь состояний вида · §10.2 п. 1" wide>
      <div class="gal-grid">
        <div class="gal-sheet">
          <ViewState view={views.loading(null, { key: 'result.stage.context' })} />
        </div>
        <div class="gal-sheet">
          <ViewState view={views.empty({ key: 'spenders.empty' })} />
        </div>
        <div class="gal-sheet">
          <ViewState view={views.partial({ kind: 'coverage', level: 'partial' })}>
            <p class="gal-data">· · ·</p>
          </ViewState>
        </div>
        <div class="gal-sheet">
          <ViewState view={views.error(cgError(ctx, 'CG-HUB-TIMEOUT'), { type: 'ReloadView', selector: { of: 'spenders.board' } })} />
        </div>
        <div class="gal-sheet">
          <ViewState view={views.forbidden(cgError(ctx, 'CG-BINDING-MISSING'), null)} />
        </div>
        <div class="gal-sheet">
          <ViewState view={views.offline(cgError(ctx, 'CG-HUB-UNAVAILABLE'), { type: 'RecheckStatus' }, ctx.now - 15 * MIN)}>
            <p class="gal-data">· · ·</p>
          </ViewState>
        </div>
      </div>
    </Section>
  );
}

interface Row1000 {
  readonly id: number;
  readonly shelf: boolean;
}
const ROWS: readonly Row1000[] = Array.from({ length: 1000 }, (_, id) => ({ id, shelf: id % 40 === 0 }));

function List(): JSX.Element {
  const t = useT();
  return (
    <Section id="list" title="Виртуальный список · 1000 строк, ≤ 150 в DOM">
      <div class="gal-sheet gal-list">
        <VirtualList<Row1000>
          items={ROWS}
          height={240}
          rowHeight={(row) => (row.shelf ? 34 : 36)}
          getKey={(row) => row.id}
          isGroupHeader={(row) => row.shelf}
          role="table"
          rowRole="row"
          label={t('spenders.boardLabel')}
          header={
            <div class="gal-lrow gal-lrow--head">
              <span>{t('spenders.col.fan')}</span>
              <span>{t('spenders.col.lifetime')}</span>
            </div>
          }
          headerHeight={28}
          renderRow={(row) =>
            row.shelf ? (
              <div class="gal-lrow gal-lrow--shelf">
                <b>
                  {t('stats.shelves')} {row.id / 40 + 1}
                </b>
              </div>
            ) : (
              <div class="gal-lrow">
                <span>Fan {row.id}</span>
                <Money mills={(1000 - row.id) * 37_000} />
              </div>
            )
          }
        />
      </div>
    </Section>
  );
}

function DialogSection(): JSX.Element {
  return (
    <Section id="dialog" title="Диалог подтверждения · DialogPort">
      <div class="gal-dialog-frame">
        <ConfirmDialog
          request={{
            title: { key: 'settings.diagnostics.clear' },
            body: { key: 'settings.diagnostics.clearConfirm' },
            confirm: { key: 'settings.diagnostics.clear' },
            cancel: { key: 'common.cancel' },
            tone: 'destructive',
          }}
          onAnswer={() => undefined}
        />
      </div>
    </Section>
  );
}

function MarkdownSection({ ctx }: { readonly ctx: ScenarioCtx }): JSX.Element {
  return (
    <Section id="markdown" title="Markdown (безопасный AST)">
      <div class="gal-sheet gal-pad">
        <Markdown source={RECAP[ctx.lang]} />
      </div>
    </Section>
  );
}

const SECTIONS = ['buttons', 'strip', 'tooltip', 'toasts', 'errors', 'parts-sheet', 'parts-bare', 'choices', 'fields', 'values', 'marks', 'states', 'list', 'dialog', 'markdown'] as const;
export type GallerySection = (typeof SECTIONS)[number];
export const GALLERY_SECTIONS: readonly GallerySection[] = SECTIONS;

export function Gallery({ ctx, only }: { readonly ctx: ScenarioCtx; readonly only: GallerySection | null }): JSX.Element {
  const show = (id: GallerySection): boolean => only === null || only === id;
  return (
    <div class="gal">
      {show('buttons') ? <Buttons ctx={ctx} /> : null}
      {show('strip') ? <Strip ctx={ctx} /> : null}
      {show('tooltip') ? <Tooltips /> : null}
      {show('toasts') ? <Toasts ctx={ctx} /> : null}
      {show('errors') ? <Errors ctx={ctx} /> : null}
      {show('parts-sheet') ? <Parts ctx={ctx} bare={false} /> : null}
      {show('parts-bare') ? <Parts ctx={ctx} bare /> : null}
      {show('choices') ? <Choices /> : null}
      {show('fields') ? <Fields /> : null}
      {show('values') ? <Values ctx={ctx} /> : null}
      {show('marks') ? <Marks /> : null}
      {show('states') ? <States ctx={ctx} /> : null}
      {show('list') ? <List /> : null}
      {show('dialog') ? <DialogSection /> : null}
      {show('markdown') ? <MarkdownSection ctx={ctx} /> : null}
    </div>
  );
}

/** The gallery's own frames, inside the shadow root next to the kit's sheets. */
export const GALLERY_CSS = `
.gal { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); gap: 28px 32px; align-items: start; }
.gal-sec { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.gal-sec--wide { grid-column: 1 / -1; }
.gal-h { margin: 0; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 600; color: var(--cg-ink-muted); letter-spacing: 0.01em; }
.gal-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 30px; }
.gal-l { font-size: var(--cg-text-xs); color: var(--cg-ink-muted); }
.gal-v { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
.gal-sheet { background: var(--cg-surface); border: 1px solid var(--cg-rule); border-radius: var(--cg-r-xl); box-shadow: var(--cg-shadow); overflow: hidden; }
.gal-bare { background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); overflow: hidden; }
.gal-pad { padding: 12px 14px 14px var(--cg-gutter); }
.gal-strip { display: flex; align-items: center; gap: 4px; height: 40px; min-width: 0; margin-top: 8px; padding: 0 5px 0 1px; overflow: visible; background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow); }
.gal-strip--menu { margin-top: 196px; }
.gal-flex { display: inline-flex; align-items: center; gap: 4px; }
.gal-strip .cg-split .cg-act__t { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.gal-strip .cg-split { width: 26px; padding: 0; }
@container cg (max-width: 600px) { .gal-wide { display: none; } }
@container cg (max-width: 420px) {
  .gal-wide-420, .gal-mark { display: none; }
  .gal-strip { gap: 2px; padding: 0 3px; }
  .gal-acts { gap: 2px; }
  .gal-strip .cg-act:not(.cg-opt) { padding: 0 5px; }
  .gal-strip .cg-tones .cg-opt { width: 22px; }
  .gal-strip .cg-tones__track { gap: 2px; }
  .gal-strip .cg-more .cg-act__t { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .gal-strip .cg-more::before { content: "⋯"; }
  .gal-strip .cg-div { display: none; }
}
.gal-mark { width: 30px; height: 28px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--cg-clay); }
.gal-mark--off, .gal-faint { color: var(--cg-ink-faint); }
.gal-ink2 { color: var(--cg-ink-2); display: inline-flex; }
.gal-acts { display: flex; align-items: center; gap: 4px; flex: none; }
.gal-opts { display: flex; align-items: center; margin-left: auto; padding-left: 8px; min-width: 0; }
.gal-status { display: inline-flex; align-items: center; gap: 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); white-space: nowrap; padding: 0 4px; }
.gal-tips { display: flex; flex-wrap: wrap; gap: 10px; }
.gal-static { position: static !important; display: inline-block; }
.gal-menu-host { min-height: 150px; }
.gal-toasts { display: flex; flex-direction: column; gap: 8px; width: min(360px, 100%); }
.gal-head { display: flex; align-items: center; gap: 10px; min-height: 34px; padding-right: 4px; border-bottom: 1px solid var(--cg-rule); min-width: 0; }
.gal-bare .gal-head { border-color: var(--cg-bare-rule); }
.gal-head__g { width: calc(var(--cg-gutter) - 1px); display: inline-flex; justify-content: center; margin-right: -10px; flex: none; }
.gal-head b { font-weight: 600; color: var(--cg-ink-strong); }
.gal-head--top { border-top: 1px solid var(--cg-rule); border-bottom: 0; }
/* The dialog is a fixed layer-950 window over a scrim; the gallery shows it in place. */
.gal-dialog-frame .cg-scrim { display: none; }
.gal-dialog-frame .cg-dialog { position: relative; left: auto; top: auto; translate: none; width: 100%; max-width: 420px; }
.gal-stream { padding: 9px 10px 11px var(--cg-gutter); font-size: var(--cg-text-lg); line-height: 20px; color: var(--cg-ink); }
.gal-sheet > .cg-card + .cg-card, .gal-sheet > .cg-banner + .cg-banner { border-top: 1px solid var(--cg-rule); }
.gal-note { margin: 0; font-size: var(--cg-text-xs); color: var(--cg-ink-muted); }
.gal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; align-items: start; }
.gal-data { padding: 8px 16px; color: var(--cg-ink-muted); }
.gal-list { height: 242px; }
.gal-lrow { display: grid; grid-template-columns: minmax(0, 1fr) 96px; align-items: center; height: 100%; padding: 0 16px 0 20px; border-top: 1px solid var(--cg-rule); }
.gal-lrow > :last-child { text-align: right; }
.gal-lrow--head { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-top: 0; border-bottom: 1px solid var(--cg-rule); }
.gal-lrow--shelf { background: var(--cg-surface); color: var(--cg-ink-strong); }
.gal-lrow.gal-lrow--shelf > b { grid-column: 1 / -1; text-align: left; font-weight: 600; }
/* Pictures never catch an entrance mid-fade (the mockup's ?shot=1). */
.gal .cg-toast, .gal .cg-menu, .gal .cg-dialog { animation: none; }
.gal-empty { color: var(--cg-ink-faint); }
`;
