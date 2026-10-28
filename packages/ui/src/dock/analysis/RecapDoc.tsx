// The Recap's document in its window (2026-10-28, the owner's pick «Досье во весь экран»): the sections under headings
// that catch the eye (a tinted tile, the name in 21 px), the labels of «Имя: …» in a column of their own, a run of
// dated lines as a timeline, the fan's words as pull quotes, the stage and the spender's class on their scales, the sum
// large. The text is the model's: rendered from the safe inline Markdown AST, the fan's words and the sums marked.

import { type ComponentChildren, type JSX } from 'preact';
import { useMemo } from 'preact/hooks';

import { type RecapDocVM, type RecapLineVM, type RecapPartVM, type RecapScaleVM, type RecapSectionKey, type RecapSectionVM, type RecapTone } from '@cg/contracts/vm';

import { Icon, decorateText, parseInline, useI18n, type IconName, type MdInline } from '../../kit';

/** A section's tile: its icon, and its tint by what it is about (money green, open loops amber, what to do terracotta). */
const SECTION_ICON: Readonly<Record<RecapSectionKey, IconName>> = {
  dossier: 'dossier',
  portrait: 'heart',
  stage: 'trend',
  communication: 'bubble',
  money: 'cash',
  openLoops: 'loop',
  strategy: 'target',
  who: 'person',
  spend: 'cash',
  triggers: 'bolt',
  boundaries: 'shield',
  threads: 'loop',
  nextMove: 'arrowRight',
};
const SECTION_TINT: Partial<Readonly<Record<RecapSectionKey, 'good' | 'amber' | 'clay' | 'bad'>>> = {
  money: 'good',
  spend: 'good',
  openLoops: 'amber',
  threads: 'amber',
  strategy: 'clay',
  nextMove: 'clay',
  boundaries: 'bad',
};

export function Tile({ section, size = 16 }: { readonly section: RecapSectionKey | null; readonly size?: 13 | 14 | 16 }): JSX.Element {
  const tint = section === null ? 'n' : (SECTION_TINT[section] ?? 'n');
  return (
    <span class={`cg-rx-tile t-${tint}`} aria-hidden="true">
      <Icon name={section === null ? 'lines' : SECTION_ICON[section]} size={size} />
    </span>
  );
}

const capitalize = (text: string): string => text.replace(/^(\s*)(\p{Ll})/u, (_, space: string, letter: string) => space + letter.toUpperCase());

/** The fan's words in their own quotes: English set in italics with “ ”, Russian upright with « ». */
function Quote({ text }: { readonly text: string }): JSX.Element {
  const inner = text.replace(/^["“«]|["”»]$/gu, '');
  const ru = /[а-яё]/iu.test(inner);
  return <q class={ru ? 'cg-rx-q is-ru' : 'cg-rx-q'}>{inner}</q>;
}

function Decorated({ text }: { readonly text: string }): JSX.Element {
  return (
    <>
      {decorateText(text).map((piece, index) =>
        typeof piece === 'string' ? (
          piece
        ) : piece.kind === 'money' ? (
          <span key={index} class="cg-rx-money">
            {piece.text}
          </span>
        ) : (
          <Quote key={index} text={piece.text} />
        ),
      )}
    </>
  );
}

function Nodes({ nodes }: { readonly nodes: readonly MdInline[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.t) {
          case 'text':
            return <Decorated key={index} text={node.v} />;
          case 'br':
            return <br key={index} />;
          case 'strong':
            return (
              <strong key={index}>
                <Nodes nodes={node.c} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Nodes nodes={node.c} />
              </em>
            );
          case 'code':
            return <code key={index}>{node.v}</code>;
          case 'link':
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <Nodes nodes={node.c} />
              </a>
            );
        }
      })}
    </>
  );
}

/** A line of the model's text: inline Markdown, the fan's words and the sums marked. */
export function RecapInline({ text, upper = false }: { readonly text: string; readonly upper?: boolean }): JSX.Element {
  const nodes = useMemo(() => parseInline(upper ? capitalize(text) : text), [text, upper]);
  return <Nodes nodes={nodes} />;
}

function Mark({ tone }: { readonly tone: RecapTone }): JSX.Element | null {
  if (tone === null) return null;
  return (
    <span class="cg-rx-mark" aria-hidden="true">
      <Icon name={tone === 'avoid' ? 'x' : 'arrowRight'} size={12} />
    </span>
  );
}

function Scale({ scale }: { readonly scale: RecapScaleVM }): JSX.Element {
  const i18n = useI18n();
  const step = scale.steps[scale.at] ?? '';
  return (
    <div
      class={`cg-rx-meter${scale.kind === 'spend' ? ' is-good' : ''}`}
      style={`--cg-rx-n: ${String(scale.steps.length)}`}
      role="img"
      aria-label={i18n.t(scale.kind === 'stage' ? 'recap.win.stage' : 'recap.win.spend', { step })}
    >
      {scale.steps.map((name, index) => (
        <span key={name} class={`cg-rx-meter__s${index === scale.at ? ' is-on' : scale.lean.includes(index) ? ' is-lean' : index < scale.at ? ' is-past' : ''}`}>
          {name}
        </span>
      ))}
    </div>
  );
}

