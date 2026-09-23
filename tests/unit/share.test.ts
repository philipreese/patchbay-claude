import { describe, expect, it } from 'vitest';
import { buildShareUrl, decodePatchFromHash, encodePatchForUrl } from '../../src/core/share';
import { bassPatch } from '../../src/presets/index';

describe('share: encode/decode round trip', () => {
  it('round-trips a patch through the hash payload', () => {
    const patch = bassPatch();
    const encoded = encodePatchForUrl(patch);
    expect(encoded.startsWith('p=')).toBe(true);
    const result = decodePatchFromHash('#' + encoded);
    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.patch).not.toBeNull();
    expect(result!.patch!.name).toBe(patch.name);
    expect(result!.patch!.modules.length).toBe(patch.modules.length);
    expect(result!.patch!.cables.length).toBe(patch.cables.length);
  });

  it('decodes without the leading #', () => {
    const patch = bassPatch();
    const encoded = encodePatchForUrl(patch);
    const result = decodePatchFromHash(encoded);
    expect(result?.patch?.name).toBe(patch.name);
  });
});

describe('share: buildShareUrl preserves subpath', () => {
  it('keeps a GitHub Pages style subpath', () => {
    const patch = bassPatch();
    const url = buildShareUrl(patch, { origin: 'https://user.github.io', pathname: '/patchbay-claude/', search: '' });
    expect(url.startsWith('https://user.github.io/patchbay-claude/#p=')).toBe(true);
  });

  it('preserves search params', () => {
    const patch = bassPatch();
    const url = buildShareUrl(patch, { origin: 'https://example.com', pathname: '/app/', search: '?ref=x' });
    expect(url.startsWith('https://example.com/app/?ref=x#p=')).toBe(true);
  });

  it('the built url decodes back to the same patch', () => {
    const patch = bassPatch();
    const url = buildShareUrl(patch, { origin: 'https://user.github.io', pathname: '/patchbay-claude/', search: '' });
    const hash = url.slice(url.indexOf('#'));
    const result = decodePatchFromHash(hash);
    expect(result?.patch?.name).toBe(patch.name);
  });
});

describe('share: garbage / truncated hashes never throw', () => {
  const cases: string[] = ['', '#', '#p=', 'p=', '#p=garbage!!not-lz-string', '#nopayloadhere', '#p=' + 'a'.repeat(5), '#other=1&p=garbage'];

  for (const [i, h] of cases.entries()) {
    it(`handles case #${i}: ${JSON.stringify(h)}`, () => {
      expect(() => decodePatchFromHash(h)).not.toThrow();
    });
  }

  it('returns null for an empty/no-payload hash', () => {
    expect(decodePatchFromHash('')).toBeNull();
    expect(decodePatchFromHash('#')).toBeNull();
    expect(decodePatchFromHash('#nopayloadhere=1')).toBeNull();
  });

  it('returns an error result (not a thrown exception) for garbage payloads', () => {
    const result = decodePatchFromHash('#p=not-valid-lz-string-data!!');
    expect(result).not.toBeNull();
    expect(result!.patch).toBeNull();
    expect(result!.error).toBeTruthy();
  });

  it('handles a truncated compressed payload gracefully', () => {
    const patch = bassPatch();
    const encoded = encodePatchForUrl(patch);
    const truncated = encoded.slice(0, Math.floor(encoded.length / 3));
    expect(() => decodePatchFromHash('#' + truncated)).not.toThrow();
    const result = decodePatchFromHash('#' + truncated);
    expect(result).not.toBeNull();
    // Either a clean parse error, or (rarely) valid-but-different JSON — never a throw either way.
  });
});
