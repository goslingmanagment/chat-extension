// `generic` (S5 §6.1; not FBuddy): some other page script replaces the
// `XMLHttpRequest` and `WebSocket` constructors themselves — a constructor
// Proxy (returning the native instance, as a well-behaved one does) or a
// subclass (whose prototype is a new object in front of the native one). It
// stands at the page's first moment: after our MAIN in the field order, before
// it when we install late. A robustness case for our tap: SPEC's «WebSocket
// wrapped» wording, which FBuddy itself never does (S5 §4 п. 1).

import type { NeighborGeneric } from './protocol';

export interface GenericCounts {
  xhr: number;
  sockets: number;
}

export function installGeneric(win: Window & typeof globalThis, kind: NeighborGeneric): GenericCounts {
  const counts: GenericCounts = { xhr: 0, sockets: 0 };
  const NativeXhr = win.XMLHttpRequest;
  const NativeSocket = win.WebSocket;
  if (kind === 'proxy') {
    win.XMLHttpRequest = new Proxy(NativeXhr, {
      construct(target, args, newTarget) {
        counts.xhr += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    win.WebSocket = new Proxy(NativeSocket, {
      construct(target, args, newTarget) {
        counts.sockets += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
  } else {
    win.XMLHttpRequest = class GenericXMLHttpRequest extends NativeXhr {
      constructor() {
        super();
        counts.xhr += 1;
      }
    };
    win.WebSocket = class GenericWebSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        counts.sockets += 1;
      }
    };
  }
  return counts;
}
