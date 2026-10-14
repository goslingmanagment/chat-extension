// Small helpers of the neighbour: reading a method off an object without
// binding it (what a prototype hook keeps as «the original»), a digest of a
// text, and the field write every FBuddy composer action uses (S5 §2.6: the
// native `value` setter, then untrusted `input` and `change`).

/** `object[name]` as a plain function: what a hook keeps to call later with `.apply(this, args)`. */
export function original<F>(object: object, name: string): F {
  return Reflect.get(object, name) as F;
}

/** FNV-1a, 32 bits, hex: a cheap synchronous digest of a response text (equal texts — equal digests). */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The window a node lives in (the page's; tests mount into happy-dom's). */
const viewOf = (node: Node): Window & typeof globalThis => node.ownerDocument?.defaultView ?? window;

/**
 * FBuddy's field write (`vf()` + `pv()`, S5 §2.6): the native `value` setter of `HTMLTextAreaElement.prototype` — past
 * any setter a page or a framework put on the element — then an untrusted bubbling `input` and `change`.
 */
export function writeField(field: HTMLTextAreaElement, value: string): void {
  const view = viewOf(field);
  const descriptor = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value');
  const setter = descriptor === undefined ? undefined : (Reflect.get(descriptor, 'set') as ((this: HTMLTextAreaElement, text: string) => void) | undefined);
  if (setter === undefined) field.value = value;
  else setter.call(field, value);
  field.dispatchEvent(new view.Event('input', { bubbles: true }));
  field.dispatchEvent(new view.Event('change', { bubbles: true }));
}

/** The groupId of the address (`/messages/<id>`), or null. */
export function routeGroup(location: Location): string | null {
  return /^\/messages\/(\d+)/.exec(location.pathname)?.[1] ?? null;
}

let ids = 0;
/** A fresh script id, as FBuddy's `NU()` makes one per start (S5 §2.2). */
export function freshId(prefix: string): string {
  ids += 1;
  return `${prefix}-${Date.now().toString(36)}-${ids.toString(36)}`;
}
