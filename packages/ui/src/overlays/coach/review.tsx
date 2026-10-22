// A Review as the answer of its turn in Coach's dialog (1.51.0; ui-design §4.11, §4.19; AI-050…AI-054): the old
// Review window's card, a little more compact for the thread — the score's badge with «REVIEW» and the Review's age by
// it, «Копировать Review» and «Ещё раз» at its right, then the blocks of parity AI-053 in the hub's format in a dashed
// document: «Вердикт / Деньги / Персона / Ошибки» with «Как надо было», «Что сработало», the recommendations. An
// example is shown, never inserted: a Review is no message to the fan.

import { type JSX } from 'preact';

import { type ActionButtonVM, type CoachReviewVM, type ReviewSectionVM } from '@cg/contracts/vm';

import { Markdown, useDispatch, useI18n } from '../../kit';
import { Block, CopyAll, MadeAgo, Score, type BlockTone } from '../../dock/analysis/shared';
import { AgainButton } from '../../dock/Head';

/** The old client's colour of each block: the verdict and the advice terracotta, money and what works green, the persona amber, mistakes red. */
const TONE: Readonly<Record<ReviewSectionVM['kind'], BlockTone>> = {
  verdict: 'clay',
  money: 'good',
  persona: 'amber',
  mistakes: 'bad',
  works: 'good',
  recommendations: 'clay',
};

function Section({ section }: { readonly section: ReviewSectionVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <Block title={i18n.text(section.title)} tone={TONE[section.kind]} tinted={section.kind === 'verdict' || section.kind === 'works'} kind={section.kind}>
      {section.body === '' ? null : <Markdown source={section.body} decorate />}
      {section.items.length === 0 ? null : (
        <ol class="cg-ritems">
          {section.items.map((item, index) => (
            <li key={index} class="cg-rv-item">
              <span class="cg-rv-item__n" aria-hidden="true">
                {index + 1}.
              </span>
              <div class="cg-rv-item__b">
                <Markdown source={item.body} decorate />
                {item.example === null ? null : (
                  <div class="cg-rv-ex">
                    <div class="cg-rv-ex__k">
                      {i18n.t('review.example')}
                      {item.exampleWhere === null ? null : <span class="cg-rv-where"> · {item.exampleWhere}</span>}
                    </div>
                    <div class="cg-rv-ex__t">{item.example}</div>
                  </div>
                )}
                {item.afterExample === null ? null : <Markdown source={item.afterExample} decorate />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

/** The card; `again` — the turn's «Ещё раз» (a new Review as the next turn), null — none here. */
export function ReviewCard({ review, again }: { readonly review: CoachReviewVM; readonly again: ActionButtonVM | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  // The lead repeats the verdict in the hub's format: shown on its own only when no block carries it.
  const lead = review.lead !== null && !review.sections.some((section) => section.body === review.lead) ? review.lead : null;
  return (
    <div class="cg-co__review" data-cg-review>
      <div class="cg-co__review-head">
        {review.rating === null ? null : <Score rating={review.rating} size="lg" />}
        <div class="cg-co__review-t">
          <span class="cg-co__review-k">{i18n.t('coach.chip.review')}</span>
          <span class="cg-co__review-age">
            <MadeAgo at={review.generatedAt} />
            {/* Only what is wrong: an incomplete archive. */}
            {review.partial ? ` · ${i18n.t('common.coverage.partial')}` : null}
          </span>
        </div>
        <span class="cg-co__review-acts">
          <CopyAll handle={review.copyHandle} label={i18n.t('review.copy')} />
          {again === null ? null : (
            <AgainButton
              label={i18n.text(again.label)}
              hotkey={null}
              tooltip={i18n.t('review.againTooltip')}
              reason={again.enabled ? null : again.reason === null ? i18n.t('common.unknown') : i18n.text(again.reason.text)}
              onClick={() => void dispatch(again.action)}
            />
          )}
        </span>
      </div>
      <div class="cg-doc">
        {review.unparsed || review.sections.length === 0 ? (
          <div class="cg-raw">{review.raw}</div>
        ) : (
          <>
            {lead === null ? null : <Markdown source={lead} decorate />}
            {review.sections.map((section, index) => (
              <Section key={index} section={section} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** The card's place in the thread: as wide as the drafts, the document a little tighter than the old window's. */
export const REVIEW_TURN_CSS = `
.cg-co__a > .cg-co__review { align-self: stretch; max-width: none; }
.cg-co__review { display: grid; gap: 8px; min-width: 0; }
.cg-co__review-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cg-co__review .cg-score--lg { width: 44px; height: 44px; font-size: 22px; line-height: 22px; }
.cg-co__review-t { display: grid; gap: 1px; min-width: 0; margin-right: auto; }
.cg-co__review-k { font-family: var(--cg-mono); font-size: 10px; line-height: 14px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cg-clay-ink); }
.cg-co__review-age { font-size: var(--cg-text-sm); line-height: 18px; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-co__review-acts { display: flex; align-items: center; gap: 2px; flex: none; }
.cg-co__review .cg-doc { margin: 0; padding: 12px 14px 14px; gap: 12px; }
.cg-co__review .cg-rsec.is-tinted { padding: 10px 12px 11px; }
.cg-co__review .cg-rsec + .cg-rsec:not(.is-tinted) { padding-top: 11px; }
.cg-co__q .cg-co__bubble.is-review { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.cg-co__q .cg-co__bubble.is-review .cg-ico { color: var(--cg-clay-ink); }
.cg-co__chip.is-review .cg-ico { color: var(--cg-clay-ink); }
.cg-co__chip.is-review[aria-disabled="true"] .cg-ico { color: inherit; }
@container cg (max-width: 560px) {
  .cg-co__review .cg-doc { padding: 10px 10px 12px; }
}
`;
