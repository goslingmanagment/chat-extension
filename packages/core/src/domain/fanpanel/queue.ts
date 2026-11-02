// «Очередь» of the fan panel (Chat Memory week 3): who a row names. Pure: the
// controller reads the hub.

export interface QueueFanNames {
  readonly fanRef: string;
  readonly alias?: string | null | undefined;
  readonly displayName?: string | null | undefined;
  readonly username: string | null;
}

/**
 * The name of a row: the team's alias as it is (it carries the 💵 / ❌ marks), else the fan's name, else «@username»,
 * else the id. `username` — «@username» to show beside a name that is not it.
 */
export function queueName(fan: QueueFanNames): { readonly name: string; readonly username: string | null } {
  const alias = fan.alias?.trim() ?? '';
  const display = fan.displayName?.trim() ?? '';
  const handle = fan.username === null || fan.username === '' ? null : `@${fan.username}`;
  const name = alias !== '' ? alias : display !== '' ? display : null;
  if (name !== null) return { name, username: handle };
  return { name: handle ?? fan.fanRef, username: null };
}
