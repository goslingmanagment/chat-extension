// What `web-ext sign` leaves behind. It writes `.amo-upload-uuid` INTO the
// directory it signs: the id of the upload, to resume an interrupted run
// without uploading again. Left in the build directory, that file
// - makes the directory differ from its XPI (`pnpm archive-check` fails), and
// - makes the next `web-ext sign` of the same build skip the upload and reuse
//   the id — after a dry run against the local AMO stand-in that id means
//   nothing to the real AMO, and the real signing would fail on it.
// So every run of ours starts without the file and removes it afterwards.

import { rmSync } from 'node:fs';
import { join } from 'node:path';

export const UPLOAD_UUID_FILE = '.amo-upload-uuid';

export function dropUploadUuid(buildDir: string): void {
  rmSync(join(buildDir, UPLOAD_UUID_FILE), { force: true });
}