function Line({ item }: { readonly item: RecapLineVM }): JSX.Element {
  if (item.label === null) return <RecapInline text={item.text} upper />;
  return (
    <>
      <span class="cg-rx-il">
        {capitalize(item.label)}
        {item.note === null ? '' : ` (${item.note})`}:
      </span>{' '}
      <RecapInline text={item.text} />
    </>
  );
}

function Body({ part }: { readonly part: RecapPartVM }): JSX.Element {
  if (part.kind === 'text') {
    return (
      <>
        {part.figure === null ? null : (
          <div class="cg-rx-fig">
            <span class="cg-rx-fig__n">{part.figure.sum}</span>
            {part.figure.period === null ? null : <span class="cg-rx-fig__c">{part.figure.period}</span>}
          </div>
        )}
        {part.scale === null ? null : <Scale scale={part.scale} />}
        <p>
          <RecapInline text={part.text} upper />
        </p>
      </>
    );
  }
  if (part.look === 'quotes') {
    return (
      <ul class="cg-rx-quotes">
        {part.items.map((item, index) => (
          <li key={index} class={item.quoted === true ? 'cg-rx-pq' : 'cg-rx-pq is-plain'}>
            <RecapInline text={item.text} />
          </li>
        ))}
      </ul>
    );
  }
  if (part.look === 'timeline') {
    return (
      <ol class="cg-rx-tl">
        {part.items.map((item, index) => (
          <li key={index}>
            {item.label === null ? null : (
              <span class="cg-rx-tl__d">
                {capitalize(item.label)}
                {item.note === null ? '' : ` (${item.note})`}
              </span>
            )}
            <span class="cg-rx-tl__t">
              <RecapInline text={item.text} upper />
            </span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul class={`cg-rx-list${part.tone === null ? '' : ` is-${part.tone}`}`}>
      {part.items.map((item, index) => (
        <li key={index}>
          <Line item={item} />
        </li>
      ))}
    </ul>
  );
}

function Part({ part, grid }: { readonly part: RecapPartVM; readonly grid: boolean }): JSX.Element {
  const tone = part.tone === null ? '' : ` is-${part.tone}`;
  const label =
    part.label === null ? null : (
      <>
        <Mark tone={part.tone} />
        {capitalize(part.label)}
      </>
    );
  if (grid) {
    return (
      <>
        <div class={`cg-rx-l${tone}`}>
          {label}
          {part.note === null ? null : <small>{part.note}</small>}
        </div>
        <div class="cg-rx-v">
          <Body part={part} />
        </div>
      </>
    );
  }
  return (
    <div class="cg-rx-p">
      {label === null ? null : (
        <div class={`cg-rx-fl${tone}`}>
          {label}
          {part.note === null ? null : <small> ({part.note})</small>}
        </div>
      )}
      <div class="cg-rx-v">
        <Body part={part} />
      </div>
    </div>
  );
}

export function Section({ section, index, grid, children }: { readonly section: RecapSectionVM; readonly index: number; readonly grid: boolean; readonly children?: ComponentChildren }): JSX.Element {
  const id = `cg-rx-sec-${index}`;
  return (
    <section class="cg-rx-sec" data-cg-sec={index} {...(section.name === '' ? {} : { 'aria-labelledby': id })}>
      {section.name === '' ? null : (
        <h3 class="cg-rx-h" id={id}>
          <Tile section={section.key} />
          <span>{section.name}</span>
        </h3>
      )}
      <div class={grid ? 'cg-rx-grid' : 'cg-rx-flow'}>
        {section.parts.map((part, at) => (
          <Part key={at} part={part} grid={grid} />
        ))}
      </div>
      {children}
    </section>
  );
}

/** The sections of a Recap, in order. `writing` — a build streams into it: the next section is being written. */
export function RecapSections({ doc, writing }: { readonly doc: Pick<RecapDocVM, 'sections' | 'labelled'>; readonly writing?: { readonly key: RecapSectionKey | null; readonly name: string } | null }): JSX.Element {
  return (
    <>
      {doc.sections.map((section, index) => (
        <Section key={`${index}:${section.name}`} section={section} index={index} grid={doc.labelled} />
      ))}
      {writing === undefined || writing === null ? null : (
        <section class="cg-rx-sec is-writing" aria-busy="true">
          <h3 class="cg-rx-h">
            <Tile section={writing.key} />
            <span>{writing.name}</span>
          </h3>
          <div class={`cg-rx-skel${doc.labelled ? ' is-grid' : ''}`} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </section>
      )}
    </>
  );
}
