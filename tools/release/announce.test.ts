import { describe, expect, it } from 'vitest';

import { AnnounceError, composePost, imageSize, postProblems, sendPost, TELEGRAM_LIMITS, type FetchLike, type Post, type Upload } from './announce.ts';
import { parseChangelog } from './changelog.ts';
import { parseNote, type Note } from './changes.ts';
import { historyOf, releaseOf } from './notes.ts';

const TOKEN = '123456:synthetic-bot-token';
const target = { botToken: TOKEN, chatId: '-100200300' };
const CHANGELOG = '# Что нового\n\n## 0.2.0\n\nСтало быстрее, цена прежняя: $0.\n\n### Новое\n\n- **Сигнал.** Теперь `Double`.\n';

/** The header of a PNG of that size: all of it the post reads. */
const png = (width: number, height: number): Buffer => {
  const data = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'latin1');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
};

const note = (slug: string, fields: { kind: string; sites?: string; images?: string[] }): Note =>
  parseNote(
    slug,
    [
      '---',
      `kind: ${fields.kind}`,
      `sites: ${fields.sites ?? 'chatspace, fansly'}`,
      '---',
      '',
      `# Заметка ${slug} <b>`,
      '',
      'Для чаттеров: что стало и зачем.',
      '',
      ...(fields.images ?? []).map((file) => `![Снимок ${file}](${file})`),
      '',
      '## Как это устроено',
      '',
      'Внутри две доски хаба.',
      '',
    ].join('\n'),
    () => 1000,
  );

const postOf = (notes: Note[], version = '3.0.1'): Post => composePost(releaseOf(historyOf(parseChangelog(CHANGELOG), [{ version, date: '2026-10-22', notes }]), version));
const uploadsOf = (post: Post, data: (file: string) => Buffer | null = () => png(1440, 900)): Upload[] => post.photos.map((photo) => ({ ...photo, data: data(photo.file) }));

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };
const reply = (status: number, body: unknown): Reply => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

