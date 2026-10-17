// Review in the dock sheet (ui-design §4.11, §12 п. 6; AI-050…AI-054): the
// N/10 score, the window it looked at («последние 40 сообщений с Hubert»),
// and the blocks of parity AI-053 in the hub's format — «Вердикт / Деньги /
// Персона / Ошибки» with «Как надо было», then the recommendations. An
// example is shown, never inserted: Review is not a message to the fan.

import { type JSX } from 'preact';

import { type ReviewSectionVM } from '@cg/contracts/vm';

import { Markdown, Spinner, ViewState, useDispatch, useI18n, useView } from '../../kit';
import { spokenStage, useReadyAnnouncement, useStageAnnouncements } from '../announce';
import { AgainButton, Head, Meta } from '../Head';
import { StaleRow } from '../Result';
import { useSteadyView, useStreamText } from '../Stream';
import { Close, CopyAll, Expand, Fact, Facts, Running, debugFooter, running, type ViewProps } from './shared';

function Section({ section }: { readonly section: ReviewSectionVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-block" data-cg-section={section.kind}>
      <b>{i18n.text(section.title)}</b>
      <div class="cg-block__main">
        {section.body === '' ? null : <Markdown source={section.body} />}
        {section.items.map((item, index) => (
          <div key={index} class="cg-rv-item">
            <Markdown source={item.body} />
            {item.example === null ? null : (
              <div class="cg-rv-ex">
                <div class="cg-cap">
                  {i18n.t('review.example')}
                  {item.exampleWhere === null ? null : <span class="cg-rv-where"> · {item.exampleWhere}</span>}
                </div>
                <div class="cg-rv-ex__t">{item.example}</div>
              </div>
            )}
            {item.afterExample === null ? null : <Markdown source={item.afterExample} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewView({ place, debugPart }: ViewProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const raw = useView({ of: 'review' });
  const review = useSteadyView(raw).value;
  const text = useStreamText(raw, (view) => view.streamText);
  const title = i18n.t('dock.action.review');
  const close = <Close which="review" place={place} />;

  const debug = debugFooter(debugPart, review.debug, review.state, review.phase);
  // The live region: the stages while it is written, then «Review: сделан только что». The sheet says it; the window stays quiet.
  const said = place === 'sheet' ? (review.opId ?? 'review') : null;
  useStageAnnouncements(title, running(review.state) ? said : null, review.phase);
  useReadyAnnouncement(place === 'sheet' ? 'review' : null, running(review.state), review.sections.length > 0 || review.raw !== null, () => spokenStage(i18n, title, i18n.t('review.madeNow')));

  // In the «Развернуть ↗» window (X55: where a Review opens) the sheet keeps only its head: the text is read once, up there.
  if (place === 'sheet' && review.expanded) {
    return (
      <Head title={title} gutter={running(review.state) ? <Spinner /> : null} acts={close}>
        {review.rating === null ? null : (
          <span class="cg-head__score" data-cg-score={review.rating}>
            {review.rating}
            <span>/10</span>
          </span>
        )}
        <Meta texts={review.meta.map((line) => i18n.text(line))} />
      </Head>
    );
  }

  if (running(review.state)) return <Running title={title} opId={review.opId} phase={review.phase} text={text} debug={debug} />;

  const hasText = review.sections.length > 0 || review.raw !== null;
  if (!hasText) {
    return (
      <>
        <Head title={title} acts={close}>
          <Meta texts={review.view.s === 'error' ? [i18n.t('result.meta.failed')] : []} />
        </Head>
        <div class="cg-body">
          <ViewState view={review.view} />
        </div>
        {debug}
      </>
    );
  }

  const again = review.regenerate;
  const againReason = again.enabled ? null : again.reason === null ? i18n.t('common.unknown') : i18n.text(again.reason.text);
  const mark = review.stale ?? null;
  // The lead repeats the verdict in the hub's format: shown on its own only when no block carries it.
  const lead = review.lead !== null && !review.sections.some((section) => section.body === review.lead) ? review.lead : null;
  const coverage = review.stamp.coverage;
  return (
    <>
      <Head
        title={title}
        tools
        acts={
          <>
            <CopyAll handle={review.copyHandle} label={i18n.t('review.copy')} />
            <Expand which="review" place={place} />
            <AgainButton
              label={i18n.text(again.label)}
              hotkey={again.hotkey}
              tooltip={i18n.t('review.againTooltip')}
              reason={againReason}
              onClick={() => void dispatch(again.action)}
            />
            {close}
          </>
        }
      >
        {review.rating === null ? null : (
          <span class="cg-head__score" data-cg-score={review.rating}>
            {review.rating}
            <span>/10</span>
          </span>
        )}
        <Meta texts={review.meta.map((line) => i18n.text(line))} />
      </Head>
      <div class="cg-body">
        {/* The site's verdict over the Review (R20 P8c): «Ещё раз» rates the chat anew. */}
        {mark === null ? null : <StaleRow mark={mark} onAgain={() => void dispatch(again.action)} reason={againReason} />}
        {review.unparsed || review.sections.length === 0 ? (
          <div class="cg-prose">
            <span />
            <div class="cg-raw">{review.raw}</div>
          </div>
        ) : (
          <>
            {lead === null ? null : (
              <div class="cg-prose">
                <span />
                <Markdown source={lead} />
              </div>
            )}
            <div class="cg-blocks">
              {review.sections.map((section, index) => (
                <Section key={index} section={section} />
              ))}
            </div>
          </>
        )}
      </div>
      <Facts>
        {review.facts.map((fact, index) => (
          <Fact key={index}>{i18n.text(fact)}</Fact>
        ))}
        {coverage === 'complete' ? null : <Fact>{i18n.t(coverage === 'partial' ? 'common.coverage.partial' : 'common.coverage.unknown')}</Fact>}
      </Facts>
      {debug}
    </>
  );
}
