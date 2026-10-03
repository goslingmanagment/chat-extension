// «Хоткеи» (architecture.md §9.1, §9.9; ST-120, ST-121): a read-only
// reference. The first table is the vendored scheme shared with the other
// clients, the second the keys outside it. A combination the browser keeps
// is never printed as working: its row says so and names the fallback.

import { type JSX } from 'preact';

import { type HotkeyLabel, type HotkeysBodyVM } from '@cg/contracts/vm';

import { Kbd, useI18n } from '../../kit';

type Row = HotkeysBodyVM['rows'][number];

function Keys({ hotkey }: { readonly hotkey: HotkeyLabel | null }): JSX.Element {
  const i18n = useI18n();
  if (hotkey === null) return <span class="pg-muted">{i18n.t('settings.hotkeys.buttonOnly')}</span>;
  // A reserved combination is shown only as its fallback, never as a working one (§9.1).
  if (hotkey.delivery === 'reserved') return hotkey.fallback === null ? <span class="pg-muted">{i18n.t('settings.hotkeys.buttonOnly')}</span> : <Kbd>{hotkey.fallback.display}</Kbd>;
  return (
    <>
      <Kbd>{hotkey.display}</Kbd>
      {hotkey.fallback === null ? null : <span class="pg-muted"> · {i18n.t('settings.hotkeys.fallback', { combo: hotkey.fallback.display })}</span>}
    </>
  );
}

function Delivery({ row }: { readonly row: Row }): JSX.Element | null {
  const i18n = useI18n();
  if (row.id === 'help') return <span class="pg-muted">{i18n.t('settings.hotkeys.removed')}</span>;
  if (row.hotkey === null) return null;
  const key = {
    delivered: 'settings.hotkeys.delivery.delivered',
    cancelable: 'settings.hotkeys.delivery.cancelable',
    reserved: 'settings.hotkeys.delivery.reserved',
    unverified: 'settings.hotkeys.delivery.unverified',
  } as const;
  return <span class={row.hotkey.delivery === 'delivered' || row.hotkey.delivery === 'cancelable' ? 'pg-muted' : ''}>{i18n.t(key[row.hotkey.delivery])}</span>;
}

function Table({ rows, caption }: { readonly rows: readonly Row[]; readonly caption: string }): JSX.Element {
  const i18n = useI18n();
  return (
    <table class="pg-table" aria-label={caption}>
      <thead>
        <tr>
          <th scope="col">{i18n.t('settings.hotkeys.col.action')}</th>
          <th scope="col">{i18n.t('settings.hotkeys.col.keys')}</th>
          <th scope="col">{i18n.t('settings.hotkeys.col.delivery')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} data-pg-hotkey={row.id}>
            <td class="pg-strong">{i18n.text(row.label)}</td>
            <td>
              <Keys hotkey={row.hotkey} />
            </td>
            <td>
              <Delivery row={row} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HotkeysSection({ body }: { readonly body: HotkeysBodyVM }): JSX.Element {
  const i18n = useI18n();
  const platform = i18n.t(body.platform === 'mac' ? 'settings.hotkeys.platform.mac' : 'settings.hotkeys.platform.win');
  const scheme = body.rows.filter((row) => !row.outsideScheme);
  // Rows without a combination and outside the scheme (send, «Новые») are buttons only: the note under the tables says so.
  const outside = body.rows.filter((row) => row.outsideScheme && row.hotkey !== null);
  return (
    <>
      <p class="pg-note" style={{ margin: '0 0 4px' }}>
        {i18n.t('settings.hotkeys.platform', { platform })}
      </p>
      <h2 class="pg-h2">{i18n.t('settings.hotkeys.reference')}</h2>
      <Table rows={scheme} caption={i18n.t('settings.hotkeys.reference')} />
      <h2 class="pg-h2">{i18n.t('settings.hotkeys.outsideScheme')}</h2>
      <Table rows={outside} caption={i18n.t('settings.hotkeys.outsideScheme')} />
      <h2 class="pg-h2">{i18n.t('settings.hotkeys.delivery')}</h2>
      <p class="pg-note" style={{ margin: 0 }}>
        {i18n.t('settings.hotkeys.deliveryNote')}
      </p>
    </>
  );
}
