// Placeholder for the extension pages (popup, options, debug). R16 builds the
// real pages from scratch; R00 only proves Preact renders in each of them.

export interface PlaceholderProps {
  readonly title: string;
  readonly lines: readonly string[];
}

export function PagePlaceholder({ title, lines }: PlaceholderProps) {
  return (
    <main class="cg-page">
      <h1>{title}</h1>
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </main>
  );
}
