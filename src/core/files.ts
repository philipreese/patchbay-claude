import type { Patch } from './types';
import { serializePatch } from './serialize';

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB

/** Trigger a browser download of a Blob. Works on iOS Safari (needs the anchor in the DOM). */
export function downloadBlob(blob: Blob, filename: string): void {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.position = 'fixed';
    a.style.top = '-1000px';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke later so Safari has time to start the download.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }, 30000);
  } catch {
    /* best-effort; nothing we can do without a working DOM */
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'patch'
  );
}

export function exportPatchFile(patch: Patch): void {
  try {
    const json = serializePatch(patch);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${slug(patch.name || 'patch')}.patchbay.json`);
  } catch {
    /* ignore */
  }
}

/**
 * Opens a native file picker for a .json patch file and resolves with its text
 * content. Resolves null when the user cancels (where the browser lets us tell);
 * rejects with a friendly message for files that are too large or unreadable.
 */
export function pickPatchFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.position = 'fixed';
      input.style.top = '-1000px';
      let settled = false;

      const cleanup = () => {
        window.removeEventListener('focus', onFocus);
        if (input.parentNode) input.parentNode.removeChild(input);
      };

      const onFocus = () => {
        // Give the change event a chance to fire first if a file was picked.
        setTimeout(() => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(null);
          }
        }, 300);
      };

      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(null);
          }
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          settled = true;
          cleanup();
          reject(new Error('That file is too large (over 1 MB).'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          settled = true;
          cleanup();
          resolve(typeof reader.result === 'string' ? reader.result : null);
        };
        reader.onerror = () => {
          settled = true;
          cleanup();
          reject(new Error('Could not read that file.'));
        };
        reader.readAsText(file);
      });

      window.addEventListener('focus', onFocus);
      document.body.appendChild(input);
      input.click();
    } catch {
      reject(new Error('Could not open the file picker.'));
    }
  });
}
