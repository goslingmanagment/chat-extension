// «Аккаунты» (architecture.md §9.9; ST-067…ST-078): the OnlyMonster accounts
// this browser has seen, in three groups — at work now, seen before, never
// opened here. A local label of up to 60 characters, the hub page and its
// persona, the sound of the model, and «к вкладке»: ChatSpace's own router
// opens the account, by this click only (Б13).

import { type JSX } from 'preact';

import { type AccountsBodyVM } from '@cg/contracts/vm';

import { ActionButton, Button, Checkbox, useI18n } from '../../kit';
import { PageTag, useAct } from '../shared';
import { Field } from './controls';

type Row = AccountsBodyVM['rows'][number];

const GROUPS = [
  ['working', 'settings.accounts.group.working'],
  ['seen', 'settings.accounts.group.seen'],
  ['no-sessions', 'settings.accounts.group.noSessions'],
] as const;

function AccountRow({ row, readOnly }: { readonly row: Row; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const locked = readOnly ? i18n.t('cg.storageVersion.title') : null;
  const hosted = row.status !== 'no-sessions';
  return (
    <div class="pg-acc" data-pg-account={row.accountHandle}>
      <div class="pg-acc__head">
        <b>{row.title}</b>
        {row.username === null || row.title.includes(row.username) ? null : <span class="pg-muted">@{row.username.replace(/^@/, '')}</span>}
        {row.localLabel === null ? null : <span class="pg-chip">{row.localLabel}</span>}
        <span class="pg-acc__acts">
          {hosted ? <Button label={i18n.t('settings.accounts.copyId')} variant="quiet" size="sm" icon="copy" onClick={() => void act({ type: 'Copy', artifactHandle: `account-id:${row.accountHandle}` }, { success: i18n.t('popup.copiedId') })} /> : null}
          <ActionButton vm={row.goTo} variant="line" />
        </span>
      </div>
      <dl class="pg-acc__grid">
        {hosted ? (
          <>
            <dt>{i18n.t('settings.accounts.label')}</dt>
            <dd>
              <Field
                label={i18n.t('settings.accounts.label')}
                value={row.localLabel ?? ''}
                placeholder={i18n.t('settings.accounts.labelPlaceholder')}
                maxLength={60}
                reason={locked}
                onInput={(value) => void act({ type: 'SetAccountLabel', accountHandle: row.accountHandle, label: value.trim() === '' ? null : value.trim().slice(0, 60) }, { quiet: true })}
              />
            </dd>
          </>
        ) : null}
        <dt>{i18n.t('settings.accounts.hubPage')}</dt>
        <dd class={row.pageName === null ? 'pg-muted' : 'pg-value'}>
          {row.pageName ?? i18n.t('settings.accounts.pageNone')}
          {row.pageName === null ? null : <PageTag tag={row.page} />}
        </dd>
        <dt>{i18n.t('settings.accounts.persona')}</dt>
        <dd class={row.persona === null ? 'pg-muted' : 'pg-value'}>{row.persona ?? i18n.t('settings.personas.none')}</dd>
        {hosted ? (
          <>
            <dt>{i18n.t('settings.accounts.sound')}</dt>
            <dd>
              <Checkbox
                label={i18n.t('settings.accounts.sound')}
                stateWord={i18n.t('settings.accounts.soundOn')}
                checked={!row.muted}
                size={14}
                reason={locked}
                onChange={(on) => void act({ type: 'SetAccountMuted', accountHandle: row.accountHandle, muted: !on }, { quiet: true })}
              />
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

export function AccountsSection({ body, readOnly }: { readonly body: AccountsBodyVM; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const hosted = body.rows.filter((row) => row.status !== 'no-sessions');
  const live = hosted.filter((row) => row.status === 'working').length;
  if (body.rows.length === 0) return <p class="pg-note">{i18n.t('settings.accounts.empty')}</p>;
  return (
    <>
      <p class="pg-note" style={{ margin: 0 }}>
        {i18n.t('settings.accounts.count', { live, total: hosted.length })} · {i18n.t('settings.accounts.workingHint')} {i18n.t('settings.accounts.labelHint')}.
      </p>
      {GROUPS.map(([status, key]) => {
        const rows = body.rows.filter((row) => row.status === status);
        if (rows.length === 0) return null;
        return (
          <section key={status} aria-label={i18n.t(key)}>
            <h2 class="pg-group">{i18n.t(key)}</h2>
            {rows.map((row) => (
              <AccountRow key={row.accountHandle} row={row} readOnly={readOnly} />
            ))}
          </section>
        );
      })}
    </>
  );
}
