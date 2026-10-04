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

export { MARKDOWN_CSS } from './markdown.css';
