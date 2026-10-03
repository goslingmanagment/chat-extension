// Saving a file from an extension page through a Blob (architecture.md §3:
// no `downloads` permission; §9.2 diagnostics export). The person clicks
// «Выгрузить диагностику» on the options page; the page asks the background
// for the body (`diagnostics.export`) and saves it here.

export interface DownloadFile {
  readonly fileName: string;
  readonly mime: string;
  readonly body: string;
}

export interface DownloadDeps {
  readonly document: Pick<Document, 'createElement' | 'body'>;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
}

/** How long the object URL stays alive after the click (the save may start late). */
export const DOWNLOAD_URL_TTL_MS = 30_000;

/** Path separators, control and reserved characters out; at most 128 characters. */
export function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is stripped
  const cleaned = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').trim();
  return (cleaned === '' ? 'chatgoose' : cleaned).slice(0, 128);
}

function defaultDeps(): DownloadDeps {
  return {
    document: globalThis.document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  };
}

export function downloadFile(file: DownloadFile, deps: DownloadDeps = defaultDeps()): boolean {
  try {
    const url = deps.createObjectURL(new Blob([file.body], { type: file.mime }));
    const link = deps.document.createElement('a');
    link.href = url;
    link.download = safeFileName(file.fileName);
    link.rel = 'noopener';
    link.style.display = 'none';
    deps.document.body.append(link);
    link.click();
    link.remove();
    deps.setTimeout(() => deps.revokeObjectURL(url), DOWNLOAD_URL_TTL_MS);
    return true;
  } catch {
    return false;
  }
}
