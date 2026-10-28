// Payment details under Fix (Telegram spec §4.4): a wallet, a card, an IBAN, a link or an amount the chatter wrote must
// come back from Fix character for character, else the dock warns «Реквизиты изменились, сверьте». Money: a changed
// wallet sends a fan's payment elsewhere.

import { describe, expect, it } from 'vitest';

import { detailPrints, detailsKept, paymentDetailsOf } from '../../../src/domain/hosts/telegram/details';

const TRON = 'TQ7xR3d9Wk2eYvN8mLp4sHc6JfB1aZuGtV';

describe('payment details of a draft', () => {
  it('finds wallets, cards, IBANs, links and amounts', () => {
    expect(paymentDetailsOf(`ok so ${TRON} for the custom, $50.`)).toEqual([TRON, '$50']);
    expect(paymentDetailsOf('карта 4276 3800 1234 5678, 1500 руб')).toEqual(['4276 3800 1234 5678', '1500 руб']);
    expect(paymentDetailsOf('send to 0x52908400098527886E0F7030069857D2E4169EE7 pls')).toEqual(['0x52908400098527886E0F7030069857D2E4169EE7']);
    expect(paymentDetailsOf('IBAN DE89 3704 0044 0532 0130 00')).toEqual(['DE89 3704 0044 0532 0130 00']);
    expect(paymentDetailsOf('pay at https://pay.example.com/i/42?x=1.')).toEqual(['https://pay.example.com/i/42?x=1']);
    expect(paymentDetailsOf('love you babe, see you tonight')).toEqual([]);
  });
});

describe('whether Fix kept them', () => {
  it('passes a result that holds every token character for character, around any rewrite', () => {
    const prints = detailPrints(`ok so how about this weekend? my wallet ${TRON} for the custom, $50`);
    expect(detailsKept(prints, `How about this weekend, babe? 😘 Here is my wallet: ${TRON}. The custom is $50.`)).toBe(true);
  });

  it('warns when a wallet changed by one character, an amount changed or a token went missing', () => {
    const prints = detailPrints(`wallet ${TRON}, $50`);
    expect(detailsKept(prints, `wallet ${TRON.slice(0, -1)}X, $50`)).toBe(false);
    expect(detailsKept(prints, `wallet ${TRON}, $60`)).toBe(false);
    expect(detailsKept(prints, 'wallet is in my profile')).toBe(false);
  });

  it('says nothing for a draft with no payment details', () => {
    expect(detailsKept(detailPrints('hey you'), 'Hey you 😘')).toBe(true);
  });
});