function scripted(replies: Array<Reply | Error>): { fetchImpl: FetchLike; calls: Array<{ url: string; form: FormData }>; slept: number[]; sleep: (ms: number) => Promise<void> } {
  const calls: Array<{ url: string; form: FormData }> = [];
  const slept: number[] = [];
  return {
    calls,
    slept,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    fetchImpl: (url, init) => {
      calls.push({ url, form: init.body });
      const next = replies.shift();
      if (next === undefined) throw new Error('no reply scripted');
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };
}

const TEXT_POST = postOf([note('fix-one', { kind: 'fixed' })]);
const send = (net: ReturnType<typeof scripted>, post: Post = TEXT_POST): Promise<number | null> => sendPost(target, post, uploadsOf(post), { silent: post.silent, fetchImpl: net.fetchImpl, sleep: net.sleep });

describe('the Telegram post', () => {
  it('[UP-005] is the notes of the version: the sites by the chatters\' names, each screenshot uploaded with it, the technical side folded', () => {
    const post = postOf([note('spenders-all', { kind: 'new', images: ['spenders-all.png'] }), note('fansly-only', { kind: 'fixed', sites: 'fansly' })]);
    expect(post.html.split('\n')).toEqual([
      '<h1>ChatGoose 3.0.1</h1>',
      '<p><i>22 октября 2026</i></p>',
      '<hr/>',
      '<h2>✨ Новое</h2>',
      '<h3>Заметка spenders-all &lt;b&gt;</h3>',
      '<p><i>OnlyFans и Fansly</i></p>',
      '<p>Для чаттеров: что стало и зачем.</p>',
      '<figure><img src="tg://photo?id=shot-1"/><figcaption>Снимок spenders-all.png</figcaption></figure>',
      '<details><summary>Как это устроено</summary><p>Внутри две доски хаба.</p></details>',
      '<hr/>',
      '<h2>🐛 Исправлено</h2>',
      '<h3>Заметка fansly-only &lt;b&gt;</h3>',
      '<p><i>Fansly</i></p>',
      '<p>Для чаттеров: что стало и зачем.</p>',
      '<details><summary>Как это устроено</summary><p>Внутри две доски хаба.</p></details>',
      '<hr/>',
      '<footer>Firefox поставит обновление сам в течение дня. Чтобы сразу: ☰ → «Дополнения и темы» → ⚙ → «Проверить наличие обновлений». Потом перезагрузите открытые вкладки OnlyFans (ChatSpace) и Fansly.</footer>',
    ]);
    expect(post.photos).toEqual([{ id: 'shot-1', file: 'spenders-all.png' }]);
    expect(post.silent).toBe(false);
    // A hand-written section of CHANGELOG.md goes out as it is.
    expect(composePost(releaseOf(historyOf(parseChangelog(CHANGELOG), []), '0.2.0')).html).toContain('<p>Стало быстрее, цена прежняя: $0.</p>\n<h4>Новое</h4>\n<ul><li><b>Сигнал.</b> Теперь <code>Double</code>.</li></ul>');
  });

  it('opens with the intro; four notes or more get a line of contents with a link to each', () => {
    const post = postOf([
      parseNote('launch', '---\nkind: intro\nsites: chatspace, fansly\n---\n\n# Одно расширение\n\nДля всех чаттеров.\n', () => null),
      ...['a-one', 'b-two', 'c-three'].map((slug) => note(slug, { kind: 'improved' })),
      note('d-four', { kind: 'fixed', sites: 'chatspace' }),
    ]);
    const lines = post.html.split('\n');
    expect(lines.slice(2, 5)).toEqual([
      '<h2>Одно расширение</h2>',
      '<p>Для всех чаттеров.</p>',
      '<p><b>В этом выпуске:</b> <a href="#a-one">Заметка a-one &lt;b&gt;</a> · <a href="#b-two">Заметка b-two &lt;b&gt;</a> · <a href="#c-three">Заметка c-three &lt;b&gt;</a> · <a href="#d-four">Заметка d-four &lt;b&gt;</a></p>',
    ]);
    expect(lines).toContain('<a name="d-four"></a>');
    expect(lines[lines.indexOf('<a name="d-four"></a>') + 2]).toBe('<p><i>OnlyFans</i></p>');
    // The intro rings, as something new does.
    expect(post.silent).toBe(false);
    // Three notes need no contents.
    expect(postOf(['a-one', 'b-two', 'c-three'].map((slug) => note(slug, { kind: 'new' }))).html).not.toMatch(/В этом выпуске|<a name=/);
  });

  it('names each note in the line of contents by its title up to «: » or « — »', () => {
    const titled = (slug: string, title: string): Note => ({ ...note(slug, { kind: 'new' }), title: [{ kind: 'text', text: title }] });
    const html = postOf([titled('a-one', 'Ответ в один клик: Reply и Fix'), titled('b-two', 'Голосовое — из черновика'), titled('c-three', 'Все настройки на одной странице'), titled('d-four', 'Spenders: кто платит')]).html;
    expect(html).toContain('<a href="#a-one">Ответ в один клик</a> · <a href="#b-two">Голосовое</a> · <a href="#c-three">Все настройки на одной странице</a> · <a href="#d-four">Spenders</a>');
  });

  it('[UP-005] a post of improvements and fixes alone goes without a notification', () => {
    expect(postOf([note('a-one', { kind: 'improved' }), note('b-two', { kind: 'fixed' })]).silent).toBe(true);
    expect(postOf([note('a-one', { kind: 'improved' }), note('b-two', { kind: 'new' })]).silent).toBe(false);
  });

  it('is refused before any request when Telegram would not take it: too long, too many pictures, a picture it cannot show', async () => {
    expect(postProblems(TEXT_POST, [])).toEqual([]);
    const long = composePost(releaseOf(historyOf(parseChangelog(`# T\n\n## 1.0.0\n\n${'очень длинный текст '.repeat(2000)}\n`), []), '1.0.0'));
    expect(postProblems(long, [])).toEqual([expect.stringMatching(/^the post is \d+ characters, Telegram takes 32768/)]);

    const many = postOf(
      Array.from({ length: 13 }, (_, index) => note(`n-${String.fromCharCode(97 + index)}`, { kind: 'new', images: ['a.png', 'b.png', 'c.png', 'd.png'] })),
    );
    expect(many.photos).toHaveLength(52);
    expect(postProblems(many, uploadsOf(many))).toContain(`the post has 52 screenshots, Telegram takes ${TELEGRAM_LIMITS.media}`);

    const shots = postOf([note('shots', { kind: 'new', images: ['tall.png', 'thin.png', 'gone.png', 'text.png'] })]);
    const files: Record<string, Buffer | null> = { 'tall.png': png(1440, 9000), 'thin.png': png(100, 2500), 'gone.png': null, 'text.png': Buffer.from('<html>not a picture</html>') };
    expect(postProblems(shots, uploadsOf(shots, (file) => files[file] ?? null))).toEqual([
      'changes/tall.png is 1440×9000: a photo\'s width and height together are at most 10000',
      'changes/thin.png is 100×2500: a photo is at most 20 times longer than wide',
      'changes/gone.png is missing',
      'changes/text.png is neither a PNG nor a JPEG',
    ]);
    const net = scripted([]);
    await expect(sendPost(target, shots, uploadsOf(shots, (file) => files[file] ?? null), { silent: false, fetchImpl: net.fetchImpl, sleep: net.sleep })).rejects.toMatchObject({ indeterminate: false, message: expect.stringMatching(/cannot go out, nothing was sent/) });
    expect(net.calls).toEqual([]);
  });

  it('reads the size of a PNG and of a JPEG', () => {
    expect(imageSize(png(1440, 900))).toEqual({ width: 1440, height: 900, type: 'image/png' });
    // SOI, an APP0 of 16 bytes, then SOF0: precision 8, height 600, width 800.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array<number>(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0x01, 0x22, 0x00]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600, type: 'image/jpeg' });
    expect(imageSize(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('sending the post', () => {
  it('posts once as a rich message with the screenshots in the same request, and returns the message id', async () => {
    const post = postOf([note('spenders-all', { kind: 'new', images: ['spenders-all.png', 'second.jpg'] })]);
    const net = scripted([reply(200, { ok: true, result: { message_id: 77 } })]);
    expect(await sendPost(target, post, uploadsOf(post), { silent: false, fetchImpl: net.fetchImpl, sleep: net.sleep })).toBe(77);
    expect(net.calls).toHaveLength(1);
    const [call] = net.calls;
    expect(call?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendRichMessage`);
    expect(call?.form.get('chat_id')).toBe('-100200300');
    expect(call?.form.get('disable_notification')).toBe('false');
    expect(JSON.parse(String(call?.form.get('rich_message')))).toEqual({
      html: post.html,
      media: [
        { id: 'shot-1', media: { type: 'photo', media: 'attach://shot-1' } },
        { id: 'shot-2', media: { type: 'photo', media: 'attach://shot-2' } },
      ],
      skip_entity_detection: true,
    });
    const file = call?.form.get('shot-2');
    expect(file).toBeInstanceOf(File);
    expect({ name: (file as File).name, type: (file as File).type, size: (file as File).size }).toEqual({ name: 'second.jpg', type: 'image/png', size: 33 });
  });

  it('a short rate limit gets exactly one retry; a long one and a second one do not', async () => {
    const limited = (seconds: number): Reply => reply(429, { ok: false, error_code: 429, parameters: { retry_after: seconds } });
    const once = scripted([limited(3), reply(200, { ok: true, result: { message_id: 5 } })]);
    expect(await send(once)).toBe(5);
    expect(once.slept).toEqual([3000]);

    const long = scripted([limited(600)]);
    await expect(send(long)).rejects.toThrow(/wait 600 s/);
    expect(long.calls).toHaveLength(1);

    const twice = scripted([limited(1), limited(1)]);
    await expect(send(twice)).rejects.toThrow(/still rate-limited/);
    expect(twice.calls).toHaveLength(2);
  });

  it('an indeterminate send is never retried, and says so', async () => {
    const dropped = scripted([new Error(`connect ECONNRESET https://api.telegram.org/bot${TOKEN}/sendRichMessage`)]);
    const error = await send(dropped).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnnounceError);
    expect((error as AnnounceError).indeterminate).toBe(true);
    expect((error as AnnounceError).message).toMatch(/indeterminate/);
    expect(dropped.calls).toHaveLength(1);

    // The headers of a 200 came, the body did not: Telegram may have posted it.
    const cut: Reply = { ok: true, status: 200, json: () => Promise.reject(new Error('socket hang up')) };
    const half = scripted([cut]);
    await expect(send(half)).rejects.toMatchObject({ indeterminate: true });
    expect(half.calls).toHaveLength(1);
  });

  it('a 5xx is indeterminate too — a gateway error can come after the post was taken — and is not retried; a 4xx is a refusal', async () => {
    // nginx in front of the Bot API: an HTML page, not JSON.
    const gateway: Reply = { ok: false, status: 502, json: () => Promise.reject(new Error('Unexpected token <')) };
    const bad = scripted([gateway]);
    const error = (await send(bad).catch((caught: unknown) => caught)) as AnnounceError;
    expect(error).toBeInstanceOf(AnnounceError);
    expect(error.indeterminate).toBe(true);
    expect(error.message).toBe('server error (HTTP 502 with an unreadable body): the send is indeterminate — a 5xx can come after the post was accepted; look at the channel before trying again');
    expect(bad.calls).toHaveLength(1);

    const internal = scripted([reply(500, { ok: false, error_code: 500, description: 'Internal Server Error' })]);
    await expect(send(internal)).rejects.toMatchObject({ indeterminate: true });
    expect(internal.calls).toHaveLength(1);

    // A page of a filtering proxy instead of Telegram's answer: the request never got there.
    const blocked: Reply = { ok: false, status: 403, json: () => Promise.reject(new Error('Unexpected token <')) };
    await expect(send(scripted([blocked]))).rejects.toMatchObject({ indeterminate: false, message: 'Telegram error 403: HTTP 403 with an unreadable body' });
  });

  it('the bot token never reaches an error message', async () => {
    const leaky = scripted([new Error(`request to https://api.telegram.org/bot${TOKEN}/sendRichMessage failed`)]);
    const transport = (await send(leaky).catch((caught: unknown) => caught)) as Error;
    expect(transport.message).not.toContain(TOKEN);
    expect(transport.message).toContain('<bot token>');

    const refused = scripted([reply(400, { ok: false, error_code: 400, description: `Bad Request: chat not found for bot${TOKEN}` })]);
    const failed = (await send(refused).catch((caught: unknown) => caught)) as AnnounceError;
    expect(failed.message).toBe('Telegram error 400: Bad Request: chat not found for bot<bot token>');
    expect(failed.indeterminate).toBe(false);
  });
});
