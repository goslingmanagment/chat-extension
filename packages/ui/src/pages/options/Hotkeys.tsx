// «Хоткеи» (architecture.md §9.1, §9.9; ST-120, ST-121): a read-only
// reference. The vendored scheme shared with the other clients stands in the
// four groups of the cheatsheet (ui-design §4.21) — «AI в открытом чате»,
// «Перед генерацией», «Результат», «Окна» — then the keys outside it. A
// combination the browser keeps is never printed as working: its row says
// so and names the fallback.

import { type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type CatalogActionId, type HotkeyLabel, type HotkeysBodyVM } from '@cg/contracts/vm';

import { Kbd, useI18n } from '../../kit';
import { Card } from '../shared';

type Row = HotkeysBodyVM['rows'][number];

/** The groups of the scheme's reference, in the cheatsheet's words and order of use. */
export const HOTKEY_GROUPS: readonly { readonly id: string; readonly title: I18nKey; readonly actions: readonly CatalogActionId[] }[] = [
  { id: 'ai', title: 'cheatsheet.group.ai', actions: ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach'] },
  { id: 'before', title: 'cheatsheet.group.before', actions: ['tone', 'split'] },
  { id: 'result', title: 'cheatsheet.group.result', actions: ['cancel'] },
  { id: 'windows', title: 'cheatsheet.group.windows', actions: ['spenders', 'help'] },
];
const GROUPED: ReadonlySet<CatalogActionId> = new Set(HOTKEY_GROUPS.flatMap((group) => group.actions));

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

interface RowGroup {
  readonly id: string;
  /** The words of the group; null — the table is one list without a heading row. */
  readonly title: string | null;
  readonly rows: readonly Row[];
}

/** One table, so the columns of every group line up; each group is a `tbody` under its own heading row. */
function Table({ groups, caption }: { readonly groups: readonly RowGroup[]; readonly caption: string }): JSX.Element {
  const i18n = useI18n();
  // Groups side by side, each row «action … keys» (X32, after the Fansly extension's reference); one group of many rows flows into columns.
  return (
    <table class={groups.length === 1 ? 'pg-table pg-keys pg-keys--flow' : 'pg-table pg-keys'} aria-label={caption}>
      <thead>
        <tr>
          <th scope="col">{i18n.t('settings.hotkeys.col.action')}</th>
          <th scope="col">{i18n.t('settings.hotkeys.col.keys')}</th>
          <th scope="col">{i18n.t('settings.hotkeys.col.delivery')}</th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.id} data-pg-hotkeys={group.id}>
          {group.title === null ? null : (
            <tr class="pg-table__group">
              <th scope="rowgroup" colSpan={3}>
                {group.title}
              </th>
            </tr>
          )}
          {group.rows.map((row) => (
            <tr key={row.id} data-pg-hotkey={row.id}>
              <td class="pg-strong">{i18n.text(row.label)}</td>
              <td>
                <Keys hotkey={row.hotkey} />
              </td>
              {/* «работает» is the norm and is not drawn (§1 п. 7): the cell speaks only when the combination does not. */}
              <td data-pg-delivery={row.id === 'help' ? 'removed' : (row.hotkey?.delivery ?? 'none')}>
                <Delivery row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

export function HotkeysSection({ body }: { readonly body: HotkeysBodyVM }): JSX.Element {
  const i18n = useI18n();
  const platform = i18n.t(body.platform === 'mac' ? 'settings.hotkeys.platform.mac' : 'settings.hotkeys.platform.win');
  const scheme = body.rows.filter((row) => !row.outsideScheme);
  // A scheme action no group names yet (a newer vendored scheme) is still shown: with the windows, never dropped.
  const groups: readonly RowGroup[] = HOTKEY_GROUPS.map((group, index) => ({
    id: group.id,
    title: i18n.t(group.title),
    rows: [...group.actions.flatMap((id) => scheme.filter((row) => row.id === id)), ...(index === HOTKEY_GROUPS.length - 1 ? scheme.filter((row) => !GROUPED.has(row.id)) : [])],
  })).filter((group) => group.rows.length > 0);
  // Rows without a combination and outside the scheme (send, «Новые») are buttons only: the note under the tables says so.
  const outside = body.rows.filter((row) => row.outsideScheme && row.hotkey !== null);
  return (
    <>
      <p class="pg-note pg-intro">
        {i18n.t('settings.hotkeys.platform', { platform })}
      </p>
      <Card title={i18n.t('settings.hotkeys.reference')}>
        <Table groups={groups} caption={i18n.t('settings.hotkeys.reference')} />
      </Card>
      <Card title={i18n.t('settings.hotkeys.outsideScheme')}>
        <Table groups={[{ id: 'outside', title: null, rows: outside }]} caption={i18n.t('settings.hotkeys.outsideScheme')} />
      </Card>
      <p class="pg-note">
        <b>{i18n.t('settings.hotkeys.delivery')}.</b> {i18n.t('settings.hotkeys.deliveryNote')}
      </p>
    </>
  );
}
