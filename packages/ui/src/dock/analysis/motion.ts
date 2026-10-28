// The Recap window's motion (2026-10-28, the owner: «анимации можно попробовать допилить»): one memorable move — the
// window grows out of the button it was opened from and folds back into the bar — and quiet springs for the rest (the
// contents marker, the length switch). A spring is simulated once into points: WAAPI plays them as linear keyframes,
// CSS transitions as `linear()`. With reduced motion everything is a short fade.

/** A spring from 0 to 1, sampled at 60 frames a second, and how long it takes to settle. */
export interface Spring {
  readonly points: readonly number[];
  readonly ms: number;
}

export function spring(stiffness: number, damping: number): Spring {
  let x = 0;
  let v = 0;
  const points = [0];
  const steps = 8;
  const dt = 1 / 60 / steps;
  for (let frame = 1; frame < 240; frame++) {
    for (let step = 0; step < steps; step++) {
      const a = -stiffness * (x - 1) - damping * v;
      v += a * dt;
      x += v * dt;
    }
    points.push(x);
    if (frame > 10 && Math.abs(1 - x) < 0.0015 && Math.abs(v) < 0.015) break;
  }
  points[points.length - 1] = 1;
  return { points, ms: Math.round(((points.length - 1) * 1000) / 60) };
}

/** The window growing out of its button. */
export const SPRING_OPEN = spring(250, 25.5);
/** The window folding into the cheat sheet over the bar. */
export const SPRING_FOLD = spring(320, 34);
/** The contents marker and the length switch. */
export const SPRING_UI = spring(380, 30);

/** The content waits until the paper is nearly in place, so nothing shows outside it. */
export const LAND_MS = Math.max(140, Math.round((SPRING_OPEN.points.findIndex((point) => point >= 0.985) * 1000) / 60) - 20);

export const EASE_OUT = 'cubic-bezier(.2, .7, .3, 1)';

/** `linear(…)` of the UI spring for CSS transitions, where the engine has it; else a soft ease. */
export function springEasing(supports: (property: string, value: string) => boolean): { readonly easing: string; readonly ms: number } {
  if (!supports('transition-timing-function', 'linear(0, 1)')) return { easing: 'cubic-bezier(.3, 1.25, .5, 1)', ms: 460 };
  const every = Math.max(1, Math.ceil(SPRING_UI.points.length / 40));
  const points = SPRING_UI.points.filter((_, index) => index % every === 0 || index === SPRING_UI.points.length - 1);
  return { easing: `linear(${points.map((point) => +point.toFixed(4)).join(', ')})`, ms: SPRING_UI.ms };
}

/** An ease in and out, as points. */
export function inOutCurve(frames = 24): number[] {
  return Array.from({ length: frames + 1 }, (_, index) => {
    const t = index / frames;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  });
}

const msOf = (points: readonly number[]): number => Math.round(((points.length - 1) * 1000) / 60);

/**
 * Keyframes that carry an element whose box is `base` from the rect `from` to the rect `to` along `curve`, by transform
 * alone (origin 0 0); the corner radius is kept round while the box scales.
 */
/** A box on the page, in CSS pixels (a DOMRect, or one worked out). */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function morphFrames(base: Box, from: Box, to: Box, curve: readonly number[], radiusFrom: number, radiusTo: number): Keyframe[] {
  return curve.map((p) => {
    const left = from.left + (to.left - from.left) * p;
    const top = from.top + (to.top - from.top) * p;
    const width = Math.max(1, from.width + (to.width - from.width) * p);
    const height = Math.max(1, from.height + (to.height - from.height) * p);
    const sx = width / base.width;
    const sy = height / base.height;
    const radius = radiusFrom + (radiusTo - radiusFrom) * Math.min(1, Math.max(0, p));
    return {
      transform: `translate(${(left - base.left).toFixed(2)}px, ${(top - base.top).toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`,
      borderRadius: `${(radius / sx).toFixed(2)}px / ${(radius / sy).toFixed(2)}px`,
    };
  });
}

/** Plays `frames` on the curve's own clock. */
export function playCurve(element: Element, frames: Keyframe[], points: readonly number[], delay = 0): Animation {
  return element.animate(frames, { duration: msOf(points), delay, easing: 'linear', fill: 'both' });
}

/** Resolves when the animation ends, or when its time is up (a tab in the background never ends one). */
export function settle(animation: Animation, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    animation.finished.then(finish, finish);
    setTimeout(finish, ms + 80);
  });
}

/** Whether the person asked for less motion. */
export function lessMotion(view: Window | null): boolean {
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}
