// Renders the Markdown AST with Preact elements only (no innerHTML, gates
// §14): text is escaped by Preact, links are https only and open in a new tab
// with `rel="noopener noreferrer"`. The source is parsed once per text.
// `decorate` (Recap and Review, as the old Fansly client's analysis-blocks.ts
// did) sets the sums in mono and the quotes of the chat in terracotta.

import { type JSX } from 'preact';
import { useMemo } from 'preact/hooks';

import { parseMarkdown, type MdBlock, type MdInline } from './parse';

/**
 * A quote of the chat ("…" or “…”) or a sum ($25, $12.50, $30/мес): the old client's INLINE_DECOR_RE. A sum inside a
 * quote stays part of the quote (the earliest match wins).
 */
const DECOR = /("[^"\n]{2,200}"|“[^”\n]{2,200}”)|(\$\d+(?:[.,]\d+)?(?:\/[а-яёa-z]+)?)/giu;

export type DecoratedPiece = string | { readonly kind: 'quote' | 'money'; readonly text: string };

/** A text node cut into plain runs, quotes and sums. */
export function decorateText(text: string): DecoratedPiece[] {
  const pieces: DecoratedPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(DECOR)) {
    const index = match.index;
    if (index > last) pieces.push(text.slice(last, index));
    pieces.push({ kind: match[1] === undefined ? 'money' : 'quote', text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) pieces.push(text.slice(last));
  return pieces;
}

function Decorated({ text }: { readonly text: string }): JSX.Element {
  return (
    <>
      {decorateText(text).map((piece, index) =>
        typeof piece === 'string' ? (
          piece
        ) : (
          <span key={index} class={piece.kind === 'money' ? 'cg-money' : 'cg-quote'}>
            {piece.text}
          </span>
        ),
      )}
    </>
  );
}

function Inline({ nodes, decorate }: { readonly nodes: readonly MdInline[]; readonly decorate: boolean }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.t) {
          case 'text':
            return decorate ? <Decorated key={index} text={node.v} /> : node.v;
          case 'br':
            return <br key={index} />;
          case 'strong':
            return (
              <strong key={index}>
                <Inline nodes={node.c} decorate={decorate} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Inline nodes={node.c} decorate={decorate} />
              </em>
            );
          case 'code':
            return <code key={index}>{node.v}</code>;
          case 'link':
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <Inline nodes={node.c} decorate={false} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ node, decorate }: { readonly node: MdBlock; readonly decorate: boolean }): JSX.Element {
  switch (node.t) {
    case 'p':
      return (
        <p>
          <Inline nodes={node.c} decorate={decorate} />
        </p>
      );
    case 'h': {
      const Tag = node.level === 1 ? 'h3' : node.level === 2 ? 'h4' : 'h5';
      return (
        <Tag>
          <Inline nodes={node.c} decorate={decorate} />
        </Tag>
      );
    }
    case 'ul':
      return (
        <ul>
          {node.items.map((item, index) => (
            <li key={index}>
              <Blocks nodes={item} decorate={decorate} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol start={node.start}>
          {node.items.map((item, index) => (
            <li key={index}>
              <Blocks nodes={item} decorate={decorate} />
            </li>
          ))}
        </ol>
      );
    case 'pre':
      return (
        <pre>
          <code>{node.v}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote>
          <Blocks nodes={node.c} decorate={decorate} />
        </blockquote>
      );
    case 'hr':
      return <hr />;
  }
}

function Blocks({ nodes, decorate }: { readonly nodes: readonly MdBlock[]; readonly decorate: boolean }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => (
        <Block key={index} node={node} decorate={decorate} />
      ))}
    </>
  );
}

export interface MarkdownProps {
  /** The finished text; parsed once per value. */
  readonly source: string;
  readonly class?: string;
  /** Sums in mono and the chat's quotes in terracotta (`.cg-money`, `.cg-quote`): Recap and Review. */
  readonly decorate?: boolean;
}

export function Markdown({ source, class: extra, decorate = false }: MarkdownProps): JSX.Element {
  const ast = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div class={`cg-md${extra === undefined ? '' : ` ${extra}`}`}>
      <Blocks nodes={ast} decorate={decorate} />
    </div>
  );
}

/** For an AST the caller already holds. */
export function MarkdownView({ ast, class: extra }: { readonly ast: readonly MdBlock[]; readonly class?: string }): JSX.Element {
  return (
    <div class={`cg-md${extra === undefined ? '' : ` ${extra}`}`}>
      <Blocks nodes={ast} decorate={false} />
    </div>
  );
}

export { MARKDOWN_CSS } from './markdown.css';
