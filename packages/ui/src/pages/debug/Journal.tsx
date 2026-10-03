// debug-journal.html (architecture.md §9.2, §9.3; ui-design §10; NF-029):
// the journals of debug mode — operations, hub calls, preview sends and the
// «Новые» check — as service records: a time, a level, a scope, a fixed
// message with machine fields. No message of a fan, no draft, no prompt
// exists in a record. «Копировать» and «Сохранить .txt» take what is shown.

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { JOURNAL_KINDS, type JournalKind } from '@cg/contracts/vm';

import { Button, ErrorCard, Spinner, Tabs, useI18n, useView } from '../../kit';
import { JOURNAL_NAME_KEYS } from '../options/Diagnostics';
import { PageLayers, useAct } from '../shared';

function JournalBody({ journal }: { readonly journal: JournalKind }): JSX.Element {
  const vm = useView({ of: 'journal', journal }).value;
  const i18n = useI18n();
  const act = useAct();
  const view = vm.view;
  const reload = (): void => void act({ type: 'ReloadView', selector: { of: 'journal', journal } }, { quiet: true });
  return (
    <div id={`pg-journal-${journal}`} role="tabpanel" aria-labelledby={`pg-journal-tab-${journal}`}>
      <div class="pg-debug__meta">
        <span>{i18n.t('debugPage.journal.lead')}</span>
        <span class="pg-debug__acts">
          <Button label={i18n.t('debugPage.journal.refresh')} variant="quiet" icon="refresh" onClick={reload} />
          {vm.copyHandle === null ? null : (
            <Button label={i18n.t('common.copy')} variant="line" icon="copy" onClick={() => void act({ type: 'Copy', artifactHandle: vm.copyHandle ?? '' }, { success: i18n.t('common.copied') })} />
          )}
          <Button
            label={i18n.text(vm.save.label)}
            variant="line"
            reason={vm.save.enabled ? null : vm.save.reason === null ? i18n.t('common.unknown') : i18n.text(vm.save.reason.text)}
            onClick={() => void act(vm.save.action)}
          />
        </span>
      </div>
      {view.s === 'loading' ? (
        <div class="cg-state cg-state--loading" role="status" aria-busy="true" style={{ paddingLeft: 0 }}>
          <Spinner />
          <span>{i18n.t('common.loading')}</span>
        </div>
      ) : null}
      {view.s === 'empty' ? (
        <p class="pg-note" role="status">
          {i18n.text(view.why)}
        </p>
      ) : null}
      {view.s === 'forbidden' ? (
        <div role="status" data-pg-journal="debug-off">
          <p class="pg-lead">{i18n.t('debugPage.journal.debugOff')}</p>
          {view.remedy === null ? null : <Button label={i18n.t('common.settings')} variant="line" onClick={() => void act(view.remedy ?? { type: 'OpenSettings', route: { section: 'generation' } })} />}
        </div>
      ) : null}
      {view.s === 'error' || view.s === 'offline' ? (
        <ErrorCard tone="failure" error={view.error}>
          <Button label={i18n.t('common.retry')} variant="line" onClick={reload} />
        </ErrorCard>
      ) : null}
      {vm.truncated ? (
        <p class="pg-note" role="status">
          {i18n.t('debugPage.journal.truncated')}
        </p>
      ) : null}
      {vm.runs === null || vm.runs.length === 0 ? null : (
        <>
          <h2 class="pg-h2">{i18n.t('debugPage.journal.runs')}</h2>
          <ul class="pg-list">
            {vm.runs.map((run) => (
              <li key={run.id}>
                <span>{i18n.t('debugPage.journal.run', { time: { time: run.startedAt, style: 'datetime' }, n: run.events })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {vm.entries.length === 0 ? null : (
        // A journal is a table of machine records: on a narrow window it scrolls sideways inside its own frame.
        <div class="pg-scroll" tabIndex={0} role="group" aria-label={i18n.t(JOURNAL_NAME_KEYS[journal])}>
          <table class="pg-table pg-journal">
          <thead>
            <tr>
              <th scope="col">{i18n.t('debugPage.journal.col.time')}</th>
              <th scope="col">{i18n.t('debugPage.journal.col.level')}</th>
              <th scope="col">{i18n.t('debugPage.journal.col.scope')}</th>
              <th scope="col">{i18n.t('debugPage.journal.col.text')}</th>
            </tr>
          </thead>
          <tbody>
            {vm.entries.map((entry, index) => (
              <tr key={index} class={`is-${entry.level}`}>
                {/* UTC, as the hub's own logs say it: a journal is read next to them. */}
                <td>{Number.isFinite(entry.at) ? new Date(entry.at).toISOString().slice(11, 23) : '—'}</td>
                <td>{entry.level}</td>
                <td>{entry.scope}</td>
                <td>
                  {entry.code === null ? null : `${entry.code} `}
                  {entry.text}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DebugJournal({ initial }: { readonly initial: JournalKind }): JSX.Element {
  const i18n = useI18n();
  const [journal, setJournal] = useState<JournalKind>(initial);
  return (
    <main class="pg-debug" aria-label={i18n.t('debugPage.journal.title')}>
      <h1 class="pg-h1">{i18n.t('debugPage.journal.title')}</h1>
      <div style={{ margin: '12px 0 16px' }}>
        <Tabs
          label={i18n.t('debugPage.journal.kinds')}
          idPrefix="pg-journal"
          value={journal}
          tabs={JOURNAL_KINDS.map((kind) => ({ value: kind, label: i18n.t(JOURNAL_NAME_KEYS[kind]) }))}
          onChange={setJournal}
        />
      </div>
      <JournalBody key={journal} journal={journal} />
      <PageLayers />
    </main>
  );
}
