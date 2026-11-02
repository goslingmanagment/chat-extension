// «Пропустить ▾» of a fan of «Очереди», on the window's card and on the strip over the dock: «Не подходит», «Позже», «Уже
// общаемся», «Не предлагать», each with what it does. One report to the hub (`SkipQueue`); a fan who answered has none
// (he is no longer in the portion). The file stays light: the dock's bundle reads it.

import { type JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { type QueueSkipReason, type TargetHandle } from '@cg/contracts/vm';

import { Button, Icon, Menu, MenuAnchor, menuTriggerKeys, useDispatch, useI18n } from '../kit';

export function QueueSkip({ handle, skips, busy = null }: { readonly handle: TargetHandle; readonly skips: readonly QueueSkipReason[]; readonly busy?: string | null }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  if (skips.length === 0) return null;
  return (
    <MenuAnchor>
      <Button
        label={i18n.t('queues.skip')}
        variant="quiet"
        size="sm"
        haspopup="menu"
        expanded={open}
        buttonRef={button}
        trailing={<Icon name="chevronDown" size={12} />}
        reason={busy}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open) menuTriggerKeys(event, () => setOpen(true));
        }}
      />
      <Menu
        open={open}
        kind="action"
        label={i18n.t('queues.skip')}
        items={skips.map((reason) => ({ id: reason, label: i18n.t(`queues.skip.${reason}`), note: i18n.t(`queues.skip.hint.${reason}`) }))}
        align="end"
        placement="top"
        onSelect={(id) => {
          setOpen(false);
          void dispatch({ type: 'SkipQueue', targetHandle: handle, reason: id as QueueSkipReason });
        }}
        onClose={() => setOpen(false)}
        returnFocusTo={() => button.current}
      />
    </MenuAnchor>
  );
}
