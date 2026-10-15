// The vault panel of a Fansly tab (docs/project-unite/architecture.md §7.11, §7.21; FS-VLT-1; VA-001…VA-006; R20
// P13b), in the family language (ui-design §1): on `/creator/vault` a raised chip «Загрузка» at the bottom right — the
// entry, one click (VA-001) — and above it, not a modal (the person still needs the page: «Upload to Vault», the
// album), the card of the upload: who and where, the set and the album's order, the files with their states, the
// question about an uncertain file (VA-004), the progress and why it stopped (VA-006), Start, pause, reset.
//
// Its model is `VaultPanelVM` from the panel's own client (contracts vault-fansly.ts), never the shared AppClient:
// a surface of Fansly's own. Its words are Fansly's (`fansly.vault.*` in Fansly's catalogs). The files come from two
// inputs of our own closed root — a folder and files — and go to the controller as the browser gives them; nothing
// here reads the page or a file's bytes.

import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type FanslyVaultPluralKey, type FanslyVaultTextKey, type VaultItemState, type VaultPanelClient, type VaultPanelNote, type VaultPanelVM, type VaultPlanProblem, type VaultPlanWarning, type VaultRunVM } from '@cg/contracts/vault-fansly';
import { type I18n, type I18nParams } from '@cg/contracts/vm';

import { Button, Dot, Icon, Segmented, Spinner, useI18n } from '../../../kit';

type Text = (key: FanslyVaultTextKey, params?: I18nParams) => string;

/** Fansly's own keys live in Fansly's catalog; the shared port takes them by name. */
function textOf(i18n: I18n): Text {
  return (key, params) => i18n.t(key as unknown as I18nKey, params);
}
const plural = (i18n: I18n, key: FanslyVaultPluralKey, count: number): string => i18n.plural(key as unknown as I18nKey, count);

const KIB = 1024;
/** «812 Б», «3,4 КБ», «120 МБ», «1,2 ГБ»: one decimal under ten. */
export function sizeText(i18n: I18n, bytes: number): string {
  const t = textOf(i18n);
  if (bytes < KIB) return t('fansly.vault.size.b', { n: bytes });
  const units = ['fansly.vault.size.kb', 'fansly.vault.size.mb', 'fansly.vault.size.gb'] as const;
  let value = bytes / KIB;
  let unit = 0;
  while (value >= KIB && unit < units.length - 1) {
    value /= KIB;
    unit += 1;
  }
  const n = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  return t(units[unit] as (typeof units)[number], { n });
}

const NOTE_KEYS: Readonly<Record<VaultPanelNote, FanslyVaultTextKey>> = {
  'read-failed': 'fansly.vault.note.readFailed',
  'save-failed': 'fansly.vault.note.saveFailed',
  'clear-failed': 'fansly.vault.note.clearFailed',
  'left-behind': 'fansly.vault.note.leftBehind',
  held: 'fansly.vault.note.held',
  moved: 'fansly.vault.note.moved',
};

const ITEM_KEYS: Readonly<Record<VaultItemState, FanslyVaultTextKey>> = {
  pending: 'fansly.vault.item.pending',
  present: 'fansly.vault.item.present',
  uploading: 'fansly.vault.item.uploading',
  verified: 'fansly.vault.item.verified',
  previous: 'fansly.vault.item.previous',
  failed: 'fansly.vault.item.failed',
  uncertain: 'fansly.vault.item.uncertain',
};

function problemText(t: Text, problem: VaultPlanProblem): string {
  switch (problem.kind) {
    case 'empty':
      return t('fansly.vault.problem.empty');
    case 'duplicate-keys':
      return t('fansly.vault.problem.duplicates', { names: problem.names.join(', ') });
    case 'too-many':
      return t('fansly.vault.problem.tooMany', { count: problem.count, max: problem.max });
  }
}

function warningText(t: Text, warning: VaultPlanWarning): string {
  const key = warning.kind === 'non-ascii' ? 'fansly.vault.warning.nonAscii' : warning.kind === 'nested-ignored' ? 'fansly.vault.warning.nested' : 'fansly.vault.warning.unsupported';
  return t(key, { n: warning.count });
}

