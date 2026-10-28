// A small element builder: the stand draws Web A's markup by hand, without a framework.

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | undefined>> = {}, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

/** Class names joined as Web A's `buildClassName` does: falsy parts dropped. */
export const cn = (...parts: ReadonlyArray<string | false | null | undefined>): string => parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');

/** An inline SVG icon (Web A draws its icons with a font; the stand's are paths, so nothing loads). */
export function svgIcon(path: string, size = 24, className = 'stand-svg'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  shape.setAttribute('fill', 'currentColor');
  svg.append(shape);
  return svg;
}

/** Material-style icon paths for the stand's buttons. */
export const ICONS = {
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  more: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  phone: 'M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02z',
  smile: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m3.5-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m-7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3m3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5',
  attach: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z',
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72z',
  play: 'M8 5v14l11-7z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  callIn: 'M20 5.41 18.59 4 7 15.59V9H5v10h10v-2H8.41z',
} as const;

/** A picture for a photo, a video's frame or an avatar: a soft gradient landscape, drawn as a `data:` SVG. */
export function scenery(seed: number, width = 320, height = 240): string {
  const palettes = [
    ['#f6d365', '#fda085', '#7ec8e3'],
    ['#a1c4fd', '#c2e9fb', '#4f9d69'],
    ['#fbc2eb', '#a6c1ee', '#5b7db1'],
    ['#84fab0', '#8fd3f4', '#3b6e8f'],
  ];
  const [sky = '#a1c4fd', glow = '#c2e9fb', land = '#4f9d69'] = palettes[seed % palettes.length] ?? [];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${glow}"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<circle cx="${width * 0.72}" cy="${height * 0.32}" r="${height * 0.12}" fill="#fff" opacity=".75"/>` +
    `<path d="M0 ${height * 0.72} Q ${width * 0.25} ${height * 0.5} ${width * 0.5} ${height * 0.68} T ${width} ${height * 0.62} V ${height} H 0 Z" fill="${land}" opacity=".85"/>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
