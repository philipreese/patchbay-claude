import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Patch } from './types';
import { parsePatch } from './serialize';

export interface DecodeResult {
  patch: Patch | null;
  warnings: string[];
  error?: string;
}

/** Compact JSON (no pretty-printing) for the URL payload. */
function compact(patch: Patch): string {
  try {
    return JSON.stringify(patch);
  } catch {
    return JSON.stringify({ format: 'patchbay', version: 1, name: 'Untitled', tempo: 110, modules: [], cables: [], macros: [] });
  }
}

/** Encode a patch as a URL hash fragment payload: 'p=<compressed>'. */
export function encodePatchForUrl(patch: Patch): string {
  const json = compact(patch);
  const packed = compressToEncodedURIComponent(json);
  return 'p=' + packed;
}

/**
 * Decode a URL hash (with or without leading '#', with or without 'p=') into a patch.
 * Returns null when the hash carries no patch payload at all.
 */
export function decodePatchFromHash(hash: string): DecodeResult | null {
  try {
    if (typeof hash !== 'string') return null;
    let h = hash.trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (!h) return null;

    // The hash may contain several '&'-separated fields; find 'p='.
    const parts = h.split('&');
    let payload: string | null = null;
    for (const part of parts) {
      if (part.startsWith('p=')) {
        payload = part.slice(2);
        break;
      }
    }
    if (payload === null && !h.includes('=')) {
      // Bare payload with no 'p=' prefix at all.
      payload = h;
    }
    if (payload === null || payload === '') return null;

    let json: string | null = null;
    try {
      json = decompressFromEncodedURIComponent(payload);
    } catch {
      json = null;
    }
    if (json === null || json === '') {
      return { patch: null, warnings: [], error: 'That share link looks damaged or incomplete.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { patch: null, warnings: [], error: 'That share link looks damaged or incomplete.' };
    }

    const result = parsePatch(parsed);
    return result;
  } catch {
    return { patch: null, warnings: [], error: 'That share link looks damaged or incomplete.' };
  }
}

export interface LocationLike {
  origin: string;
  pathname: string;
  search: string;
}

/** Build a full shareable URL, preserving any deployment subpath. */
export function buildShareUrl(patch: Patch, loc: LocationLike = typeof location !== 'undefined' ? location : { origin: '', pathname: '', search: '' }): string {
  const encoded = encodePatchForUrl(patch);
  return `${loc.origin}${loc.pathname}${loc.search}#${encoded}`;
}
