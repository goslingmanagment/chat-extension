// The live port (live.ts): what the tap script answers for the bridge — the
// freshness checkpoint, the X8 send port and the flags (architecture.md
// §5.3, §6.7.5, §6.7.11) — and how the tap, the send port and the receipt
// observer are wired together. The runtime has checked each payload by hand
// against the contracts' shapes before it gets here (requests.ts).
//
// The send latch starts closed: nothing is sent until the isolated side says
// the `previewSend` flag is on, and it closes at once when the flag goes off
// (§6.7.11). `wsTap: false` is the «выключись» command of §6.8 п. 10.
// `attribution` (decision X48) starts off too: while it is on, every human send
// of the composer is followed to its receipt, not only a draft of ours.

import { type LiveHost, type LivePort, type Tap } from './live';
import { ERR_DISABLED } from '@cg/host-kit/main/protocol';
import { EVT_FAN_NOTES } from './protocol';
import { createReceipts } from './receipt';
import { type SendRequest } from './requests';
import { createSendPort } from './send-port';

export function createLivePort(win: Window & typeof globalThis, tap: Tap, host: LiveHost, switchOff: () => void): LivePort {
  /** The local latch of the `previewSend` flag (§6.7.11). */
  let sendOn = false;
  /** The local latch of the hub's `send-attribution-v1` (decision X48): who sent each message is recorded. */
  let attributeOn = false;
  const receipts = createReceipts(win, host, tap, () => attributeOn && tap.on());
  const port = createSendPort(host, tap, receipts, () => sendOn && tap.on());
  tap.connect({
    fact(fact, content) {
      // Metadata only: the text of a message goes nowhere but to the receipt observer's comparison (the X8 fuse).
      host.post('incoming', { ...fact });
      receipts.echo(fact, content);
    },
    coverage: (acc, state, reason) => host.post('coverage', { acc, state, reason }),
    changed: host.changed,
    members: host.members,
    fault: host.fault,
    // A fan's OnlyMonster notes changed: never coalesced, so another fan's word cannot hide the open fan's.
    notes: (acc, fan) => host.post(EVT_FAN_NOTES, { acc, fan }),
  });

  return {
    handle(t, payload) {
      if (t === 'flags') {
        sendOn = payload['previewSend'] === true;
        attributeOn = payload['attribution'] === true;
        if (!payload['wsTap']) switchOff();
        return { wsTap: tap.on(), previewSend: sendOn && tap.on(), attribution: attributeOn && tap.on() };
      }
      if (t === 'checkpoint') return tap.on() ? { ...tap.checkpoint(payload['acc'] as string, payload['fan'] as string), documentEpoch: host.epoch() } : ERR_DISABLED;
      const req = payload['req'] as SendRequest;
      return t === 'previewSendCommit' ? port.commit(req) : port.preflight(req);
    },
    sent: receipts.send,
    sync: tap.sync,
    anchor: tap.anchor,
  };
}
