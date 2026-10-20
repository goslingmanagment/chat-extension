// TEST builds, loopback only. The panel is P12b3: this probe exercises its
// application/RPC port now, without adding any production surface or action.
import { stableDigest } from '@cg/core/domain/ops';
import { freshTextAdmitted } from '@cg/core/domain/features';
import { createPageContext } from '@cg/core/application/boards';
import { withFanslyOpText } from '@cg/core/application/hosts/fansly/ai';
import { createVoiceScript } from '@cg/core/application/hosts/fansly/voice';
import type { SiteStartOp } from '@cg/contracts/ops';
import { FanslyStartOpSchema } from '@cg/contracts/ops-fansly';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import type { SiteAppEnv } from '../../adapter';
import { fanslyRequest } from './requests';

export function startFanslyOpsProbe(env: SiteAppEnv<FanslyPort>): () => void {
  if (env.probe === null) return () => undefined;
  const context = createPageContext({ rpc: env.rpc, host: env.host });
  const start = async (input: SiteStartOp) => {
    const ctx = context.current();
    const prepared = await withFanslyOpText(env.host, input, ctx.bootstrap, freshTextAdmitted(env.features, ctx.bootstrap, input.target.binding.pageId));
    if (prepared === null) throw new Error('chat changed');
    return fanslyRequest(env.rpc, 'fansly.ops.start', FanslyStartOpSchema.parse(prepared));
  };
  const html = env.win.document.documentElement;
  const key = 'data-cg-ops-command';
  let last = '';
  const execute = async (): Promise<void> => {
    const raw = html.getAttribute(key);
    if (raw === null || raw === last) return;
    last = raw;
    const command = JSON.parse(raw) as { id: string; op: 'start' | 'read' | 'cancel' | 'list'; feature?: 'reply' | 'voice-script' | 'notes-fill'; opId?: string; draft?: string };
    let answer: unknown;
    if (command.op === 'start') {
      const now = env.host.current();
      const account = now.accounts.find((account) => account.hostAccountId === now.identity?.hostAccountId);
      if (account === undefined || now.route.chat === null || now.route.conversationRef === undefined) throw new Error('no target');
      const binding = await env.rpc.request('binding.resolve', { account });
      const token = await env.rpc.request('token.issue', { kind: 'generate', surface: 'dock' });
      if (!binding.ok || !token.ok) throw new Error('no binding or token');
      const base = { target: { binding: binding.payload.binding, chat: now.route.chat, fanRef: now.route.chat.platformFanId, conversationRef: now.route.conversationRef }, cause: { kind: 'click' as const, actionToken: token.payload.actionToken }, window: 100, force: true };
      if (command.feature === 'reply') answer = await env.rpc.request('op.start', { ...base, feature: 'reply', surface: 'dock', tone: null, split: false });
      else if (command.feature === 'notes-fill') answer = await start({ ...base, feature: 'notes-fill', fields: ['Name', 'City'], window: 3000 });
      else {
        const text = command.draft ?? 'A synthetic draft.';
        const port = createVoiceScript({
          async start(input) { const result = await start(input); if (!result.ok) throw new Error(result.error.code); return result.payload; },
          async read(opId) { const result = await fanslyRequest(env.rpc, 'fansly.ops.read', { opId }); return result.ok ? result.payload.view : null; },
          async cancel(opId) { const result = await fanslyRequest(env.rpc, 'fansly.ops.cancel', { opId }); return result.ok ? result.payload.state : null; },
        });
        answer = { ok: true, payload: await port.start({ ...base, feature: 'voice-script', tone: null, draft: { text, revision: 1, digest: stableDigest(text) } }) };
      }
    } else if (command.op === 'list') answer = await fanslyRequest(env.rpc, 'fansly.ops.list', {});
    else if (command.op === 'read') answer = await fanslyRequest(env.rpc, 'fansly.ops.read', { opId: command.opId ?? '' });
    else answer = command.feature === 'reply' ? await env.rpc.request('op.cancel', { opId: command.opId ?? '' }) : await fanslyRequest(env.rpc, 'fansly.ops.cancel', { opId: command.opId ?? '' });
    env.probe?.set('siteOps', { id: command.id, answer });
  };
  const run = (): void => { void execute().catch((error: unknown) => env.probe?.set('siteOps', { error: error instanceof Error ? error.message : 'probe failed' })); };
  const observer = new MutationObserver(run);
  observer.observe(html, { attributes: true, attributeFilter: [key] });
  run();
  return () => { observer.disconnect(); context.dispose(); };
}
