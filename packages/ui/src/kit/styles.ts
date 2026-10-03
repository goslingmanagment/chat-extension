// Styles go into our shadow roots as constructable stylesheets
// (adoptedStyleSheets, §6.3). If the browser refuses (e.g. a Firefox
// content-script Xray quirk), fall back to a <style> element inside the root.

export type StyleMode = 'adopted' | 'style-element';

export function adoptStyles(root: ShadowRoot, cssText: string): StyleMode {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return 'adopted';
  } catch {
    const style = root.ownerDocument.createElement('style');
    style.textContent = cssText;
    root.append(style);
    return 'style-element';
  }
}
