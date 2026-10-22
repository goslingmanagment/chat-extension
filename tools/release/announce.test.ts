import { describe, expect, it } from 'vitest';

import { AnnounceError, composePost, POST_CHAR_LIMIT, sendPost, type FetchLike } from './announce.ts';
import { parseChangelog } from './changelog.ts';
import { parseNote } from './changes.ts';
import { historyOf, releaseOf } from './notes.ts';

const TOKEN = '123456:synthetic-bot-token';
const target = { botToken: TOKEN, chatId: '-100200300' };
const CHANGELOG = '# Что нового\n\n## 0.2.0\n\nСтало быстрее, цена прежняя: $0.\n\n### Новое\n\n- **Сигнал.** Теперь `Double`.\n';
const SITE = 'https://ext.example/chat-extension/';
const NOTE = [
  '---',
  'kind: new',
  'sites: chatspace, fansly',
  '---',
  '',
  '# Spenders <b> показывает всех',
  '',
  'Для чаттеров: теперь видно всех, кто платил, по сумме за всё время.',
  '',
  '![Все платящие фаны](spenders-all.png)',
  '',
  '## Как это устроено',
  '',
  'Две доски хаба: за всё время и за период.',
  '',
].join('\n');

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const reply = (status: number, body: unknown): Reply => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function scripted(replies: Array<Reply | Error>): { fetchImpl: FetchLike; calls: Array<{ url: string; body: unknown }>; slept: number[]; sleep: (ms: number) => Promise<void> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const slept: number[] = [];
  return {
    calls,
    slept,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    fetchImpl: (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = replies.shift();
      if (next === undefined) throw new Error('no reply scripted');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

describe('the Telegram announcement', () => {
  it('[UP-005] is the notes of the version: title, who and why, the screenshot from the site, the technical side folded, a button to the site', () => {
    const note = parseNote('spenders-all', NOTE, () => 1000);
    const history = historyOf(parseChangelog(CHANGELOG), [{ version: '3.0.1', date: '2026-10-22', notes: [note] }]);
    const post = composePost(releaseOf(history, '3.0.1'), SITE);
    expect(post.split('\n')).toEqual([
      '<h1>ChatGoose 3.0.1</h1>',
      '<p><i>22 октября 2026</i></p>',
      '<hr/>',
      '<h2>✨ Новое</h2>',
      '<h3>Spenders &lt;b&gt; показывает всех</h3>',
      '<p><i>ChatSpace и Fansly</i></p>',
      '<p>Для чаттеров: теперь видно всех, кто платил, по сумме за всё время.</p>',
      `<figure><img src="${SITE}changes/spenders-all.png"/><figcaption>Все платящие фаны</figcaption></figure>`,
      '<details><summary>Как это устроено</summary><p>Две доски хаба: за всё время и за период.</p></details>',
      '<hr/>',
      expect.stringMatching(/^<footer>Обновление придёт само/),
      `<tg-button-row><tg-button type="url" url="${SITE}whats-new.html">Что нового — на сайте</tg-button></tg-button-row>`,
    ]);
    // A hand-written section of CHANGELOG.md goes out as it is.
    expect(composePost(releaseOf(history, '0.2.0'), SITE)).toContain('<p>Стало быстрее, цена прежняя: $0.</p>\n<h4>Новое</h4>\n<ul><li><b>Сигнал.</b> Теперь <code>Double</code>.</li></ul>');
  });

  it('[UP-005] a post too long for one message is refused before anything is signed', () => {
    const long = `# T\n\n## 1.0.0\n\n${'очень длинный текст '.repeat(2000)}\n`;
    expect(() => composePost(releaseOf(historyOf(parseChangelog(long), []), '1.0.0'), SITE)).toThrow(new RegExp(`over Telegram's ${POST_CHAR_LIMIT}`));
  });

  it('posts once as a rich message and returns the message id', async () => {
    const net = scripted([reply(200, { ok: true, result: { message_id: 77 } })]);
    expect(await sendPost(target, '# post', { fetchImpl: net.fetchImpl, sleep: net.sleep, silent: true })).toBe(77);
    expect(net.calls).toEqual([
      { url: `https://api.telegram.org/bot${TOKEN}/sendRichMessage`, body: { chat_id: '-100200300', rich_message: { html: '# post', skip_entity_detection: true }, disable_notification: true } },
    ]);
  });

  it('a short rate limit gets exactly one retry; a long one and a second one do not', async () => {
    const limited = (seconds: number): Reply => reply(429, { ok: false, error_code: 429, parameters: { retry_after: seconds } });
    const once = scripted([limited(3), reply(200, { ok: true, result: { message_id: 5 } })]);
    expect(await sendPost(target, 'x', once)).toBe(5);
    expect(once.slept).toEqual([3000]);

    const long = scripted([limited(600)]);
    await expect(sendPost(target, 'x', long)).rejects.toThrow(/wait 600 s/);
    expect(long.calls).toHaveLength(1);

    const twice = scripted([limited(1), limited(1)]);
    await expect(sendPost(target, 'x', twice)).rejects.toThrow(/still rate-limited/);
    expect(twice.calls).toHaveLength(2);
  });

  it('an indeterminate send is never retried, and says so', async () => {
    const dropped = scripted([new Error(`connect ECONNRESET https://api.telegram.org/bot${TOKEN}/sendRichMessage`)]);
    const error = await sendPost(target, 'x', dropped).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnnounceError);
    expect((error as AnnounceError).indeterminate).toBe(true);
    expect((error as AnnounceError).message).toMatch(/indeterminate/);
    expect(dropped.calls).toHaveLength(1);

    // The headers of a 200 came, the body did not: Telegram may have posted it.
    const cut: Reply = { ok: true, status: 200, json: () => Promise.reject(new Error('socket hang up')) };
    const half = scripted([cut]);
    await expect(sendPost(target, 'x', half)).rejects.toMatchObject({ indeterminate: true });
    expect(half.calls).toHaveLength(1);
  });

  it('a 5xx is indeterminate too — a gateway error can come after the post was taken — and is not retried; a 4xx is a refusal', async () => {
    // nginx in front of the Bot API: an HTML page, not JSON.
    const gateway: Reply = { ok: false, status: 502, json: () => Promise.reject(new Error('Unexpected token <')) };
    const bad = scripted([gateway]);
    const error = (await sendPost(target, 'x', bad).catch((caught: unknown) => caught)) as AnnounceError;
    expect(error).toBeInstanceOf(AnnounceError);
    expect(error.indeterminate).toBe(true);
    expect(error.message).toBe('server error (HTTP 502 with an unreadable body): the send is indeterminate — a 5xx can come after the post was accepted; look at the channel before trying again');
    expect(bad.calls).toHaveLength(1);

    const internal = scripted([reply(500, { ok: false, error_code: 500, description: 'Internal Server Error' })]);
    await expect(sendPost(target, 'x', internal)).rejects.toMatchObject({ indeterminate: true });
    expect(internal.calls).toHaveLength(1);

    // A page of a filtering proxy instead of Telegram's answer: the request never got there.
    const blocked: Reply = { ok: false, status: 403, json: () => Promise.reject(new Error('Unexpected token <')) };
    await expect(sendPost(target, 'x', scripted([blocked]))).rejects.toMatchObject({ indeterminate: false, message: 'Telegram error 403: HTTP 403 with an unreadable body' });
  });

  it('the bot token never reaches an error message', async () => {
    const leaky = scripted([new Error(`request to https://api.telegram.org/bot${TOKEN}/sendRichMessage failed`)]);
    const transport = (await sendPost(target, 'x', leaky).catch((caught: unknown) => caught)) as Error;
    expect(transport.message).not.toContain(TOKEN);
    expect(transport.message).toContain('<bot token>');

    const refused = scripted([reply(400, { ok: false, error_code: 400, description: `Bad Request: chat not found for bot${TOKEN}` })]);
    const failed = (await sendPost(target, 'x', refused).catch((caught: unknown) => caught)) as AnnounceError;
    expect(failed.message).toBe('Telegram error 400: Bad Request: chat not found for bot<bot token>');
    expect(failed.indeterminate).toBe(false);
  });
});
