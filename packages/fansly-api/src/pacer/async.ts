import type { FanslyApiSignal } from '@cg/contracts/fansly-api';

const abortError = (signal: FanslyApiSignal): Error => signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');

export function checkAbort(signal: FanslyApiSignal): void {
  if (signal.aborted) throw abortError(signal);
}
export function abortable<T>(work: Promise<T>, signal: FanslyApiSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener('abort', abort); reject(abortError(signal)); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error: unknown) => { signal.removeEventListener('abort', abort); reject(error instanceof Error ? error : new Error('Failed')); });
  });
}
export function sleep(ms: number, signal: FanslyApiSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortError(signal)); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(0, Math.min(ms, 2_147_483_647)));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
