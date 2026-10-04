// The dock above ChatSpace's composer (architecture.md §6.3, §10.1; ui-design
// §3.1–§3.3): the result sheet over one 34 px strip, both rendered from the
// `dock` view model and nothing else. Outside an open chat there is no dock
// (UI-012). The sheet's height limit is `--cg-cap` from MountPort's geometry
// (ui-design §3.2); «Вид ответа» switches the sheet between printed on the
// feed (`bare`) and a sheet with a frame (§7). In the document the strip
// precedes the sheet, which is the order of Tab and of reading (§6.3); on
// screen the sheet stands above it.

import { type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { type DockVM } from '@cg/contracts/vm';

import { Hints, useKit, useResultCap, useView, windowOf } from '../kit';
import { DEFAULT_PARTS } from './lazy';
import { type DockParts } from './lazy-part';
import { Sheet } from './Sheet';
import { useSteadyView } from './Stream';
import { Strip } from './Strip';

export interface DockViewProps {
  /** Loaders of the lazy parts; the defaults are dynamic imports (lazy.tsx). */
  readonly parts?: Partial<DockParts>;
}

/**
 * What identifies a refusal for «Скрыть»: no operation exists, so it is
 * hidden here until another one comes. Another one is another chat, function
 * or code — or another moment (`RefusalVM.at`): a start refused again by a
 * hotkey never passes through the strip, and without its time the new refusal
 * could not be told from the hidden one.
 */
const refusalKey = (vm: DockVM): string | null =>
  vm.refusal === null ? null : `${vm.targetHandle ?? ''}|${vm.refusal.feature}|${vm.refusal.error.code}|${vm.refusal.at ?? ''}`;

export function DockView({ parts }: DockViewProps): JSX.Element | null {
  const { deps, root } = useKit();
  const view = useView({ of: 'dock' });
  const vm = useSteadyView(view).value;
  const cap = useResultCap(vm.resultStyle);
  const [hidden, setHidden] = useState<string | null>(null);
  const refusal = refusalKey(vm);
  // A refusal that went away or changed is a new one the next time.
  useEffect(() => {
    if (hidden !== null && hidden !== refusal) setHidden(null);
  }, [refusal, hidden]);

  // The dock follows the route (routeToDockMs: the controller holds the start mark).
  const target = vm.visible ? vm.targetHandle : null;
  useEffect(() => {
    if (target === null) return undefined;
    const page = windowOf(root);
    const frame = page?.requestAnimationFrame(() => deps.marks.painted('routeToDockMs', target));
    return () => {
      if (frame !== undefined) page?.cancelAnimationFrame(frame);
    };
  }, [target, deps, root]);

  if (!vm.visible) return null;
  const all: DockParts = { ...DEFAULT_PARTS, ...parts };
  return (
    <Hints value={vm.hints}>
      <div class={`cg-dock cg-dock--${vm.resultStyle}${vm.resultStyle === 'bare' ? ' cg-bare' : ''}`} style={cap.style} data-cg-dock={vm.status} data-cg-mode={vm.mode}>
        {/* The strip comes first in the document and stands under the sheet on screen (column-reverse):
            Tab goes strip → head buttons → parts → footer buttons (ui-design §6.3). */}
        <Strip vm={vm} onRefused={() => setHidden(null)} />
        <Sheet vm={vm} view={view} parts={all} refusalHidden={hidden !== null && hidden === refusal} onHideRefusal={() => setHidden(refusal)} />
      </div>
    </Hints>
  );
}
