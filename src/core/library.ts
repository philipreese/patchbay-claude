import type { Patch } from './types';
import { parsePatch, serializePatch } from './serialize';

const LIBRARY_KEY = 'patchbay.library.v1';
const SESSION_KEY = 'patchbay.session.v1';
const PREFS_KEY = 'patchbay.prefs.v1';

export interface SavedEntry {
  id: string;
  name: string;
  savedAt: number;
}

interface LibraryFile {
  entries: Record<string, { name: string; savedAt: number; patch: Patch }>;
}

function readLibrary(): LibraryFile {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { entries: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return { entries: {} };
    }
    return parsed as LibraryFile;
  } catch {
    return { entries: {} };
  }
}

function writeLibrary(lib: LibraryFile): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}

function slugId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'patch'
  );
}

export function listSaved(): SavedEntry[] {
  try {
    const lib = readLibrary();
    return Object.entries(lib.entries)
      .map(([id, e]) => ({ id, name: e.name, savedAt: e.savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function savePatch(patch: Patch, name?: string): { ok: boolean; id?: string; error?: string } {
  try {
    const finalName = (name && name.trim()) || patch.name || 'Untitled';
    const lib = readLibrary();
    // Overwrite an existing entry with the same name.
    let id = Object.entries(lib.entries).find(([, e]) => e.name === finalName)?.[0];
    if (!id) {
      const base = slugId(finalName);
      id = base;
      let i = 2;
      while (lib.entries[id]) id = `${base}-${i++}`;
    }
    const patchToStore: Patch = { ...patch, name: finalName };
    lib.entries[id] = { name: finalName, savedAt: Date.now(), patch: patchToStore };
    if (!writeLibrary(lib)) return { ok: false, error: 'Could not save (storage unavailable or full).' };
    return { ok: true, id };
  } catch {
    return { ok: false, error: 'Could not save.' };
  }
}

export function loadSaved(id: string): Patch | null {
  try {
    const lib = readLibrary();
    const entry = lib.entries[id];
    if (!entry) return null;
    const { patch, error } = parsePatch(entry.patch);
    if (error) return null;
    return patch;
  } catch {
    return null;
  }
}

export function deleteSaved(id: string): boolean {
  try {
    const lib = readLibrary();
    if (!lib.entries[id]) return false;
    delete lib.entries[id];
    return writeLibrary(lib);
  } catch {
    return false;
  }
}

// ---- session autosave -------------------------------------------------------

export function saveSession(patch: Patch): boolean {
  try {
    localStorage.setItem(SESSION_KEY, serializePatch(patch));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): Patch | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { patch, error } = parsePatch(raw);
    if (error) return null;
    return patch;
  } catch {
    return null;
  }
}

export function clearSession(): boolean {
  try {
    localStorage.removeItem(SESSION_KEY);
    return true;
  } catch {
    return false;
  }
}

// ---- prefs --------------------------------------------------------------------

function readPrefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getPref<T>(key: string, fallback: T): T {
  try {
    const prefs = readPrefs();
    if (!Object.prototype.hasOwnProperty.call(prefs, key)) return fallback;
    return prefs[key] as T;
  } catch {
    return fallback;
  }
}

export function setPref<T>(key: string, value: T): boolean {
  try {
    const prefs = readPrefs();
    prefs[key] = value;
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}
