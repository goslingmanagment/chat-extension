// Renders the Markdown AST with Preact elements only (no innerHTML, gates
// §14): text is escaped by Preact, links are https only and open in a new tab
// with `rel="noopener noreferrer"`. The source is parsed once per text.

import { type JSX } from 'preact';
import { useMemo } from 'preact/hooks';

import { parseMarkdown, type MdBlock, type MdInline } from './parse';

function Inline({ nodes }: { readonly nodes: readonly MdInline[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.t) {
          case 'text':
            return node.v;
          case 'br':
            return <br key={index} />;
          case 'strong':
            return (
              <strong key={index}>
                <Inline nodes={node.c} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <Inline nodes={node.c} />
              </em>
            );
          case 'code':
            return <code key={index}>{node.v}</code>;
          case 'link':
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <Inline nodes={node.c} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ node }: { readonly node: MdBlock }): JSX.Element {
  switch (node.t) {
    case 'p':
      return (
        <p>
          <Inline nodes={node.c} />
        </p>
      );
    case 'h': {
      const Tag = node.level === 1 ? 'h3' : node.level === 2 ? 'h4' : 'h5';
      return (
        <Tag>
          <Inline nodes={node.c} />
        </Tag>
      );
    }
    case 'ul':
      return (
        <ul>
          {node.items.map((item, index) => (
            <li key={index}>
              <Blocks nodes={item} />
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol start={node.start}>
          {node.items.map((item, index) => (
            <li key={index}>
              <Blocks nodes={item} />
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
          <Blocks nodes={node.c} />
        </blockquote>
      );
    case 'hr':
      return <hr />;
  }
}

function Blocks({ nodes }: { readonly nodes: readonly MdBlock[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => (
        <Block key={index} node={node} />
      ))}
    </>
  );
}

export interface MarkdownProps {
  /** The finished text; parsed once per value. */
  readonly source: string;
  readonly class?: string;
}

export function Markdown({ source, class: extra }: MarkdownProps): JSX.Element {
  const ast = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div class={`cg-md${extra === undefined ? '' : ` ${extra}`}`}>
      <Blocks nodes={ast} />
    </div>
  );
}

/** For an AST the caller already holds. */
export function MarkdownView({ ast, class: extra }: { readonly ast: readonly MdBlock[]; readonly class?: string }): JSX.Element {
  return (
    <div class={`cg-md${extra === undefined ? '' : ` ${extra}`}`}>
      <Blocks nodes={ast} />
    </div>
  );
}

export const MARKDOWN_CSS = `
.cg-md { font-size: var(--cg-text-lg); line-height: 21px; color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-md > * + * { margin-top: 8px; }
.cg-md p, .cg-md li { max-width: 72ch; }
.cg-md p, .cg-md h3, .cg-md h4, .cg-md h5, .cg-md ul, .cg-md ol, .cg-md pre, .cg-md blockquote { margin-bottom: 0; }
.cg-md h3, .cg-md h4, .cg-md h5 { margin: 12px 0 0; font-size: var(--cg-text-base); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-md > h3:first-child, .cg-md > h4:first-child, .cg-md > h5:first-child { margin-top: 0; }
.cg-md ul, .cg-md ol { margin-top: 8px; padding-left: 20px; }
.cg-md li + li { margin-top: 2px; }
.cg-md li > * + * { margin-top: 4px; }
.cg-md strong { font-weight: 600; color: var(--cg-ink-strong); }
.cg-md em { font-style: normal; font-weight: 500; }
.cg-md code { font-family: var(--cg-mono); font-size: 0.86em; padding: 0 3px; border-radius: var(--cg-r-xs); background: var(--cg-sunk); }
.cg-md pre { padding: 8px 10px; border-radius: var(--cg-r-md); background: var(--cg-sunk); overflow-x: auto; white-space: pre; }
.cg-md pre code { padding: 0; background: none; font-size: var(--cg-text-xs); line-height: 16px; }
.cg-md blockquote { margin: 8px 0 0; padding-left: 10px; border-left: 1px solid var(--cg-rule-3); color: var(--cg-ink-2); }
.cg-md hr { border: 0; border-top: 1px solid var(--cg-rule); margin: 12px 0 0; }
.cg-md a { color: inherit; text-decoration: underline; text-decoration-color: var(--cg-rule-3); text-underline-offset: 2px; }
.cg-md a:hover { text-decoration-color: currentColor; }
`;
