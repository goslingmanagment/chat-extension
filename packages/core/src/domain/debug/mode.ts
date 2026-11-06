// Debug mode (architecture.md §9.3; DB-020): where a result's debug blocks
// show. In a collapsed dock — the strip alone — there are none: they show
// only with an opened result, in the dock's sheet or in the «Развернуть ↗»
// window.

/**
 * DB-020: debug blocks of a result appear only once the result is opened —
 * the dock's sheet above the strip (ui-design §4.12, `final-10`: the footer
 * of the open sheet) or the «Развернуть ↗» window. The collapsed dock is the
 * strip alone and shows none. The old extension's «inline» panel was the
 * collapsed form; here the sheet is the opened one.
 */
export function showDebugBlock(debug: boolean, opened: boolean): boolean {
  return debug && opened;
}
