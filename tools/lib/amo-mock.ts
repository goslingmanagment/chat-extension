// A LOCAL stand-in for the AMO submission API on 127.0.0.1, enough for one
// `web-ext sign --channel unlisted --upload-source-code …` run: XPI upload,
// validation poll, version creation, sources upload, approval poll, download
// of the "signed" file. Nothing is signed and nothing leaves the machine. Used
// by `pnpm sign:dry-run` (the spike's proof that signing works on this Node)
// and by the release tool's own test.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface AmoRequest {
  readonly method: string;
  readonly path: string;
  /** The scheme of the Authorization header (`JWT`), never the token. */
  readonly auth: string;
  readonly contentType: string;
  readonly bytes: number;
  /** The body when it is JSON, else ''. */
  readonly json: string;
}

export interface AmoMock {
  /** `http://127.0.0.1:<port>/api/v5/` — what `--amo-base-url` takes. */
  readonly baseUrl: string;
  readonly seen: readonly AmoRequest[];
  /** The name the "signed" file is served (and saved by web-ext) under. */
  readonly signedName: string;
  close(): Promise<void>;
}

export interface AmoMockOptions {
  readonly geckoId: string;
  readonly version: string;
  /** What the download of the "signed" file returns. */
  readonly signedXpi: Buffer;
}

export async function startAmoMock(options: AmoMockOptions): Promise<AmoMock> {
  const addonPath = `/api/v5/addons/addon/${options.geckoId}/`;
  const signedName = `signed-${options.version}.xpi`;
  const seen: AmoRequest[] = [];

  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const port = (server: Server): number => {
    const address = server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const path = decodeURIComponent(request.url ?? '');
      const method = request.method ?? '';
      const body = Buffer.concat(chunks);
      const contentType = (request.headers['content-type'] ?? '').split(';')[0] ?? '';
      seen.push({
        method,
        path,
        auth: (request.headers.authorization ?? '').split(' ')[0] ?? '',
        contentType,
        bytes: body.length,
        json: contentType === 'application/json' ? body.toString('utf8') : '',
      });
      const origin = `http://127.0.0.1:${port(server)}`;
      if (method === 'POST' && path === '/api/v5/addons/upload/') return reply(response, 201, { uuid: 'dry-run', processed: false });
      if (method === 'GET' && path === '/api/v5/addons/upload/dry-run/') return reply(response, 200, { uuid: 'dry-run', processed: true, valid: true, validation: {} });
      if (method === 'PUT' && path === addonPath) return reply(response, 200, { guid: options.geckoId, version: { id: 7, edit_url: `${origin}/edit` } });
      if (method === 'PATCH' && path === `${addonPath}versions/7/`) return reply(response, 200, {});
      if (method === 'GET' && path === `${addonPath}versions/7/`) return reply(response, 200, { file: { status: 'public', url: `${origin}/files/${signedName}` } });
      if (method === 'GET' && path === `/files/${signedName}`) {
        response.writeHead(200, { 'content-type': 'application/x-xpinstall' }).end(options.signedXpi);
        return;
      }
      reply(response, 404, { detail: 'not mocked' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${port(server)}/api/v5/`,
    seen,
    signedName,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The steps of a complete signing run, each with the request that proves it happened. */
export function amoStepsMissing(mock: AmoMock, geckoId: string): string[] {
  const addonPath = `/api/v5/addons/addon/${geckoId}/`;
  const steps: Array<[string, (request: AmoRequest) => boolean]> = [
    ['XPI upload (multipart, JWT)', (r) => r.method === 'POST' && r.path === '/api/v5/addons/upload/' && r.contentType === 'multipart/form-data' && r.bytes > 0],
    ['validation poll', (r) => r.method === 'GET' && r.path === '/api/v5/addons/upload/dry-run/'],
    ['version creation', (r) => r.method === 'PUT' && r.path === addonPath],
    ['sources upload (multipart)', (r) => r.method === 'PATCH' && r.contentType === 'multipart/form-data' && r.bytes > 0],
    ['approval poll', (r) => r.method === 'GET' && r.path.endsWith('/versions/7/')],
    ['signed file download', (r) => r.method === 'GET' && r.path === `/files/${mock.signedName}`],
  ];
  return steps.filter(([, test]) => !mock.seen.some(test)).map(([label]) => label);
}
