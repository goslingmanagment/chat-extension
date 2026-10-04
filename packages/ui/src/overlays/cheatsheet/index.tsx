// @cg/ui/overlays/cheatsheet — «Клавиши ChatGoose» (ui-design §3.8, §4.21;
// HK-034, CS-014, ST-120): a centred dialog of the key scheme by groups, with
// labels for this OS, from `CheatsheetVM` (the vendored scheme through the
// dispatcher). A key the browser keeps is never printed as working: its
// fallback or its note is. Esc, «Закрыть» and a press on the scrim close it;
// focus stays inside and returns to where it was. A lazy overlay.

import { type JSX } from 'preact';

import { type CheatsheetVM, type MountDeps } from '@cg/contracts/vm';

import {
  Button,
  Dialog,
  OverlayLayer,
  ViewState,
  hotkeyText,
  mountKitSurface,
  useDispatch,
  useI18n,
  useKit,
  useView,
  type KitMount,
  type KitMountOptions,
  type StyleSource,
  type SurfaceDefinition,
} from '../../kit';
import { overlayRootCss } from '../layer';

type Group = CheatsheetVM['groups'][number];

function GroupBlock({ group }: { readonly group: Group }): JSX.Element {
  const i18n = useI18n();
  return (
    <section class="cg-cs__grp" data-cg-group={group.id}>
      <h3>{i18n.text(group.title)}</h3>
      {group.rows.map((row, index) => {
        const keys = hotkeyText(row.hotkey);
        return (
          <div key={index} class="cg-cs__row">
            <span>{i18n.text(row.label)}</span>
            <span class="cg-cs__key">
              {row.note === null ? null : <span class="cg-cs__note-of">{i18n.text(row.note)}</span>}
              {keys === null ? null : <kbd>{keys.display}</kbd>}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** Two columns of about the same height (the mockup's left and right), one at 640 px and narrower. */
function columns(groups: readonly Group[]): readonly (readonly Group[])[] {
  const weight = (group: Group): number => group.rows.length + 2;
  const total = groups.reduce((sum, group) => sum + weight(group), 0);
  const left: Group[] = [];
  let taken = 0;
  for (const group of groups) {
    if (left.length > 0 && taken + weight(group) / 2 > total / 2) break;
    left.push(group);
    taken += weight(group);
  }
  return [left, groups.slice(left.length)];
}

export function CheatsheetView(): JSX.Element {
  const i18n = useI18n();
  const { deps } = useKit();
  const dispatch = useDispatch();
  const vm = useView({ of: 'cheatsheet' }).value;
  const close = (): void => void dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: false } });
  const title = i18n.t('cheatsheet.title');
  const failed = vm.view.s === 'loading' || vm.view.s === 'error';
  return (
    <OverlayLayer>
      <Dialog open label={title} size="wide" class="cg-cs" onClose={close}>
        <div class="cg-cs__head">
          <h2>{title}</h2>
          <Button label={i18n.t('common.close')} variant="quiet" hotkey={deps.catalog.entry('close').hotkey ?? i18n.t('common.key.esc')} onClick={close} />
        </div>
        {failed ? (
          <ViewState view={vm.view} />
        ) : (
          <div class="cg-cs__body">
            {columns(vm.groups).map((column, index) => (
              <div key={index}>
                {column.map((group) => (
                  <GroupBlock key={group.id} group={group} />
                ))}
              </div>
            ))}
          </div>
        )}
        <div class="cg-cs__note">{i18n.text(vm.note)}</div>
      </Dialog>
    </OverlayLayer>
  );
}

export const CHEATSHEET_CSS = `
${overlayRootCss('cheatsheet', 'window')}
.cg-cs__head { flex: none; display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 8px 0 18px; border-bottom: 1px solid var(--cg-rule); }
.cg-cs__head h2 { font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-cs__head .cg-btn { margin-left: auto; }
.cg-cs__body { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; padding: 6px 18px 12px; overflow: hidden auto; min-height: 0; scrollbar-width: thin; }
.cg-cs__grp { padding-top: 10px; }
.cg-cs__grp h3 { margin: 0 0 4px; font-size: var(--cg-text-sm); line-height: 18px; font-weight: 500; color: var(--cg-ink-muted); }
.cg-cs__row { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 28px; padding: 4px 0; border-bottom: 1px solid var(--cg-rule); color: var(--cg-ink); }
.cg-cs__row > span:first-child { flex: none; }
.cg-cs__key { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
.cg-root .cg-cs__row kbd { color: var(--cg-ink-strong); font-size: var(--cg-text-sm); letter-spacing: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cg-cs__note-of { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); text-align: right; }
.cg-cs__note { flex: none; padding: 10px 18px 14px; border-top: 1px solid var(--cg-rule); font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
@media (max-width: 640px) { .cg-cs__body { grid-template-columns: minmax(0, 1fr); } }
`;
export const CHEATSHEET_STYLE: StyleSource = { id: 'cg-cheatsheet', css: CHEATSHEET_CSS };

export const cheatsheetSurface: SurfaceDefinition = { view: CheatsheetView, styles: [CHEATSHEET_STYLE] };

export function mountCheatsheet(root: ShadowRoot, deps: MountDeps, options: KitMountOptions = {}): KitMount {
  return mountKitSurface('cheatsheet', root, deps, cheatsheetSurface, options);
}
