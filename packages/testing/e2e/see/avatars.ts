// The showcase world's fans' pictures on Fansly (`pnpm see --showcase`, src/showcase.ts). The fake Fansly gives every
// fan an avatar on Fansly's CDN (src/fake-fansly/data.ts `wireAvatar`), which the stand never reaches; in a showcase
// run the browser's own requests for it are answered here over BiDi with a drawn picture — a small scene by the
// account's id, the same for the same fan. Nothing of a real person; a run without the showcase loads none.

import { browser } from '@wdio/globals';

import { FAKE_FANSLY_MEDIA_HOST } from '../../src/fake-fansly/data';

type Scene = (a: string, b: string, c: string) => string;

/** A picture's scene over its gradient (a → b, top to bottom), `c` its third colour. */
const SCENES: readonly Scene[] = [
  // sunset over hills
  (_, __, c) => `<circle cx="62" cy="50" r="15" fill="#ffe08a"/><path d="M0 80 L24 58 L40 71 L60 50 L82 69 L100 60 V100 H0 Z" fill="${c}" opacity=".85"/>`,
  // the sea
  (_, __, c) => `<circle cx="28" cy="30" r="10" fill="#fff6c9"/><path d="M0 66 Q12 58 25 66 T50 66 T75 66 T100 66 V100 H0 Z" fill="${c}" opacity=".7"/><path d="M0 78 Q12 70 25 78 T50 78 T75 78 T100 78 V100 H0 Z" fill="#fff" opacity=".35"/>`,
  // night sky
  () => `<circle cx="64" cy="36" r="14" fill="#f6f1c7"/><circle cx="70" cy="31" r="12" fill="#22304a"/><circle cx="22" cy="24" r="1.6" fill="#fff"/><circle cx="36" cy="52" r="1.2" fill="#fff"/><circle cx="80" cy="70" r="1.4" fill="#fff"/><path d="M0 86 L30 72 L55 82 L100 68 V100 H0 Z" fill="#0d1524"/>`,
  // pines
  (_, __, c) => `<path d="M22 84 L34 46 L46 84 Z M44 88 L60 36 L76 88 Z M68 84 L80 52 L92 84 Z" fill="${c}"/><rect y="84" width="100" height="16" fill="${c}" opacity=".9"/>`,
  // city lights
  (_, __, c) => `<rect x="10" y="46" width="18" height="54" fill="${c}"/><rect x="32" y="30" width="20" height="70" fill="${c}" opacity=".9"/><rect x="56" y="54" width="14" height="46" fill="${c}"/><rect x="74" y="38" width="18" height="62" fill="${c}" opacity=".85"/><g fill="#ffd97a"><rect x="14" y="52" width="3" height="3"/><rect x="21" y="60" width="3" height="3"/><rect x="37" y="36" width="3" height="3"/><rect x="44" y="48" width="3" height="3"/><rect x="60" y="60" width="3" height="3"/><rect x="79" y="46" width="3" height="3"/><rect x="85" y="58" width="3" height="3"/></g>`,
  // dunes
  (_, __, c) => `<circle cx="70" cy="34" r="12" fill="#fff3b0"/><path d="M0 74 Q30 58 56 72 T100 66 V100 H0 Z" fill="${c}" opacity=".75"/><path d="M0 86 Q40 72 70 84 T100 82 V100 H0 Z" fill="${c}"/>`,
  // a shape of their own
  (_, __, c) => `<circle cx="38" cy="40" r="22" fill="#fff" opacity=".35"/><circle cx="62" cy="62" r="26" fill="${c}" opacity=".55"/>`,
];

const PALETTES: readonly (readonly [string, string, string])[] = [
  ['#ff9a76', '#fd6585', '#5b2c6f'],
  ['#4facfe', '#a1e3ff', '#1f5f99'],
  ['#141e30', '#2f4366', '#0d1524'],
  ['#c6ea8d', '#5fa83b', '#2f5d22'],
  ['#2c3e50', '#4ca1af', '#1b2733'],
  ['#f6d365', '#fda085', '#c26a3b'],
  ['#a18cd1', '#fbc2eb', '#6b4fa0'],
];

/** The picture of a fan's account: one of the scenes, its palette by the id. */
export function showcaseAvatar(accountId: string): string {
  const seed = Number(BigInt(/^\d+$/.test(accountId) ? accountId : '0') % 1009n);
  const scene = SCENES[seed % SCENES.length] ?? SCENES[0];
  const [a, b, c] = PALETTES[(seed + Math.floor(seed / SCENES.length)) % PALETTES.length] ?? PALETTES[0] ?? ['#888', '#aaa', '#555'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>${scene?.(a, b, c) ?? ''}</svg>`;
}

/** From now on the browser's requests for Fansly's CDN get a fan's drawn picture (by the account id in the path). */
export async function serveShowcaseAvatars(): Promise<void> {
  await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] });
  await browser.networkAddIntercept({ phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: FAKE_FANSLY_MEDIA_HOST }] });
  browser.on('network.beforeRequestSent', (event) => {
    if (!event.isBlocked) return;
    let account = '';
    try {
      account = new URL(event.request.url).pathname.split('/')[1] ?? '';
    } catch {
      // not an address: the plain scene
    }
    void browser
      .networkProvideResponse({
        request: event.request.request,
        statusCode: 200,
        reasonPhrase: 'OK',
        headers: [
          { name: 'Content-Type', value: { type: 'string', value: 'image/svg+xml' } },
          { name: 'Cache-Control', value: { type: 'string', value: 'max-age=3600' } },
        ],
        body: { type: 'string', value: showcaseAvatar(account) },
      })
      .catch(() => undefined);
  });
}
