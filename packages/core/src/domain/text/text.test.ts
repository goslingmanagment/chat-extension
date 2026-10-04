import { describe, expect, it } from 'vitest';

import { htmlToPlainText, normalizeNewlines } from './index';

describe('normalizeNewlines', () => {
  it('turns CRLF and lone CR into LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
});

describe('[RU-002] htmlToPlainText', () => {
  it('turns breaks and paragraph ends into newlines and drops every other tag', () => {
    expect(htmlToPlainText('<p>hey <b>you</b></p><p>how are you?<br>miss me?</p>')).toBe('hey you\nhow are you?\nmiss me?');
    expect(htmlToPlainText('one<br/>two<BR >three')).toBe('one\ntwo\nthree');
    expect(htmlToPlainText('<a href="https://example.test/x?y=1">link</a> <!-- note --> text')).toBe('link  text');
  });

  it('decodes entities once and last, so escaped markup stays literal text', () => {
    expect(htmlToPlainText('&lt;b&gt;not bold&lt;/b&gt;')).toBe('<b>not bold</b>');
    expect(htmlToPlainText('&amp;lt;')).toBe('&lt;');
    expect(htmlToPlainText('Tom &amp; Jerry &#39;quoted&#x27; &quot;x&quot;')).toBe('Tom & Jerry \'quoted\' "x"');
    expect(htmlToPlainText('&#128522; &unknown; &#xD800; &#99999999;')).toBe('😊 &unknown; &#xD800; &#99999999;');
  });

  it('normalizes NBSP, trailing spaces before a newline and the ends', () => {
    expect(htmlToPlainText('  a&nbsp;b\u00a0c  <br>  d  ')).toBe('a b c\n  d');
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText('<p></p>')).toBe('');
  });

  it('keeps plain text as it is, a lone < included', () => {
    expect(htmlToPlainText('2 < 3 and 5 > 4')).toBe('2 < 3 and 5 > 4');
    expect(htmlToPlainText('line one\r\nline two')).toBe('line one\nline two');
  });
});
