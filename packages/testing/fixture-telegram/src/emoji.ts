// Emoji as Web A shows them (telegram-tt components/common/helpers/renderText.tsx): each emoji of a text is an
// `<img class="emoji" alt="😘">`, its picture Apple's set — here a picture drawn from the system's emoji font into a
// `data:` PNG, so the stand loads nothing from the network. What a reader of the text gets back is the `alt`.

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const pictures = new Map<string, string>();

/** A PNG of one emoji, `size` CSS pixels at twice the pixels (sharp on a 2× picture). */
export function emojiPicture(emoji: string, size = 20): string {
  const key = `${emoji}@${size}`;
  const known = pictures.get(key);
  if (known !== undefined) return known;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.scale(scale, scale);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${Math.round(size * 0.86)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    context.fillText(emoji, size / 2, size / 2 + size * 0.06);
  }
  const url = canvas.toDataURL('image/png');
  pictures.set(key, url);
  return url;
}

export function isEmoji(grapheme: string): boolean {
  return PICTOGRAPHIC.test(grapheme);
}

/** An `img.emoji` as renderText makes it. */
export function emojiImage(emoji: string, className = 'emoji'): HTMLImageElement {
  const image = document.createElement('img');
  image.className = className;
  image.src = emojiPicture(emoji);
  image.alt = emoji;
  image.draggable = false;
  return image;
}

/** A text as Web A renders it: runs of text as text nodes, each emoji as its image. */
export function renderText(text: string): Node[] {
  const nodes: Node[] = [];
  let run = '';
  for (const { segment } of segmenter.segment(text)) {
    if (!isEmoji(segment)) {
      run += segment;
      continue;
    }
    if (run !== '') nodes.push(document.createTextNode(run));
    run = '';
    nodes.push(emojiImage(segment));
  }
  if (run !== '') nodes.push(document.createTextNode(run));
  return nodes;
}
