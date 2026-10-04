// TEMPORARY (integration step M1; R14 builds the real dock from scratch, X7,
// and R11 its controller): a status row for the live smoke. It proves the
// whole path — the dock host above ChatSpace's composer, the kit in a closed
// shadow root, the AppClient router, the hub sign-in and the binding — and
// shows what the smoke checks: who is signed in, which hub page the open
// account is bound to (or the CG-BINDING-* code), the host contract, and the
// «перезагрузите вкладку» banner. No AI action lives here.
//
// The dock's status and banner come through AppClient like every view model
// (`useView({ of: 'dock' })`). The three smoke lines have no place in DockVM
// (the real dock never shows them), so the composition root hands them in as
// a value signal next to the mount.

import { type JSX } from 'preact';

import { type CgCode } from '@cg/contracts/errors';
import { type DockStatus, type ValueSignal } from '@cg/contracts/vm';

import { useI18n, useView } from '../kit/context';
import { StatusBanner } from '../kit/components/ErrorCard';
import { GooseMark } from '../kit/components/Icon';
import { useValueSignal } from '../kit/signals';
import { type StyleSource } from '../kit/styles';

/** The smoke lines (the temporary controller of core/application produces exactly this). */
export interface TempDockSmokeModel {
  readonly status: DockStatus;
  readonly code: CgCode | null;
  readonly login: string | null;
  readonly sessionKnown: boolean;
  readonly page: { readonly label: string; readonly title: string | null } | null;
  readonly bindingCode: CgCode | null;
  readonly contract: { readonly state: 'unknown' | 'ok' | 'degraded' | 'broken'; readonly build: string | null; readonly anchors: readonly string[] };
  readonly reload: boolean;
}

export interface TempDockStatusProps {
  readonly smoke: ValueSignal<TempDockSmokeModel>;
}

/** Statuses whose banner is a failure of ours or of the hub (a red dot); the rest are states (a ring). */
const FAILURES: readonly DockStatus[] = ['hub-down', 'reload-needed'];

export function TempDockStatus({ smoke }: TempDockStatusProps): JSX.Element {
  const i18n = useI18n();
  const dock = useView({ of: 'dock' }).value;
  const model = useValueSignal(smoke).value;
  const contractText =
    model.contract.state === 'ok'
      ? i18n.t('popup.pill.chatspace.connected')
      : model.contract.state === 'degraded'
        ? i18n.t('popup.pill.chatspace.copyOnly')
        : model.contract.state === 'broken'
          ? i18n.t('popup.pill.chatspace.partial')
          : i18n.t('common.loading');
  const account = model.login ?? (model.sessionKnown ? i18n.t('dock.persona.notSignedIn') : i18n.t('common.loading'));
  const binding = model.page !== null ? (model.page.title === null ? model.page.label : `${model.page.label} · ${model.page.title}`) : (model.bindingCode ?? i18n.t('common.unknown'));
  return (
    <div class="cg-tempdock" data-cg-temp="dock-status" data-cg-status={dock.status} data-cg-mode={dock.mode}>
      <div class="cg-tempdock__strip" role="toolbar" aria-label={i18n.t('dock.label')}>
        <GooseMark class={dock.mark === 'faint' ? 'cg-tempdock__mark cg-tempdock__mark--faint' : 'cg-tempdock__mark'} />
        <span class="cg-tempdock__item" data-cg-temp-login={model.login ?? ''}>
          <span class="cg-tempdock__label">{i18n.t('popup.account')}</span>
          {account}
        </span>
        <span class="cg-tempdock__item" data-cg-temp-page={model.page?.label ?? ''} data-cg-temp-binding-code={model.bindingCode ?? ''}>
          <span class="cg-tempdock__label">{i18n.t('settings.status.row.binding')}</span>
          {binding}
        </span>
        <span class="cg-tempdock__item" data-cg-temp-contract={model.contract.state} data-cg-temp-build={model.contract.build ?? ''}>
          <span class="cg-tempdock__label">{i18n.t('settings.status.row.contract')}</span>
          {contractText}
        </span>
      </div>
      {dock.statusError === null ? null : (
        <StatusBanner error={dock.statusError} dot={FAILURES.includes(dock.status) ? 'danger' : 'ring'} />
      )}
    </div>
  );
}

export const TEMP_DOCK_STYLES: StyleSource = {
  id: 'cg-temp-dock',
  css: `
.cg-tempdock { border: 1px solid var(--cg-rule); border-bottom: 0; border-radius: var(--cg-r-md) var(--cg-r-md) 0 0; background: var(--cg-surface); }
.cg-tempdock__strip { display: flex; align-items: center; gap: 12px; min-height: 34px; padding: 0 10px; font-size: var(--cg-text-sm2); color: var(--cg-ink-2); overflow: hidden; white-space: nowrap; }
.cg-tempdock__mark { flex: none; color: var(--cg-ink); }
.cg-tempdock__mark--faint { color: var(--cg-ink-faint); }
.cg-tempdock__item { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cg-tempdock__label { color: var(--cg-ink-muted); margin-right: 6px; }
.cg-tempdock .cg-banner { border-top: 1px solid var(--cg-divider); }
`,
};