function stopText(t: Text, run: VaultRunVM): string | null {
  const stop = run.stop;
  if (stop === null) return null;
  const album = run.album ?? '';
  if (stop.kind === 'order-mismatch') {
    return stop.actual === null || stop.actual === undefined ? t('fansly.vault.stop.order-unseen', { expected: stop.expected ?? '' }) : t('fansly.vault.stop.order-mismatch', { expected: stop.expected ?? '', actual: stop.actual });
  }
  if (stop.kind === 'checkpoint-write-failed') return t(stop.afterUpload === true ? 'fansly.vault.stop.checkpoint-after-upload' : 'fansly.vault.stop.checkpoint-write-failed');
  return t(`fansly.vault.stop.${stop.kind}`, { album });
}

/** The panel's model from its own client, kept current. */
function useVault(client: VaultPanelClient<File>): VaultPanelVM {
  const [view, setView] = useState(() => client.view());
  useEffect(() => {
    setView(client.view());
    return client.subscribe(setView);
  }, [client]);
  return view;
}

/** The person's files as the browser gives them: a folder (`webkitdirectory`) or files picked one by one. */
function FilePicker({ client, folder, label, reason }: { readonly client: VaultPanelClient<File>; readonly folder: boolean; readonly label: string; readonly reason: string | null }): JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="line" label={label} reason={reason} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-cg-vault-input={folder ? 'folder' : 'files'}
        {...(folder ? { webkitdirectory: true } : {})}
        onChange={(event) => {
          const element = event.currentTarget;
          const files = [...(element.files ?? [])];
          // The same folder may be picked twice in a row.
          element.value = '';
          if (files.length > 0) client.dispatch({ type: 'pick', files });
        }}
      />
    </>
  );
}

function Fact({ label, value, quiet }: { readonly label: string; readonly value: string; readonly quiet: boolean }): JSX.Element {
  return (
    <>
      <dt class="cg-vault__k">{label}</dt>
      <dd class={`cg-vault__v${quiet ? ' is-quiet' : ''}`}>{value}</dd>
    </>
  );
}

