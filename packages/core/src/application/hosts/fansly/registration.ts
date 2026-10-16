import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { RegistrationClient, RegistrationTarget, RegistrationView } from '@cg/contracts/registration-fansly';
import { fanslyIdTimestampMs } from '../../../domain/hosts/fansly/snowflake';

type Answer = { readonly ok: true; readonly fanId: string } | { readonly ok: false; readonly error: CgAnyErrorWire };
const IDLE: RegistrationView = { state: 'idle', registeredAt: null, error: null };

/** One pending attempt at a time; answers last until the document or login ends. A late
 * answer may fill its own cache but never paints a different open group. */
export function createRegistration(deps: { session(): string | null; target(): RegistrationTarget | null; read(target: RegistrationTarget): Promise<Answer>; now?(): number }): RegistrationClient & { sync(): void; dispose(): void } {
  let account: string | null = null;
  let epoch = 0;
  let disposed = false;
  const answers = new Map<string, RegistrationView>();
  const listeners = new Set<(view: RegistrationView) => void>();
  const current = (): RegistrationTarget | null => {
    const target = deps.target();
    const next = deps.session();
    if (next !== account) { account = next; epoch++; answers.clear(); }
    return target;
  };
  const view = (): RegistrationView => {
    const target = current();
    return target === null ? IDLE : answers.get(target.groupId) ?? IDLE;
  };
  const sync = (): void => { if (!disposed) { const value = view(); for (const listener of [...listeners]) listener(value); } };
  return {
    view,
    sync,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async reveal() {
      const target = current();
      if (disposed || target === null) return;
      const state = answers.get(target.groupId)?.state;
      if (state === 'loading' || state === 'shown') return;
      const under = epoch;
      answers.set(target.groupId, { state: 'loading', registeredAt: null, error: null });
      sync();
      let answer: Answer;
      try { answer = target.fanId === null ? await deps.read(target) : { ok: true, fanId: target.fanId }; }
      catch { answer = { ok: false, error: { code: 'CG-FAN-REQUEST' } }; }
      current();
      if (disposed || epoch !== under) return;
      const ms = answer.ok ? fanslyIdTimestampMs(answer.fanId, deps.now?.()) : null;
      answers.set(target.groupId, ms === null
        ? { state: 'failed', registeredAt: null, error: answer.ok ? { code: 'CG-FAN-REQUEST' } : answer.error }
        : { state: 'shown', registeredAt: ms, error: null });
      sync();
    },
    dispose() { disposed = true; epoch++; answers.clear(); listeners.clear(); },
  };
}
