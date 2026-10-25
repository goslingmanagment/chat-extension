// «Память» of the fan panel (Chat Memory week 2): the hub's card of the person across pages as the panel shows it.
// Pure. Pages most paid first; suggestions with why Hub thinks so and the person's «Да» / «Нет»; facts by kind, an empty
// kind said as «не знаю» (the roadmap's rule: where the chat says nothing, the card says so instead of guessing).
// Chat Memory week 4: the customs, open first; on a page the person works an open one offers the card's suggestions —
// «Оплачен» by a tip no custom took (a custom of the asked page only: the tips are that page's), «Отдали» by media the
// page sent since — and «Отменить». Hub sets nothing by itself.

import { PLATFORM_TITLES } from '@cg/contracts/hosts';
import { FAN_CUSTOM_STATES, FAN_FACT_KINDS, type FanCard, type FanCardCustom, type FanCardPage } from '@cg/contracts/hub';
import { type FanCustomPaymentVM, type FanCustomVM, type FanMemoryCustomsVM, type FanMemoryFactVM, type FanMemoryPageVM, type FanMemorySuggestionVM, type FanMemoryVM, type Msg, type UiAction } from '@cg/contracts/vm';

/** Every page of the person as the panel shows it. */
export function memoryPage(page: FanCardPage): FanMemoryPageVM {
  return {
    pageLabel: page.pageLabel,
    model: page.modelName,
    mine: page.granted,
    alias: page.alias,
    spent: page.spentMills,
    last30: Object.values(page.last30Mills).reduce((sum, mills) => sum + mills, 0),
    subscribed: page.subscribed,
  };
}

/** Why Hub suggests the pair, in the person's words. */
export function suggestionWhy(suggestion: FanCard['suggestions'][number]): Msg {
  const shared = suggestion.shared;
  switch (suggestion.reason) {
    case 'same_alias':
      return { key: 'fanPanel.memory.why.alias', params: { shared, on: suggestion.sharedOn ?? '' } };
    case 'same_username':
      return { key: 'fanPanel.memory.why.username', params: { shared, platform: PLATFORM_TITLES[suggestion.platform] ?? suggestion.platform } };
    case 'replaced_account':
      return { key: 'fanPanel.memory.why.replaced', params: { shared } };
    default:
      return { key: 'fanPanel.memory.why.other', params: { shared } };
  }
}

export interface MemoryInput {
  readonly card: FanCard;
  /** Decisions and fact changes on their way: `link:<platform>:<fanRef>`, `fact:<id>`. */
  readonly busy: ReadonlySet<string>;
  /** The chat of a fact's page in this tab, to open; null — not in this tab, or the one open now. */
  readonly openOf: (pageLabel: string) => UiAction | null;
  /** The hub serves customs (`fan-customs-v1`). */
  readonly customs?: boolean;
}

const OPEN_CUSTOM: readonly string[] = ['ordered', 'paid'];

/** «Кастомы» of the card: `busy` keys are `custom:<id>` and `custom:new` (a record on its way). */
export function customsModel(card: FanCard, busy: ReadonlySet<string>): FanMemoryCustomsVM {
  const payments: FanCustomPaymentVM[] = (card.customPayments ?? []).map((payment) => ({ ref: payment.paymentRef, amount: payment.amountMills, at: payment.at, note: payment.note }));
  const custom = (item: FanCardCustom): FanCustomVM => {
    const open = item.granted && OPEN_CUSTOM.includes(item.state);
    const state = (FAN_CUSTOM_STATES as readonly string[]).includes(item.state) ? (item.state as FanCustomVM['state']) : null;
    return {
      id: item.id,
      description: item.description,
      pageLabel: item.pageLabel,
      state,
      price: item.priceMills,
      paid: item.paymentMills,
      paidAt: item.paidAt,
      deliveredAt: item.deliveredAt,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      payWith: open && item.state === 'ordered' && item.pageLabel === card.pageLabel ? payments.map((payment) => ({ ...payment, action: { type: 'ChangeFanCustom', customId: item.id, action: 'paid', ref: payment.ref } })) : [],
      deliveredBy: open ? item.deliveryCandidates.map((candidate) => ({ ref: candidate.messageRef, at: candidate.at, mediaCount: candidate.mediaCount, price: candidate.priceMills, action: { type: 'ChangeFanCustom', customId: item.id, action: 'delivered', ref: candidate.messageRef } })) : [],
      cancel: open ? { type: 'ChangeFanCustom', customId: item.id, action: 'cancel' } : null,
      busy: busy.has(`custom:${String(item.id)}`),
    };
  };
  const items = card.customs ?? [];
  // The open first, as the hub sends them; the ended after.
  const ordered = [...items.filter((item) => OPEN_CUSTOM.includes(item.state)), ...items.filter((item) => !OPEN_CUSTOM.includes(item.state))];
  const asked = card.pages.find((page) => page.pageLabel === card.pageLabel);
  return { items: ordered.map(custom), payments, record: asked === undefined || asked.granted ? { busy: busy.has('custom:new') } : null };
}

export function memoryModel({ card, busy, openOf, customs }: MemoryInput): Omit<FanMemoryVM, 'view' | 'error'> {
  const suggestions: FanMemorySuggestionVM[] = card.suggestions.map((suggestion) => {
    const key = `link:${suggestion.platform}:${suggestion.fanRef}`;
    const decide = (decision: 'same' | 'different'): UiAction => ({ type: 'DecideFanLink', otherPlatform: suggestion.platform, otherFanRef: suggestion.fanRef, decision });
    return {
      key,
      platform: suggestion.platform,
      name: suggestion.displayName,
      username: suggestion.username,
      gone: suggestion.gone,
      linkedBy: null,
      why: suggestionWhy(suggestion),
      pages: [...suggestion.pages].sort((a, b) => b.spentMills - a.spentMills).map(memoryPage),
      same: decide('same'),
      different: decide('different'),
      busy: busy.has(key),
    };
  });
  const facts = FAN_FACT_KINDS.map((kind) => ({
    kind,
    items: card.facts
      .filter((fact) => fact.kind === kind)
      .map(
        (fact): FanMemoryFactVM => ({
          id: fact.id,
          text: fact.text,
          pageLabel: fact.pageLabel,
          at: fact.messageAt,
          author: fact.source === 'chatter' ? fact.author : null,
          mine: fact.granted,
          open: fact.granted ? openOf(fact.pageLabel) : null,
          remove: fact.granted ? { type: 'ChangeFanFact', factId: fact.id, action: 'delete' } : null,
          correctable: fact.granted,
          busy: busy.has(`fact:${String(fact.id)}`),
        }),
      ),
  }));
  return {
    fanRef: card.fanRef,
    accounts: card.accounts.map((account) => ({ key: `${account.platform}:${account.fanRef}`, platform: account.platform, name: account.displayName, username: account.username, gone: account.gone, linkedBy: account.linkedBy })),
    pages: [...card.pages].sort((a, b) => b.spentMills - a.spentMills).map(memoryPage),
    suggestions,
    facts,
    ...(customs === true ? { customs: customsModel(card, busy) } : {}),
  };
}
