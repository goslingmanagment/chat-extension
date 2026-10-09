import { describe, expect, it } from 'vitest';

import { writeZip } from '../lib/zip-write.ts';
import { readZip, type ZipEntry } from '../lib/zip.ts';
import { checkSignedXpi, isSigned, sha256Hex, SIGNATURE_FILES, xpiIdentity } from './xpi.ts';

const ID = 'chat-extension@example.test';
const file = (name: string, text: string): ZipEntry => ({ name, data: Buffer.from(text) });
const manifest = (version: string, id = ID): ZipEntry => file('manifest.json', JSON.stringify({ manifest_version: 3, version, browser_specific_settings: { gecko: { id } } }));
const BUILD = [manifest('0.1.0'), file('background.js', 'console.log(1)'), file('lazy/dock.js', 'export {}')];
const signatures = SIGNATURE_FILES.map((name) => file(name, 'signature'));
/** Through a real archive, as the tool reads it. */
const signed = (entries: readonly ZipEntry[]): ZipEntry[] => readZip(writeZip([...signatures, file('META-INF/cose.sig', 'cose'), ...entries]));

describe('a signed XPI', () => {
  it('[UP-002] passes when it is the build plus Mozilla’s signature files', () => {
    expect(checkSignedXpi(signed(BUILD), { version: '0.1.0', geckoId: ID }, BUILD)).toEqual([]);
    expect(isSigned(signed(BUILD))).toBe(true);
    expect(xpiIdentity(signed(BUILD))).toEqual({ version: '0.1.0', geckoId: ID });
  });

  it('an unsigned archive, another add-on or another version is refused', () => {
    expect(isSigned(BUILD)).toBe(false);
    expect(checkSignedXpi(BUILD, { version: '0.1.0', geckoId: ID }, BUILD)).toEqual(SIGNATURE_FILES.map((name) => `not signed: ${name} is missing`));
    expect(checkSignedXpi(signed(BUILD), { version: '0.1.1', geckoId: ID }, BUILD)).toEqual(['version 0.1.0, expected 0.1.1']);
    expect(checkSignedXpi(signed(BUILD), { version: '0.1.0', geckoId: 'other@example.test' }, BUILD)).toEqual([`add-on id ${ID}, expected other@example.test`]);
    expect(checkSignedXpi(signed([file('readme.txt', 'x')]), { version: '0.1.0', geckoId: ID }, [])).toEqual(['no manifest.json in the XPI.', 'readme.txt is in the XPI but not in the build']);
  });

  it('a file changed, added or lost on the way to the signature is named', () => {
    const tampered = signed([manifest('0.1.0'), file('background.js', 'console.log(2)'), file('extra.js', '1')]);
    expect(checkSignedXpi(tampered, { version: '0.1.0', geckoId: ID }, BUILD)).toEqual([
      'background.js differs from the build',
      'extra.js is in the XPI but not in the build',
      'lazy/dock.js is in the build but not in the XPI',
    ]);
  });

  it('manifest.json as AMO writes it back (indented, non-ASCII as \\u escapes) is still the build; a changed value is not', () => {
    const built = file('manifest.json', JSON.stringify({ manifest_version: 3, name: 'ChatGoose для ChatSpace', version: '0.1.0', browser_specific_settings: { gecko: { id: ID } } }));
    const build = [built, file('background.js', 'console.log(1)')];
    const amo = JSON.stringify({ name: 'ChatGoose для ChatSpace', manifest_version: 3, version: '0.1.0', browser_specific_settings: { gecko: { id: ID } } }, null, 2).replace(/[\u0080-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
    expect(amo).toContain('\\u0434');
    expect(checkSignedXpi(signed([file('manifest.json', amo), file('background.js', 'console.log(1)')]), { version: '0.1.0', geckoId: ID }, build)).toEqual([]);
    const changed = JSON.stringify({ manifest_version: 3, name: 'ChatGoose для ChatSpace', version: '0.1.0', browser_specific_settings: { gecko: { id: ID } }, permissions: ['tabs'] }, null, 2);
    expect(checkSignedXpi(signed([file('manifest.json', changed), file('background.js', 'console.log(1)')]), { version: '0.1.0', geckoId: ID }, build)).toEqual(['manifest.json differs from the build']);
    // Other files stay byte for byte: the same JS in another formatting is a different file.
    expect(checkSignedXpi(signed([built, file('background.js', 'console.log( 1 )')]), { version: '0.1.0', geckoId: ID }, build)).toEqual(['background.js differs from the build']);
  });

  it('sha256Hex is the hex digest the feed carries', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
