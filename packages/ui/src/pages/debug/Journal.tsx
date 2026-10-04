// debug-journal.html (architecture.md §9.2, §9.3; ui-design §10; NF-029):
// the journals of debug mode — operations, hub calls, preview sends and the
// «Новые» check — as service records: a time, a level, a scope, a fixed
// message with machine fields. No message of a fan, no draft, no prompt
// exists in a record. The page filters by level and scope, shows the records
// in pages, and reads the journal again every few seconds while it is the
// visible tab (a switch turns that off). «Копировать» and «Сохранить .txt»
// take the journal as it was read. With debug off or after a sign-out the
// page shows nothing it had read before (§9.3).

import { type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { JOURNAL_KINDS, type JournalKind, type JournalVM } from '@cg/contracts/vm';

import { Button, Checkbox, ErrorCard, Spinner, Tabs, useI18n, useView } from '../../kit';
import { Picker } from '../options/controls';
import { JOURNAL_NAME_KEYS } from '../options/Diagnostics';
import { PageLayers, useAct } from '../shared';

/** Records on one page of the table. */
export const JOURNAL_PAGE_SIZE = 100;
/** How often an open, visible journal is read again. */
export const JOURNAL_REFRESH_MS = 5_000;

const ALL = '*';
type Entry = JournalVM['entries'][number];

function JournalBody({ journal }: { readonly journal: JournalKind }): JSX.Element {
  const vm = useView({ of: 'journal', journal }).value;
  const i18n = useI18n();
  const act = useAct();
  const view = vm.view;
  const [level, setLevel] = useState<string>(ALL);
  const [scope, setScope] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const reload = (): void => void act({ type: 'ReloadView', selector: { of: 'journal', journal } }, { quiet: true });
  // Only a page that shows records reads them again: debug off, signed out or a failed read wait for a click.
  const live = auto && (view.s === 'ready' || view.s === 'partial' || view.s === 'empty');

  // NF-029 «автообновление»: a read, never a write — while this tab is the one on screen.
  useEffect(() => {
    if (!live) return undefined;
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void act({ type: 'ReloadView', selector: { of: 'journal', journal } }, { quiet: true });
    }, JOURNAL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, journal, act]);

  const all = (value: string): string => (value === ALL ? i18n.t('debugPage.journal.filterAll') : value);
  const levels = [...new Set(vm.entries.map((entry) => entry.level))];
  const scopes = [...new Set(vm.entries.map((entry) => entry.scope))].sort();
  // A filter whose value is no longer in the journal (it was read again) filters nothing.
  const byLevel = level !== ALL && levels.some((value) => value === level) ? level : ALL;
  const byScope = scope !== ALL && scopes.includes(scope) ? scope : ALL;
  const matching: readonly Entry[] = vm.entries.filter((entry) => (byLevel === ALL || entry.level === byLevel) && (byScope === ALL || entry.scope === byScope));
  const pages = Math.max(1, Math.ceil(matching.length / JOURNAL_PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const shown = matching.slice(at * JOURNAL_PAGE_SIZE, (at + 1) * JOURNAL_PAGE_SIZE);
  const filtered = byLevel !== ALL || byScope !== ALL;
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
        view.error.code === 'CG-FEATURE-DISABLED' ? (
          <div role="status" data-pg-journal="debug-off">
            <p class="pg-lead">{i18n.t('debugPage.journal.debugOff')}</p>
            {view.remedy === null ? null : <Button label={i18n.t('common.settings')} variant="line" onClick={() => void act(view.remedy ?? { type: 'OpenSettings', route: { section: 'generation' } })} />}
          </div>
        ) : (
          // Nobody is signed in: the journals of the last sign-in are not shown any more.
          <div role="status" data-pg-journal="signed-out" data-cg-code={view.error.code}>
            <p class="pg-lead">{view.error.title}</p>
            {view.remedy === null ? null : <Button label={i18n.t('common.signIn')} variant="line" onClick={() => void act(view.remedy ?? { type: 'OpenSettings', route: { section: 'account' } })} />}
          </div>
        )
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
      {view.s === 'ready' || view.s === 'partial' || view.s === 'empty' ? (
        <div class="pg-debug__filters" data-pg-journal="filters">
          {vm.entries.length === 0 ? null : (
            <>
              <span>{i18n.t('debugPage.journal.col.level')}</span>
              <Picker
                label={i18n.t('debugPage.journal.col.level')}
                text={all(byLevel)}
                value={byLevel}
                options={[ALL, ...levels].map((value) => ({ value, label: all(value) }))}
                onChange={(value) => {
                  setLevel(value);
                  setPage(0);
                }}
              />
              <span>{i18n.t('debugPage.journal.col.scope')}</span>
              <Picker
                label={i18n.t('debugPage.journal.col.scope')}
                text={all(byScope)}
                value={byScope}
                options={[ALL, ...scopes].map((value) => ({ value, label: all(value) }))}
                onChange={(value) => {
                  setScope(value);
                  setPage(0);
                }}
              />
              {filtered ? <span role="status">{i18n.t('debugPage.journal.matched', { n: matching.length, total: vm.entries.length })}</span> : null}
            </>
          )}
          <Checkbox label={i18n.t('debugPage.journal.auto')} checked={auto} size={14} onChange={setAuto} />
        </div>
      ) : null}
      {vm.entries.length > 0 && matching.length === 0 ? (
        <p class="pg-note" role="status">
          {i18n.t('debugPage.journal.filterNone')}
        </p>
      ) : null}
      {shown.length === 0 ? null : (
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
              {shown.map((entry, index) => (
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
      {pages <= 1 ? null : (
        <nav class="pg-debug__pager" aria-label={i18n.t('debugPage.journal.page', { page: at + 1, pages })} data-pg-journal="pager">
          <Button label={i18n.t('debugPage.journal.prev')} variant="line" size="sm" reason={at === 0 ? i18n.t('debugPage.journal.page', { page: 1, pages }) : null} onClick={() => setPage(at - 1)} />
          <span role="status">{i18n.t('debugPage.journal.page', { page: at + 1, pages })}</span>
          <Button label={i18n.t('debugPage.journal.next')} variant="line" size="sm" reason={at >= pages - 1 ? i18n.t('debugPage.journal.page', { page: pages, pages }) : null} onClick={() => setPage(at + 1)} />
        </nav>
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