function Panel({ client, view }: { readonly client: VaultPanelClient<File>; readonly view: VaultPanelVM }): JSX.Element {
  const i18n = useI18n();
  const t = textOf(i18n);
  const card = useRef<HTMLElement>(null);
  const { controls, selection, run, question, resume } = view;
  const running = run !== null && (run.state === 'running' || run.state === 'pausing');
  useEffect(() => {
    card.current?.focus();
  }, []);

  const album = view.album.state === 'open' ? (view.album.title ?? '') : view.album.state === 'loading' ? t('fansly.vault.albumLoading') : t('fansly.vault.albumNone');
  const uploader = view.uploader === 'ready' ? t('fansly.vault.uploaderReady') : view.uploader === 'busy' ? t('fansly.vault.uploaderBusy') : t('fansly.vault.uploaderMissing');
  const subtitle = run === null || run.state === 'idle' ? t('fansly.vault.subtitle') : [view.account, run.album, t('fansly.vault.progress', { done: run.done, total: run.total })].filter((part) => part !== null && part !== '').join(' · ');
  const notes: Array<{ readonly tone: 'problem' | 'warning' | 'info'; readonly text: string }> = [
    ...(selection?.problems ?? []).map((problem) => ({ tone: 'problem' as const, text: problemText(t, problem) })),
    ...(selection?.warnings ?? []).map((warning) => ({ tone: 'warning' as const, text: warningText(t, warning) })),
    ...(resume === null ? [] : [{ tone: 'info' as const, text: t(`fansly.vault.resume.${resume.kind}`, { done: resume.done, total: resume.total }) }]),
    ...(view.note === null ? [] : [{ tone: 'problem' as const, text: t(NOTE_KEYS[view.note]) }]),
  ];
  const stop = run === null ? null : stopText(t, run);
  const progress = run === null || run.total === 0 ? null : Math.round((run.done / run.total) * 100);
  const blocked = controls.blocked === null ? null : t(`fansly.vault.blocked.${controls.blocked}`);

  return (
    <section
      ref={card}
      class="cg-vault__card"
      role="dialog"
      aria-label={t('fansly.vault.title')}
      tabIndex={-1}
      onPointerEnter={() => client.dispatch({ type: 'refresh' })}
      onFocusIn={(event) => {
        if (event.relatedTarget === null || !event.currentTarget.contains(event.relatedTarget as Node)) client.dispatch({ type: 'refresh' });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && controls.close) {
          event.preventDefault();
          event.stopPropagation();
          client.dispatch({ type: 'close' });
        }
      }}
    >
      <header class="cg-vault__head">
        <div class="cg-vault__heading">
          <div class="cg-vault__title">{t('fansly.vault.title')}</div>
          <div class="cg-vault__sub">{subtitle}</div>
        </div>
        <Button variant="quiet" size="sm" iconOnly icon="collapse" label={t('fansly.vault.minimize')} {...(controls.close ? {} : { reason: t('fansly.vault.closeBlocked') })} onClick={() => client.dispatch({ type: 'minimize' })} />
        <Button variant="quiet" size="sm" iconOnly icon="x" label={t('fansly.vault.close')} {...(controls.close ? {} : { reason: t('fansly.vault.closeBlocked') })} onClick={() => client.dispatch({ type: 'close' })} />
      </header>

      <div class="cg-vault__body">
        <dl class="cg-vault__facts">
          <Fact label={t('fansly.vault.account')} value={view.account ?? t('fansly.vault.accountUnknown')} quiet={view.account === null} />
          <Fact label={t('fansly.vault.album')} value={album} quiet={view.album.state !== 'open'} />
          <Fact label={t('fansly.vault.uploader')} value={uploader} quiet={view.uploader !== 'ready'} />
        </dl>

        <div class="cg-vault__row">
          <FilePicker client={client} folder label={t('fansly.vault.pickFolder')} reason={controls.pick ? null : t('fansly.vault.blocked.running')} />
          <FilePicker client={client} folder={false} label={t('fansly.vault.pickFiles')} reason={controls.pick ? null : t('fansly.vault.blocked.running')} />
        </div>

        <div class="cg-vault__order">
          <span class="cg-vault__k">{t('fansly.vault.order')}</span>
          <Segmented
            label={t('fansly.vault.order')}
            value={view.order}
            options={[
              { value: 'first-on-top', label: t('fansly.vault.orderFirst'), ...(controls.pick ? {} : { reason: t('fansly.vault.blocked.running') }) },
              { value: 'last-on-top', label: t('fansly.vault.orderLast'), ...(controls.pick ? {} : { reason: t('fansly.vault.blocked.running') }) },
            ]}
            onChange={(order) => client.dispatch({ type: 'order', order })}
          />
        </div>
        <p class="cg-vault__hint">{t('fansly.vault.orderHint')}</p>

        {notes.length === 0 && !view.resetArmed ? null : (
          <div class="cg-vault__notes">
            {notes.map((note, index) => (
              <p key={index} class={`cg-vault__note is-${note.tone}`}>
                {note.text}
              </p>
            ))}
            {view.resetArmed ? (
              <div class="cg-vault__confirm">
                <span>{t('fansly.vault.resetConfirm')}</span>
                <Button variant="line" size="sm" label={t('fansly.vault.resetYes')} onClick={() => client.dispatch({ type: 'reset' })} />
                <Button variant="quiet" size="sm" label={t('fansly.vault.resetNo')} onClick={() => client.dispatch({ type: 'reset-cancel' })} />
              </div>
            ) : null}
          </div>
        )}

        {question === null ? null : (
          <div class="cg-vault__ask" role="group" aria-label={t('fansly.vault.question.title', { name: question.name })}>
            <p class="cg-vault__ask-t">{t('fansly.vault.question.title', { name: question.name })}</p>
            <p class="cg-vault__ask-b">{t('fansly.vault.question.body')}</p>
            <div class="cg-vault__row">
              <button type="button" class="cg-act cg-act--main" {...(view.busy ? { 'aria-disabled': 'true' } : {})} onClick={() => view.busy || client.dispatch({ type: 'answer', answer: 'present' })}>
                <span class="cg-act__t">{t('fansly.vault.question.present')}</span>
              </button>
              <Button variant="line" label={t('fansly.vault.question.missing')} {...(view.busy ? { busy: true } : {})} onClick={() => client.dispatch({ type: 'answer', answer: 'missing' })} />
            </div>
          </div>
        )}

        <div class="cg-vault__set">
          <div class="cg-vault__set-t">
            {selection === null
              ? t('fansly.vault.empty')
              : [selection.folder, plural(i18n, 'fansly.vault.files', selection.items.length), sizeText(i18n, selection.bytes)].filter((part) => part !== null).join(' · ')}
          </div>
          {selection === null || selection.items.length === 0 ? null : (
            <ol class="cg-vault__list">
              {selection.items.map((item, index) => (
                <li key={item.name} class={`cg-vault__item is-${item.state}`} data-cg-vault-item={item.state} title={item.name}>
                  <span class="cg-vault__n">{index + 1}</span>
                  <span class="cg-vault__name">{item.name}</span>
                  <span class="cg-vault__size">{sizeText(i18n, item.size)}</span>
                  <span class="cg-vault__state">
                    {item.state === 'uploading' ? <Spinner /> : item.state === 'failed' ? <Dot kind="danger" size={6} /> : null}
                    {t(ITEM_KEYS[item.state])}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {run === null ? null : (
          <div class="cg-vault__run">
            {progress === null ? null : (
              <div class="cg-vault__track" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done} aria-label={t('fansly.vault.progress', { done: run.done, total: run.total })}>
                <div class="cg-vault__bar" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div class="cg-vault__status" role="status" aria-live="polite" data-cg-vault-run={run.state}>
              <p class="cg-vault__line is-strong">{t('fansly.vault.progress', { done: run.done, total: run.total })}</p>
              {run.current === null ? null : <p class="cg-vault__line">{t('fansly.vault.current', { name: run.current })}</p>}
              {run.state === 'pausing' ? <p class="cg-vault__line">{t('fansly.vault.pausing')}</p> : null}
              {run.state === 'paused' ? <p class="cg-vault__line">{t('fansly.vault.paused')}</p> : null}
              {stop === null ? null : (
                <>
                  <p class="cg-vault__line cg-vault__err" data-cg-vault-stop={run.stop?.kind ?? ''}>
                    <Dot kind="danger" size={6} />
                    {t('fansly.vault.errorFrom', { code: run.code ?? 'CG-VAULT-STOPPED' })}
                  </p>
                  <p class="cg-vault__line">{stop}</p>
                </>
              )}
              {run.report === null ? null : (
                <>
                  <p class="cg-vault__line is-strong">{t('fansly.vault.complete')}</p>
                  <p class="cg-vault__line">{t('fansly.vault.report.uploaded', { n: run.report.uploaded })}</p>
                  {run.report.present === 0 ? null : <p class="cg-vault__line">{t('fansly.vault.report.present', { n: run.report.present })}</p>}
                  {run.report.previous === 0 ? null : <p class="cg-vault__line">{t('fansly.vault.report.previous', { n: run.report.previous })}</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <footer class="cg-vault__foot">
        <button
          type="button"
          class="cg-act cg-act--main"
          data-cg-vault-start=""
          {...(blocked === null ? {} : { 'aria-disabled': 'true', title: blocked })}
          onClick={() => {
            if (blocked === null) client.dispatch({ type: 'start' });
          }}
        >
          <span class="cg-act__t">{t(controls.start === 'resume' ? 'fansly.vault.resumeRun' : 'fansly.vault.start')}</span>
        </button>
        {running ? <Button variant="line" label={t(run?.state === 'pausing' ? 'fansly.vault.pausing' : 'fansly.vault.pause')} {...(run?.state === 'pausing' ? { busy: true } : {})} onClick={() => client.dispatch({ type: 'pause' })} /> : null}
        <span class="cg-vault__spacer" />
        {controls.reset && !view.resetArmed ? <Button variant="quiet" size="sm" label={t('fansly.vault.reset')} onClick={() => client.dispatch({ type: 'reset' })} /> : null}
      </footer>
      <p class="cg-vault__foot-note">{t('fansly.vault.footnote')}</p>
    </section>
  );
}

/** The panel's surface: the entry, the card or its strip, by the model. */
export function VaultView({ client }: { readonly client: VaultPanelClient<File> }): JSX.Element | null {
  const view = useVault(client);
  const i18n = useI18n();
  const t = textOf(i18n);
  if (!view.shown) return null;
  if (view.mode === 'open') return <Panel client={client} view={view} />;
  const run = view.run;
  const strip = view.mode === 'minimized' && run !== null ? `${t('fansly.vault.title')} · ${t('fansly.vault.progress', { done: run.done, total: run.total })}` : null;
  return (
    <button
      type="button"
      class={`cg-vault__entry${run !== null && (run.state === 'running' || run.state === 'pausing') ? ' is-busy' : ''}`}
      data-cg-vault-entry={view.mode}
      title={t('fansly.vault.entryHint')}
      aria-label={strip ?? t('fansly.vault.entryHint')}
      onClick={() => client.dispatch({ type: 'open' })}
    >
      <span class="cg-vault__glyph" aria-hidden="true">
        ↑
      </span>
      <span>{strip ?? t('fansly.vault.entry')}</span>
      {run?.stop === null || run === null || view.mode !== 'minimized' ? null : <Dot kind="danger" size={6} />}
      {view.mode === 'minimized' ? <Icon name="expand" size={12} /> : null}
    </button>
  );
}
