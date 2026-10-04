// «Персоны» (architecture.md §9.9; ST-060…ST-065): the catalog is the hub's
// and read-only here; a page gets one of its active personas, an archived or
// missing one asks for a replacement. What is stored is a reference, never a
// prompt (§8.2).

import { type JSX } from 'preact';

import { type PersonasBodyVM, type VmView } from '@cg/contracts/vm';

import { Button, Dot, useI18n } from '../../kit';
import { useAct } from '../shared';
import { Picker } from './controls';

export function PersonasSection({ body, view, readOnly }: { readonly body: PersonasBodyVM; readonly view: VmView; readonly readOnly: boolean }): JSX.Element {
  const i18n = useI18n();
  const act = useAct();
  const locked = readOnly ? i18n.t('cg.storageVersion.title') : null;
  const pagesOn = (label: string): string[] => body.pages.filter((page) => page.persona === label).map((page) => page.pageName);
  return (
    <>
      <div class="pg-line">
        <span class="pg-muted">{body.syncedAt === null ? i18n.t('settings.personas.syncNever') : i18n.t('settings.personas.syncedAt', { time: { time: body.syncedAt } })}</span>
        <Button label={i18n.t('settings.personas.syncNow')} variant="line" icon="refresh" onClick={() => void act({ type: 'RecheckStatus' })} />
        <button type="button" class="pg-link" onClick={() => void act({ type: 'OpenSettings', route: { section: 'accounts' } })}>
          {i18n.t('settings.personas.toAccounts')}
        </button>
      </div>

      <h2 class="pg-h2">{i18n.t('settings.personas.pages')}</h2>
      {body.pages.length === 0 ? (
        <p class="pg-note">{i18n.t('settings.personas.emptyPages')}</p>
      ) : (
        <ul class="pg-list pg-zone" data-pg-anchor="pages">
          {body.pages.map((page) => (
            <li key={page.pageHandle} data-pg-page={page.pageHandle}>
              <b>{page.pageName}</b>
              <Picker
                label={i18n.t('settings.personas.choose', { page: page.pageName })}
                text={page.persona ?? i18n.t('settings.personas.none')}
                value={page.choices.find((choice) => choice.label === page.persona)?.key ?? null}
                options={page.choices.map((choice) => ({ value: choice.key, label: choice.label }))}
                reason={locked ?? (page.choices.length === 0 ? i18n.t('settings.personas.emptyCatalog') : null)}
                onChange={(key) => {
                  const choice = page.choices.find((entry) => entry.key === key);
                  if (choice !== undefined) void act(choice.choose, { quiet: true });
                }}
              />
              {page.replacementNeeded ? (
                <span class="pg-line">
                  <Dot kind="ring" />
                  {page.persona === null ? i18n.t('settings.personas.notFound') : i18n.t('settings.personas.archived')}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h2 class="pg-h2">{i18n.t('settings.personas.catalog')}</h2>
      <p class="pg-note" style={{ margin: '0 0 6px' }}>
        {i18n.t('settings.personas.readOnly')}
      </p>
      {body.catalog.length === 0 ? (
        // ST-063: an empty catalog says which kind of empty it is.
        <p class="pg-note">{view.s === 'offline' || view.s === 'error' ? i18n.t('settings.personas.unavailable') : body.syncedAt === null ? i18n.t('settings.personas.loading') : i18n.t('settings.personas.emptyCatalog')}</p>
      ) : (
        <ul class="pg-list">
          {body.catalog.map((persona) => {
            const pages = pagesOn(persona.label);
            return (
              <li key={persona.key}>
                <b>
                  {persona.label}
                  {persona.archived ? <span class="pg-tag">{i18n.t('settings.personas.archivedTag')}</span> : null}
                </b>
                <span>{pages.length === 0 ? i18n.t('settings.personas.unused') : i18n.t('settings.personas.onIt', { pages: pages.join(', ') })}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
