// debug-prompt.html (architecture.md §9.3; ui-design §10; DB-004…DB-008):
// the prompt of one generation, as the hub echoed it. The page is not
// web-accessible and the snapshot comes by an opaque token that is never
// drawn. «Копировать промпт» is an explicit click here and nowhere else.
// When there is no prompt the page says why: the snapshot expired, the hub
// sent no echo, the answer came from a cache, or debug mode is off.

import { type JSX } from 'preact';

import { type DebugPromptVM } from '@cg/contracts/vm';

import { Button, ErrorCard, Spinner, useI18n, useView } from '../../kit';
import { PageLayers, useAct } from '../shared';

function Explanation({ vm, token }: { readonly vm: DebugPromptVM; readonly token: string }): JSX.Element | null {
  const i18n = useI18n();
  const act = useAct();
  const view = vm.view;
  if (view.s === 'loading') {
    return (
      <div class="cg-state cg-state--loading" role="status" aria-busy="true" style={{ paddingLeft: 0 }}>
        <Spinner />
        <span>{i18n.t('common.loading')}</span>
      </div>
    );
  }
  if (view.s === 'empty') {
    return (
      <p class="pg-lead" role="status" data-pg-prompt="no-echo">
        {i18n.text(view.why)}
      </p>
    );
  }
  if (view.s === 'error') {
    // An expired snapshot is not a failure to retry: it is gone, and the page says how to get a new one.
    return (
      <div role="status" data-pg-prompt="expired">
        <h2 class="pg-h2" style={{ marginTop: 0 }}>
          {i18n.t('debugPage.prompt.expiredTitle')}
        </h2>
        <p class="pg-lead">{i18n.t('debugPage.prompt.expiredBody')}</p>
      </div>
    );
  }
  if (view.s === 'forbidden') {
    return (
      <div role="status" data-pg-prompt="debug-off">
        <p class="pg-lead">{i18n.t('debugPage.prompt.debugOff')}</p>
        {view.remedy === null ? null : <Button label={i18n.t('common.settings')} variant="line" onClick={() => void act(view.remedy ?? { type: 'OpenSettings', route: { section: 'generation' } })} />}
      </div>
    );
  }
  if (view.s === 'offline') {
    return (
      <ErrorCard tone="failure" error={view.error}>
        <Button label={i18n.t('common.retry')} variant="line" onClick={() => void act(view.retry ?? { type: 'ReloadView', selector: { of: 'debug-prompt', token } }, { quiet: true })} />
      </ErrorCard>
    );
  }
  return null;
}

export function DebugPrompt({ token }: { readonly token: string }): JSX.Element {
  const vm = useView({ of: 'debug-prompt', token }).value;
  const i18n = useI18n();
  const act = useAct();
  const has = vm.view.s === 'ready' || vm.view.s === 'partial';
  return (
    <main class="pg-debug" aria-label={i18n.t('debugPage.prompt.title')}>
      <h1 class="pg-h1">{i18n.t('debugPage.prompt.title')}</h1>
      <p class="pg-lead">{i18n.t('debugPage.prompt.lead')}</p>
      <Explanation vm={vm} token={token} />
      {has ? (
        <>
          <div class="pg-debug__meta">
            {vm.source === null ? null : <span class="pg-chip">{i18n.t(vm.source === 'cache' ? 'debugPage.prompt.source.cache' : 'debugPage.prompt.source.echo')}</span>}
            {vm.createdAt === null ? null : <span>{i18n.t('debugPage.prompt.captured', { time: { time: vm.createdAt } })}</span>}
            {vm.expiresAt === null ? null : <span>{i18n.t('debugPage.prompt.expires', { time: { time: vm.expiresAt } })}</span>}
            {vm.copyHandle === null ? null : (
              <Button label={i18n.t('debugPage.prompt.copy')} variant="line" icon="copy" onClick={() => void act({ type: 'Copy', artifactHandle: vm.copyHandle ?? '' }, { success: i18n.t('common.copied') })} />
            )}
          </div>
          <section aria-label={i18n.t('debugPage.prompt.blocks')}>
            {vm.blocks.map((block, index) => (
              <div key={index} class="pg-block">
                <div class="pg-block__head">
                  <span>{block.name}</span>
                  {block.truncated ? <span class="pg-tag">{i18n.t('debugPage.prompt.truncated')}</span> : null}
                </div>
                <pre class="pg-pre">{block.text}</pre>
              </div>
            ))}
          </section>
          {vm.manifest === null ? null : (
            <div class="pg-block">
              <div class="pg-block__head">
                <span>{i18n.t('debugPage.prompt.manifest')}</span>
                {vm.manifest.truncated ? <span class="pg-tag">{i18n.t('debugPage.prompt.truncated')}</span> : null}
              </div>
              <pre class="pg-pre">{vm.manifest.text}</pre>
            </div>
          )}
        </>
      ) : null}
      <PageLayers />
    </main>
  );
}
