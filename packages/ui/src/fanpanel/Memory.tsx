// «Память» of the fan panel (Chat Memory week 2): the person across pages, as the hub's card tells it.
// - Pages, most paid first: the page, «не ваша» for one the person does not work, the team's alias as it is (it
//   carries the 💵 / ❌ marks), spent in all and in 30 days, subscribed or not.
// - «Похоже, это тот же человек»: each account Hub suggests, why, its pages, «Да, это он» / «Нет».
// - Facts by kind — «О себе», «Обещали», «Договорились» — each with its page and time; on a page the person works:
//   «Открыть чат» (another account's chat in this tab), «Исправить» in place, «Удалить». An empty kind says «не знаю»:
//   a deliberate exception to the panel's «what no source knows is not drawn» (the roadmap's rule for the facts).
// - «Кастомы» (Chat Memory week 4): the open first, with how long since the payment; on a page the person works
//   «Оплачен» by a tip Hub suggests, «Отдали» by media the page sent since («это он? 1 медиа · вчера»), «Отменить»;
//   «Записать кастом» — what, the price, and one of the suggested tips if it is the payment. Hub sets nothing itself.

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { type FanCustomPaymentVM, type FanCustomVM, type FanMemoryCustomsVM, type FanMemoryFactVM, type FanMemoryPageVM, type FanMemoryVM, type I18n } from '@cg/contracts/vm';

import { Button, ErrorCard, ViewState, useDispatch, useI18n } from '../kit';

const FACT_KEYS = { about: 'fanPanel.memory.facts.about', promise: 'fanPanel.memory.facts.promise', agreement: 'fanPanel.memory.facts.agreement' } as const;

function PageRow({ page }: { readonly page: FanMemoryPageVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-mem__page" data-cg-memory-page={page.pageLabel}>
      <div class="cg-mem__line">
        <b class="cg-mem__label">{page.pageLabel}</b>
        {page.mine ? null : <span class="cg-mem__not">{i18n.t('fanPanel.memory.notYours')}</span>}
        <span class="cg-mem__sub">{i18n.t(page.subscribed ? 'fanPanel.memory.subscribed' : 'fanPanel.memory.notSubscribed')}</span>
      </div>
      {page.alias === null ? null : <div class="cg-mem__alias">{page.alias}</div>}
      <div class="cg-mem__money cg-num">
        {/* Nothing in 30 days: the total alone (a known zero is not drawn). */}
        {page.last30 > 0 ? i18n.t('fanPanel.memory.pageSpent', { total: i18n.formatMoneyMills(page.spent), last30: i18n.formatMoneyMills(page.last30) }) : i18n.formatMoneyMills(page.spent)}
      </div>
    </div>
  );
}

