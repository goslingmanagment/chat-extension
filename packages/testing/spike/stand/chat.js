// An Angular-like imitation of the Fansly mechanics the spike needs (S2 §Q2, §Q4, §Q5): HttpClient-style XHR
// (responseType 'text', withCredentials, `ngsw-bypass=true`, `load` listener added after open), the socket created
// after GET /account/me with `on*` handlers, a router that re-creates the container in the same task as
// pushState (through a SAVED pushState reference), and the composer's send path: Enter (own shiftDown flag) or a
// click on .send-button → sendMessage() → POST /message synchronously in the same dispatch. `?s=` picks a variant
// of the send path for the gesture experiment; `?nb=1` loads the FBuddy-like hook script asynchronously.

const q = new URLSearchParams(location.search);
const scenario = q.get('s') ?? 'sync';
const API = `${location.protocol}//apiv3.${location.host}/api/v1/`;
const WS = `ws://wsv3.${location.host}?v=3`;
const savedPush = history.pushState.bind(history);
const savedReplace = history.replaceState.bind(history);
const state = { sockets: 0, frames: 0, sent: [], errors: [], gid: null, model: '' };
window.__app = state;

if (q.get('nb') === '1') {
  const s = document.createElement('script');
  s.src = '/nb-hook.js';
  s.async = true;
  document.documentElement.appendChild(s);
}

function api(method, path, body, cb = () => undefined) {
  const xhr = new XMLHttpRequest();
  const url = API + path + (path.includes('?') ? '&' : '?') + 'ngsw-bypass=true';
  xhr.open(method, url);
  xhr.withCredentials = true;
  xhr.responseType = 'text';
  xhr.setRequestHeader('authorization', 'page-token');
  xhr.setRequestHeader('fansly-client-id', 'page-client');
  if (body !== null) xhr.setRequestHeader('content-type', 'application/json');
  xhr.addEventListener('load', () => {
    try {
      const b = JSON.parse(xhr.response);
      cb(b.success ? null : b.error, b.response, xhr);
    } catch (e) {
      cb(e, null, xhr);
    }
  });
  xhr.addEventListener('error', () => cb('error', null, xhr));
  window.__spikeInSend = true;
  xhr.send(body === null ? null : JSON.stringify(body));
  window.__spikeInSend = false;
  return xhr;
}
state.api = api;

function connect() {
  const ws = new WebSocket(WS);
  state.sockets += 1;
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => ws.send(JSON.stringify({ t: 1, d: JSON.stringify({ token: 'page-token', v: 3 }) }));
  ws.onmessage = (e) => {
    state.frames += 1;
    try {
      const f = JSON.parse(e.data);
      if (f.t === 10000) JSON.parse(JSON.parse(f.d).event);
    } catch {
      // the page drops what it cannot read
    }
  };
  ws.onclose = () => undefined;
  state.ws = ws;
}

// ── router: the container (with composer and header contact block) is re-created on every chat change ──
const content = document.querySelector('.messages-content-wrapper');
function render(path) {
  const gid = /^\/messages\/(\d+)$/.exec(path)?.[1] ?? null;
  state.gid = gid;
  content.textContent = '';
  if (!gid) return;
  const route = document.createElement('app-messages-conversation-route');
  route.innerHTML = `<app-group-message-container>
      <div class="message-content-header"><div class="flex-col"><div class="flex-row"><span class="back-button"></span>
        <div class="message-content-header-contact"><div class="content-header-sub-row"><span class="gallery-hot-icon"></span></div></div></div></div></div>
      <div class="messages-wrapper"></div>
      <app-group-message-input>
        <div class="message-attachments"></div>
        <div class="message-composer flex-row">
          <div class="collapsable-actions"><input type="file" style="display:none" /></div>
          <div class="message-entry"><div class="message-input-container"><textarea class="message-input" rows="1"></textarea></div>
          <button class="send-button" type="button" title="Send message">Send</button></div>
        </div>
      </app-group-message-input>
    </app-group-message-container>`;
  content.appendChild(route);
  wireComposer(route);
  api('GET', `group/${gid}/`, null);
  api('GET', `message?groupId=${gid}&limit=25`, null);
}
state.router = {
  go: (path) => {
    savedPush({ navigationId: 1 }, '', path);
    render(path);
  },
  replace: (path) => {
    savedReplace({ navigationId: 1 }, '', path);
    render(path);
  },
};
addEventListener('popstate', () => setTimeout(() => render(location.pathname), 0));

// ── composer: Angular's (ngModel) + the component's own shiftDown flag; no shiftKey/isComposing check ──
function wireComposer(root) {
  const ta = root.querySelector('textarea.message-input');
  const button = root.querySelector('.send-button');
  let shiftDown = false;
  ta.addEventListener('input', () => {
    state.model = ta.value;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftDown = true;
    if (e.key !== 'Enter') return;
    if (shiftDown) return;
    e.preventDefault();
    send('enter');
  });
  ta.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftDown = false;
  });
  button.addEventListener('mousedown', (e) => e.preventDefault());
  if (scenario === 'micro-last') addEventListener('click', (e) => e.target.closest?.('.send-button') && send('click'));
  else button.addEventListener('click', () => send('click'));
}

function post(content, gid = state.gid) {
  api('POST', 'message', { type: 1, attachments: [], likes: [], content, groupId: gid, scheduledFor: 0, inReplyTo: null, createdAt: Date.now() / 1000 }, (err, res) => {
    state.sent.push({ err, id: res?.id ?? null, content });
  });
}

function send(via) {
  const content = state.model;
  if (!content) return;
  const clear = () => {
    if (scenario === 'keep') return;
    state.model = '';
    Promise.resolve().then(() => {
      const ta = document.querySelector('app-messages-conversation-route textarea.message-input');
      if (ta) ta.value = '';
    });
  };
  state.lastVia = via;
  switch (scenario) {
    case 'micro':
    case 'micro-last':
      Promise.resolve().then(() => post(content));
      break;
    case 'micro3':
      (async () => {
        await 0;
        await 0;
        await 0;
        post(content);
      })();
      break;
    case 'timer':
      setTimeout(() => post(content), 0);
      break;
    case 'channel': {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => post(content);
      ch.port2.postMessage(0);
      break;
    }
    case 'media':
      api('POST', 'media/upload', { size: 1 }, () => post(content));
      break;
    case 'route-before': {
      const other = '900000000000000099';
      savedPush({}, '', `/messages/${other}`);
      post(content, other);
      break;
    }
    case 'ack':
      api('POST', 'message/ack', { messageIds: ['1'], type: 2 });
      post(content);
      break;
    case 'ack-after':
      post(content);
      api('POST', 'message/ack', { messageIds: ['1'], type: 2 });
      break;
    case 'double':
      post(content);
      post(`${content} (2)`);
      break;
    default:
      post(content);
  }
  clear();
}

// A script-made click (untrusted): never a human send.
state.fakeClick = () => document.querySelector('app-messages-conversation-route .send-button')?.click();
state.fakeEnter = () =>
  document.querySelector('app-messages-conversation-route textarea.message-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
state.setText = (text) => {
  const ta = document.querySelector('app-messages-conversation-route textarea.message-input');
  ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
};

// ── start like Fansly: /account/me, then the socket ──
api('GET', 'account/me', null, () => connect());
if (/^\/messages\/\d+$/.test(location.pathname)) render(location.pathname);
