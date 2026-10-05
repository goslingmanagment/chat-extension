import { describe, expect, it } from 'vitest';

import { AnnounceError, composePost, POST_CHAR_LIMIT, sendPost, type FetchLike } from './announce.ts';
import { parseChangelog, sectionOf } from './changelog.ts';

const TOKEN = '123456:synthetic-bot-token';
const target = { botToken: TOKEN, chatId: '-100200300' };
const CHANGELOG = '# Что нового\n\n## 0.2.0\n\nСтало быстрее, цена прежняя: $0.\n\n### Новое\n\n- **Сигнал.** Теперь `Double`.\n';

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
  it('[UP-005] is the changelog section of the version under the product name, dollars escaped', () => {
    const post = composePost(sectionOf(parseChangelog(CHANGELOG), '0.2.0'));
    expect(post).toBe('# ChatGoose для ChatSpace 0.2.0\n\nСтало быстрее, цена прежняя: \\$0.\n\n### Новое\n\n- **Сигнал.** Теперь `Double`.');
  });

  it('[UP-005] a section too long for one message is refused before anything is signed', () => {
    const long = `# T\n\n## 1.0.0\n\n${'очень длинный текст '.repeat(2000)}\n`;
    expect(() => composePost(sectionOf(parseChangelog(long), '1.0.0'))).toThrow(new RegExp(`over Telegram's ${POST_CHAR_LIMIT}`));
  });

  it('posts once as a rich message and returns the message id', async () => {
    const net = scripted([reply(200, { ok: true, result: { message_id: 77 } })]);
    expect(await sendPost(target, '# post', { fetchImpl: net.fetchImpl, sleep: net.sleep, silent: true })).toBe(77);
    expect(net.calls).toEqual([
      { url: `https://api.telegram.org/bot${TOKEN}/sendRichMessage`, body: { chat_id: '-100200300', rich_message: { markdown: '# post', skip_entity_detection: true }, disable_notification: true } },
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
