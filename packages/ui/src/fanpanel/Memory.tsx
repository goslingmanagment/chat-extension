// «Память» of the fan panel (Chat Memory week 2): the person across pages, as the hub's card tells it.
// - Pages, most paid first: the page, «не ваша» for one the person does not work, the team's alias as it is (it
//   carries the 💵 / ❌ marks), spent in all and in 30 days, subscribed or not.
// - «Похоже, это тот же человек»: each account Hub suggests, why, its pages, «Да, это он» / «Нет».
// - Facts by kind — «О себе», «Обещали», «Договорились» — each with its page and time; on a page the person works:
//   «Открыть чат» (another account's chat in this tab), «Исправить» in place, «Удалить». An empty kind says «не знаю»:
//   a deliberate exception to the panel's «what no source knows is not drawn» (the roadmap's rule for the facts).
// - «Кастомы» (products package R5: Workboard's orders, one implementation): the open first, the order's code beside
//   what it is, in Workboard's words — the step («У модели 2 д»), who has it now, the deadline (red when it passed);
//   «Отдан» when the board lets the person press it, «В Workboard ↗» — the order's card. «Записать кастом» and
//   «Спросить» open Workboard's own form and question window over the site, with the page and the fan filled in.

import { type JSX } from 'preact';
import { useState } from 'preact/hooks';

import { type FanCustomStepVM, type FanCustomVM, type FanMemoryCustomsVM, type FanMemoryFactVM, type FanMemoryPageVM, type FanMemoryVM, type I18n } from '@cg/contracts/vm';

import { chatClick, Button, ErrorCard, ViewState, useDispatch, useI18n } from '../kit';

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
      {fact.quote === null ? null : <FactQuote quote={fact.quote} />}
      {fact.mine ? (
        <div class="cg-fp__acts">
          {fact.open === null ? null : <Button label={i18n.t('common.openChat')} variant="quiet" onClick={(event) => void dispatch(chatClick(fact.open!, event))} />}
          {fact.correctable ? <Button label={i18n.t('fanPanel.memory.fix')} variant="quiet" reason={fact.busy ? i18n.t('common.loading') : null} onClick={() => setDraft(fact.text)} /> : null}
          {fact.remove === null ? null : <Button label={i18n.t('fanPanel.memory.delete')} variant="quiet" reason={fact.busy ? i18n.t('common.loading') : null} onClick={() => void dispatch(fact.remove!)} />}
        </div>
      ) : null}
    </div>
  );
}

/** The message a fact comes from, folded under it: «из чата» opens who wrote it, when, and its text. */
function FactQuote({ quote }: { readonly quote: NonNullable<FanMemoryFactVM['quote']> }): JSX.Element {
  const i18n = useI18n();
  const who = i18n.t(quote.fromFan ? 'fanPanel.memory.quote.fan' : 'fanPanel.memory.quote.model');
  const media = quote.media ? i18n.t('fanPanel.memory.quote.media') : null;
  return (
    <details class="cg-mem__quote" data-cg-quote="">
      <summary>{i18n.t('fanPanel.memory.quote.show')}</summary>
      <div class="cg-mem__quote-body">
        <div class="cg-mem__meta">{[who, i18n.formatTime(quote.at, 'datetime'), media].filter((part) => part !== null).join(' · ')}</div>
        {quote.text === '' ? null : <div class="cg-mem__quote-text">«{quote.text}»</div>}
      </div>
    </details>
  );
}

/** The order's real step as the hub names it, with how long it is on it («У модели 2 д»). */
export function customStepText(i18n: I18n, step: FanCustomStepVM): string {
  return step.at === null ? step.label : i18n.t('fanPanel.memory.custom.step', { step: step.label, age: i18n.formatAge(step.at) });
}

/**
 * Where the custom is: the hub's step when it names one; else, from an older hub, the four states — waiting for its
 * payment since it was written, paid since when, delivered when.
 */
function customState(i18n: I18n, custom: FanCustomVM): string {
  if (custom.step !== null) return customStepText(i18n, custom.step);
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
  const meta = [customState(i18n, custom), custom.leader === null ? null : i18n.t('fanPanel.memory.custom.leader', { name: custom.leader }), custom.price === null ? null : i18n.formatMoneyMills(custom.price), custom.pageLabel].filter((part) => part !== null).join(' · ');
  return (
    <div class={`cg-mem__custom is-${custom.state ?? 'unknown'}`} data-cg-custom={custom.id} aria-busy={custom.busy ? 'true' : 'false'}>
      <div class="cg-mem__text">
        {custom.code === null ? null : <span class="cg-mem__code cg-num">{custom.code}</span>}
        {custom.description}
      </div>
      <div class="cg-mem__meta">{meta}</div>
      {custom.deadline === null ? null : (
        <div class={`cg-mem__meta${custom.deadline.late ? ' is-late' : ''}`} data-cg-custom-deadline={custom.deadline.late ? 'late' : 'ok'}>
          {custom.deadline.text}
        </div>
      )}
      {custom.give === null && custom.open === null ? null : (
        <div class="cg-fp__acts">
          {custom.give === null ? null : <Button label={i18n.t('fanPanel.memory.custom.give')} variant="line" size="sm" reason={custom.busy ? i18n.t('common.loading') : null} onClick={() => void dispatch(custom.give!)} />}
          {custom.open === null ? null : <Button label={i18n.t('fanPanel.memory.custom.open')} variant="quiet" size="sm" onClick={() => void dispatch(custom.open!)} />}
        </div>
      )}
    </div>
  );
}

function Customs({ customs }: { readonly customs: FanMemoryCustomsVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const record = customs.record;
  return (
    <div class="cg-fp__sec" data-cg-customs="1">
      <div class="cg-fp__cap">{i18n.t('fanPanel.memory.customs')}</div>
      {customs.items.length === 0 ? <div class="cg-fp__none">{i18n.t('fanPanel.memory.custom.none')}</div> : customs.items.map((custom) => <CustomRow key={custom.id} custom={custom} />)}
      {record === null ? null : (
        <div class="cg-fp__acts" data-cg-custom-record="1">
          <Button label={i18n.t('fanPanel.memory.custom.record')} variant="line" onClick={() => void dispatch(record.record)} />
          <Button label={i18n.t('fanPanel.memory.custom.ask')} variant="line" onClick={() => void dispatch(record.ask)} />
        </div>
      )}
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
.cg-mem__custom > .cg-fp__acts { margin-left: -6px; }
.cg-mem__custom.is-delivered .cg-mem__text, .cg-mem__custom.is-cancelled .cg-mem__text { color: var(--cg-ink-2); }
.cg-mem__code { margin-right: 6px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-mem__meta.is-late { color: var(--cg-bad-ink); }
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
.cg-mem__quote { margin-top: 2px; }
.cg-mem__quote summary { cursor: pointer; list-style: none; width: fit-content; font-size: var(--cg-text-sm); color: var(--cg-ink-2); text-decoration: underline dotted; text-decoration-color: var(--cg-ink-faint); text-underline-offset: 3px; }
.cg-mem__quote summary::-webkit-details-marker { display: none; }
.cg-mem__quote-body { margin-top: 4px; padding: 4px 0 4px 8px; border-left: 2px solid var(--cg-rule-3); }
.cg-mem__quote-text { font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-2); overflow-wrap: anywhere; white-space: pre-wrap; }
.cg-mem__fix { box-sizing: border-box; width: 100%; min-height: 60px; resize: vertical; font: inherit; color: var(--cg-ink); background: var(--cg-raised); border: 1px solid var(--cg-rule-3); border-radius: var(--cg-r-md); padding: 6px 8px; }
`;