function FactRow({ fact }: { readonly fact: FanMemoryFactVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [draft, setDraft] = useState<string | null>(null);
  const meta = [fact.pageLabel, fact.at === null ? null : i18n.formatTime(fact.at, 'date'), fact.author === null ? null : i18n.t('fanPanel.memory.correctedBy', { name: fact.author })].filter((part) => part !== null).join(' · ');
  if (draft !== null) {
    return (
      <div class="cg-mem__fact is-editing" data-cg-fact={fact.id}>
        <textarea class="cg-mem__fix" maxLength={500} value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
        <div class="cg-fp__acts">
          <Button
            label={i18n.t('common.save')}
            variant="quiet"
            reason={draft.trim() === '' ? i18n.t('fanPanel.memory.unknown') : null}
            onClick={() => {
              const text = draft.trim();
              if (text === '') return;
              setDraft(null);
              void dispatch({ type: 'ChangeFanFact', factId: fact.id, action: 'correct', text });
            }}
          />
          <Button label={i18n.t('common.cancel')} variant="quiet" onClick={() => setDraft(null)} />
        </div>
      </div>
    );
  }
  return (
    <div class="cg-mem__fact" data-cg-fact={fact.id} aria-busy={fact.busy ? 'true' : 'false'}>
      <div class="cg-mem__text">{fact.text}</div>
      <div class="cg-mem__meta">{meta}</div>
      {fact.mine ? (
        <div class="cg-fp__acts">
          {fact.open === null ? null : <Button label={i18n.t('common.openChat')} variant="quiet" onClick={() => void dispatch(fact.open!)} />}
          {fact.correctable ? <Button label={i18n.t('fanPanel.memory.fix')} variant="quiet" reason={fact.busy ? i18n.t('common.loading') : null} onClick={() => setDraft(fact.text)} /> : null}
          {fact.remove === null ? null : <Button label={i18n.t('fanPanel.memory.delete')} variant="quiet" reason={fact.busy ? i18n.t('common.loading') : null} onClick={() => void dispatch(fact.remove!)} />}
        </div>
      ) : null}
    </div>
  );
}

/** «$120 · 2 дн назад · «for my video»». */
function tipText(i18n: I18n, payment: FanCustomPaymentVM): string {
  const line = i18n.t('fanPanel.memory.custom.tip', { amount: i18n.formatMoneyMills(payment.amount), age: i18n.formatAge(payment.at) });
  return payment.note === null || payment.note === '' ? line : `${line} · «${payment.note}»`;
}

/** Where the custom is: waiting for its payment since it was written, paid since when, delivered when. */
function customState(i18n: I18n, custom: FanCustomVM): string {
  switch (custom.state) {
    case 'ordered':
      return i18n.t('fanPanel.memory.custom.ordered', { age: i18n.formatAge(custom.createdAt) });
    case 'paid':
      return custom.paidAt === null ? i18n.t('fanPanel.memory.custom.unknown') : i18n.t('fanPanel.memory.custom.paid', { age: i18n.formatAge(custom.paidAt) });
    case 'delivered':
      return custom.deliveredAt === null ? i18n.t('fanPanel.memory.custom.unknown') : i18n.t('fanPanel.memory.custom.delivered', { date: i18n.formatTime(custom.deliveredAt, 'date') });
    case 'cancelled':
      return i18n.t('fanPanel.memory.custom.cancelled');
    case null:
      return i18n.t('fanPanel.memory.custom.unknown');
  }
}

function CustomRow({ custom }: { readonly custom: FanCustomVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const money = custom.paid ?? custom.price;
  const meta = [customState(i18n, custom), money === null ? null : i18n.formatMoneyMills(money), custom.pageLabel, i18n.t('fanPanel.memory.custom.by', { name: custom.createdBy })].filter((part) => part !== null).join(' · ');
  const busy = custom.busy ? i18n.t('common.loading') : null;
  return (
    <div class={`cg-mem__custom is-${custom.state ?? 'unknown'}`} data-cg-custom={custom.id} aria-busy={custom.busy ? 'true' : 'false'}>
      <div class="cg-mem__text">{custom.description}</div>
      <div class="cg-mem__meta">{meta}</div>
      {custom.payWith.length === 0 ? null : (
        <div class="cg-mem__ask">
          <span>{i18n.t('fanPanel.memory.custom.isPayment')}</span>
          {custom.payWith.map((payment) => (
            <Button key={payment.ref} label={tipText(i18n, payment)} variant="line" size="sm" reason={busy} onClick={() => void dispatch(payment.action)} />
          ))}
        </div>
      )}
      {custom.deliveredBy.length === 0 ? null : (
        <div class="cg-mem__ask">
          <span>{i18n.t('fanPanel.memory.custom.isDelivery')}</span>
          {custom.deliveredBy.map((message) => (
            <Button key={message.ref} label={i18n.t('fanPanel.memory.custom.media', { count: message.mediaCount, age: i18n.formatAge(message.at) })} variant="line" size="sm" reason={busy} onClick={() => void dispatch(message.action)} />
          ))}
        </div>
      )}
      {custom.cancel === null ? null : (
        <div class="cg-fp__acts">
          <Button label={i18n.t('fanPanel.memory.custom.cancel')} variant="quiet" size="sm" reason={busy} onClick={() => void dispatch(custom.cancel!)} />
        </div>
      )}
    </div>
  );
}

/** «Записать кастом»: what was ordered, the price in dollars, and a suggested tip if it is the payment. */
function RecordCustom({ customs }: { readonly customs: FanMemoryCustomsVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [draft, setDraft] = useState<{ readonly what: string; readonly price: string; readonly payment: string | null } | null>(null);
  const record = customs.record;
  if (record === null) return null;
  if (draft === null) {
    return (
      <div class="cg-fp__acts">
        <Button label={i18n.t('fanPanel.memory.custom.record')} variant="line" reason={record.busy ? i18n.t('common.loading') : null} onClick={() => setDraft({ what: '', price: '', payment: null })} />
      </div>
    );
  }
  const dollars = Number(draft.price.replace(',', '.'));
  const priceMills = draft.price.trim() === '' || !Number.isFinite(dollars) || dollars < 0 ? undefined : Math.round(dollars * 1000);
  const save = (): void => {
    const description = draft.what.trim();
    if (description === '') return;
    setDraft(null);
    void dispatch({ type: 'RecordFanCustom', description, ...(priceMills === undefined ? {} : { priceMills }), ...(draft.payment === null ? {} : { paymentRef: draft.payment }) });
  };
  return (
    <div class="cg-mem__record" data-cg-custom-record="1">
      <textarea class="cg-mem__fix" maxLength={500} placeholder={i18n.t('fanPanel.memory.custom.what')} aria-label={i18n.t('fanPanel.memory.custom.what')} value={draft.what} onInput={(event) => setDraft({ ...draft, what: event.currentTarget.value })} />
      <input class="cg-mem__price cg-num" inputMode="decimal" placeholder={i18n.t('fanPanel.memory.custom.price')} aria-label={i18n.t('fanPanel.memory.custom.price')} value={draft.price} onInput={(event) => setDraft({ ...draft, price: event.currentTarget.value })} />
      {customs.payments.length === 0 ? null : (
        <div class="cg-mem__ask">
          <span>{i18n.t('fanPanel.memory.custom.payment')}</span>
          {customs.payments.map((payment) => (
            <Button key={payment.ref} label={tipText(i18n, payment)} variant="line" size="sm" pressed={draft.payment === payment.ref} onClick={() => setDraft({ ...draft, payment: draft.payment === payment.ref ? null : payment.ref })} />
          ))}
        </div>
      )}
      <div class="cg-fp__acts">
        <Button label={i18n.t('common.save')} variant="quiet" reason={draft.what.trim() === '' ? i18n.t('fanPanel.memory.custom.what') : null} onClick={save} />
        <Button label={i18n.t('common.cancel')} variant="quiet" onClick={() => setDraft(null)} />
      </div>
    </div>
  );
}

function Customs({ customs }: { readonly customs: FanMemoryCustomsVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-fp__sec" data-cg-customs="1">
      <div class="cg-fp__cap">{i18n.t('fanPanel.memory.customs')}</div>
      {customs.items.length === 0 ? <div class="cg-fp__none">{i18n.t('fanPanel.memory.custom.none')}</div> : customs.items.map((custom) => <CustomRow key={custom.id} custom={custom} />)}
      <RecordCustom customs={customs} />
    </div>
  );
}

export function MemoryTab({ memory }: { readonly memory: FanMemoryVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (memory.view.s !== 'ready' && memory.view.s !== 'partial') return <ViewState view={memory.view} />;
  return (
    <div class="cg-mem" data-cg-memory="1">
      {memory.error === null ? null : (
        <div class="cg-fp__sec">
          <ErrorCard error={memory.error} tone="failure" />
        </div>
      )}
      {memory.pages.length === 0 ? null : (
        <div class="cg-fp__sec">
          <div class="cg-fp__cap">{i18n.t('fanPanel.memory.pages')}</div>
          {memory.pages.map((page) => (
            <PageRow key={page.pageLabel} page={page} />
          ))}
        </div>
      )}
      {memory.customs === undefined ? null : <Customs customs={memory.customs} />}
      {memory.suggestions.map((suggestion) => (
        <div key={suggestion.key} class="cg-fp__sec cg-mem__suggest" data-cg-suggestion={suggestion.key}>
          <div class="cg-fp__cap">{i18n.t('fanPanel.memory.suggest')}</div>
          <div class="cg-mem__line">
            <b>{suggestion.name ?? (suggestion.username === null ? suggestion.platform : `@${suggestion.username}`)}</b>
            {suggestion.username === null || suggestion.name === null ? null : <span class="cg-mem__sub">@{suggestion.username}</span>}
            {suggestion.gone ? <span class="cg-mem__not">{i18n.t('fanPanel.memory.gone')}</span> : null}
          </div>
          <div class="cg-mem__why">{i18n.text(suggestion.why)}</div>
          {suggestion.pages.map((page) => (
            <PageRow key={page.pageLabel} page={page} />
          ))}
          <div class="cg-fp__acts">
            <Button label={i18n.t('fanPanel.memory.same')} variant="line" reason={suggestion.busy ? i18n.t('common.loading') : null} onClick={() => void dispatch(suggestion.same)} />
            <Button label={i18n.t('fanPanel.memory.different')} variant="quiet" reason={suggestion.busy ? i18n.t('common.loading') : null} onClick={() => void dispatch(suggestion.different)} />
          </div>
        </div>
      ))}
      {memory.facts.map((group) => (
        <div key={group.kind} class="cg-fp__sec" data-cg-facts={group.kind}>
          <div class="cg-fp__cap">{i18n.t(FACT_KEYS[group.kind])}</div>
          {group.items.length === 0 ? <div class="cg-fp__none">{i18n.t('fanPanel.memory.unknown')}</div> : group.items.map((fact) => <FactRow key={fact.id} fact={fact} />)}
        </div>
      ))}
      {memory.accounts.length < 2 ? null : (
        <div class="cg-fp__sec">
          <div class="cg-fp__cap">{i18n.t('fanPanel.memory.accounts')}</div>
          {memory.accounts.map((account) => (
            <div key={account.key} class="cg-mem__line">
              <b>{account.name ?? (account.username === null ? account.platform : `@${account.username}`)}</b>
              <span class="cg-mem__sub">{account.platform}</span>
              {account.linkedBy === null ? null : <span class="cg-mem__sub">{i18n.t('fanPanel.memory.linkedBy', { name: account.linkedBy })}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const MEMORY_CSS = `
.cg-mem__custom { padding: 6px 0; }
.cg-mem__custom + .cg-mem__custom { border-top: 1px dashed var(--cg-rule); }
.cg-mem__custom[aria-busy="true"] { opacity: 0.6; }
.cg-mem__custom.is-delivered .cg-mem__text, .cg-mem__custom.is-cancelled .cg-mem__text { color: var(--cg-ink-2); }
.cg-mem__ask { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 4px; font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-mem__ask > span { margin-right: 2px; }
.cg-mem__record { display: grid; gap: 6px; margin-top: 8px; }
.cg-mem__price { box-sizing: border-box; width: 120px; font: inherit; color: var(--cg-ink); background: var(--cg-raised); border: 1px solid var(--cg-rule-3); border-radius: var(--cg-r-md); padding: 4px 8px; }
.cg-mem__page { padding: 6px 0; }
.cg-mem__page + .cg-mem__page { border-top: 1px dashed var(--cg-rule); }
.cg-mem__line { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cg-mem__label { font-weight: 600; color: var(--cg-ink-strong); }
.cg-mem__not { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); box-shadow: inset 0 0 0 1px var(--cg-rule-3); border-radius: var(--cg-r-pill); padding: 0 6px; }
.cg-mem__sub { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-mem__alias { color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-mem__money { font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-mem__why { font-size: var(--cg-text-sm); color: var(--cg-ink-2); margin: 2px 0 4px; }
.cg-mem__fact { padding: 6px 0; }
.cg-mem__fact + .cg-mem__fact { border-top: 1px dashed var(--cg-rule); }
.cg-mem__fact[aria-busy="true"] { opacity: 0.6; }
.cg-mem__text { font-size: var(--cg-text-md); line-height: 20px; color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-mem__meta { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-mem__fix { box-sizing: border-box; width: 100%; min-height: 60px; resize: vertical; font: inherit; color: var(--cg-ink); background: var(--cg-raised); border: 1px solid var(--cg-rule-3); border-radius: var(--cg-r-md); padding: 6px 8px; }
`;
