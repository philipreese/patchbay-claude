import type { Cable, Macro, MacroTarget, ParamValue, Patch, PatchModule, PortRef, SeqData, SeqStep } from './types';
import { defaultParams, getModuleDef, getParamDef, isModuleType, sanitizeParam } from './moduleDefs';
import { checkConnection, emptySeqData } from './store';

const MAX_MODULES = 64;
const MAX_CABLES = 256;
const MAX_MACROS = 6;
const CABLE_COLORS = 6;

export interface ParseResult {
  patch: Patch | null;
  warnings: string[];
  error?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function finiteOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  // Guard against absurdly long strings before slicing (cheap defence).
  const s = v.length > maxLen * 4 ? v.slice(0, maxLen * 4) : v;
  return s.slice(0, maxLen);
}

/** Safe property read that never triggers prototype-pollution surprises. */
function get(obj: Record<string, unknown>, key: string): unknown {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function sanitizeSeqStep(v: unknown): SeqStep {
  const src = isPlainObject(v) ? v : {};
  let note = finiteOr(get(src, 'note'), 0);
  note = Math.round(clamp(note, -24, 24));
  return {
    on: get(src, 'on') === true,
    note,
    accent: get(src, 'accent') === true,
    slide: get(src, 'slide') === true,
  };
}

function sanitizeSeqData(v: unknown): SeqData {
  const empty = emptySeqData();
  const src = isPlainObject(v) ? v : {};
  const rawSteps = get(src, 'steps');
  const arr = Array.isArray(rawSteps) ? rawSteps : [];
  const steps: SeqStep[] = [];
  for (let i = 0; i < 16; i++) {
    steps.push(arr[i] !== undefined ? sanitizeSeqStep(arr[i]) : empty.steps[i]);
  }
  return { steps };
}

function sanitizeParams(type: string, v: unknown): Record<string, ParamValue> {
  const def = getModuleDef(type);
  const out = defaultParams(type as any);
  if (!def || !isPlainObject(v)) return out;
  for (const p of def.params) {
    const raw = get(v, p.key);
    if (raw === undefined) continue;
    out[p.key] = sanitizeParam(p, raw);
  }
  return out;
}

function genModuleId(existing: Set<string>, type: string): string {
  let i = 1;
  let id = `${type}${i}`;
  while (existing.has(id)) id = `${type}${++i}`;
  return id;
}

function genCableId(existing: Set<string>): string {
  let i = 1;
  let id = `c${i}`;
  while (existing.has(id)) id = `c${++i}`;
  return id;
}

function sanitizeModule(v: unknown, usedIds: Set<string>, warnings: string[], index: number): PatchModule | null {
  if (!isPlainObject(v)) {
    warnings.push(`Skipped a module that wasn't valid (item ${index + 1}).`);
    return null;
  }
  const typeRaw = get(v, 'type');
  if (!isModuleType(typeRaw)) {
    warnings.push(`Skipped a module with an unknown type.`);
    return null;
  }
  const type = typeRaw;
  let id = sanitizeString(get(v, 'id'), 32) || '';
  if (!id || usedIds.has(id)) {
    const wantedId = id;
    id = genModuleId(usedIds, type);
    if (wantedId) warnings.push(`Renamed a duplicate module id to “${id}”.`);
  }
  usedIds.add(id);

  const x = clamp(finiteOr(get(v, 'x'), 0), -20000, 20000);
  const y = clamp(finiteOr(get(v, 'y'), 0), -20000, 20000);

  const m: PatchModule = {
    id,
    type,
    x,
    y,
    params: sanitizeParams(type, get(v, 'params')),
  };
  const label = sanitizeString(get(v, 'label'), 32);
  if (label) m.label = label;
  if (type === 'seq') m.data = sanitizeSeqData(get(v, 'data'));
  return m;
}

function sanitizePortRef(v: unknown): PortRef | null {
  if (!isPlainObject(v)) return null;
  const module = sanitizeString(get(v, 'module'), 32);
  const port = sanitizeString(get(v, 'port'), 32);
  if (!module || !port) return null;
  return { module, port };
}

function sanitizeMacroTarget(v: unknown, patch: Patch, warnings: string[]): MacroTarget | null {
  if (!isPlainObject(v)) return null;
  const module = sanitizeString(get(v, 'module'), 32);
  const param = sanitizeString(get(v, 'param'), 32);
  if (!module || !param) return null;
  const mod = patch.modules.find((m) => m.id === module);
  if (!mod) {
    warnings.push('Dropped a macro target pointing at a module that no longer exists.');
    return null;
  }
  const def = getParamDef(mod.type, param);
  if (!def || def.type !== 'number') {
    warnings.push('Dropped a macro target pointing at a non-numeric or unknown parameter.');
    return null;
  }
  const from = clamp(finiteOr(get(v, 'from'), def.min), def.min, def.max);
  const to = clamp(finiteOr(get(v, 'to'), def.max), def.min, def.max);
  return { module, param, from, to };
}

function sanitizeMacro(v: unknown, patch: Patch, warnings: string[]): Macro | null {
  if (!isPlainObject(v)) return null;
  const label = sanitizeString(get(v, 'label'), 24);
  if (!label) return null;
  const rawTargets = get(v, 'targets');
  const targetsIn = Array.isArray(rawTargets) ? rawTargets : [];
  const targets: MacroTarget[] = [];
  for (const t of targetsIn) {
    const st = sanitizeMacroTarget(t, patch, warnings);
    if (st) targets.push(st);
  }
  if (!targets.length) return null;
  const macro: Macro = { label, targets };
  const hint = sanitizeString(get(v, 'hint'), 60);
  if (hint) macro.hint = hint;
  return macro;
}

function findFreeSpot(patch: Patch): { x: number; y: number } {
  let x = 200,
    y = 200;
  const taken = new Set(patch.modules.map((m) => `${m.x},${m.y}`));
  while (taken.has(`${x},${y}`)) {
    x += 40;
    y += 40;
  }
  return { x, y };
}

/**
 * Parse and fully sanitise an arbitrary value into a valid Patch.
 * Never throws. Returns null patch with `error` for unrecoverable input.
 */
export function parsePatch(input: unknown): ParseResult {
  const warnings: string[] = [];
  try {
    let obj: unknown = input;
    if (typeof obj === 'string') {
      try {
        obj = JSON.parse(obj);
      } catch {
        return { patch: null, warnings, error: 'That link or file isn’t a valid patch (bad JSON).' };
      }
    }
    if (!isPlainObject(obj)) {
      return { patch: null, warnings, error: 'That doesn’t look like a Patchbay patch.' };
    }
    const format = get(obj, 'format');
    if (format !== undefined && format !== 'patchbay') {
      return { patch: null, warnings, error: 'That file isn’t a Patchbay patch.' };
    }

    const name = sanitizeString(get(obj, 'name'), 48) || 'Untitled';
    const about = sanitizeString(get(obj, 'about'), 200);
    const tempo = Math.round(clamp(finiteOr(get(obj, 'tempo'), 110), 40, 220));

    const patch: Patch = {
      format: 'patchbay',
      version: 1,
      name,
      tempo,
      modules: [],
      cables: [],
      macros: [],
    };
    if (about) patch.about = about;

    // ---- modules ----
    const rawModules = get(obj, 'modules');
    const modulesIn = Array.isArray(rawModules) ? rawModules : [];
    if (rawModules !== undefined && !Array.isArray(rawModules)) {
      warnings.push('Ignored malformed module list.');
    }
    const usedIds = new Set<string>();
    let dropped = 0;
    for (let i = 0; i < modulesIn.length; i++) {
      if (patch.modules.length >= MAX_MODULES) {
        dropped = modulesIn.length - i;
        break;
      }
      const m = sanitizeModule(modulesIn[i], usedIds, warnings, i);
      if (m) patch.modules.push(m);
    }
    if (dropped > 0) warnings.push(`Only kept the first ${MAX_MODULES} modules (${dropped} dropped).`);

    // ---- ensure exactly one output ----
    const outputs = patch.modules.filter((m) => m.type === 'output');
    if (outputs.length === 0) {
      if (patch.modules.length >= MAX_MODULES) {
        // Make room so the total never exceeds the module cap.
        patch.modules.pop();
      }
      const spot = findFreeSpot(patch);
      const id = genModuleId(usedIds, 'output');
      usedIds.add(id);
      patch.modules.push({ id, type: 'output', x: spot.x, y: spot.y, params: defaultParams('output') });
      warnings.push('Added a missing Output module.');
    } else if (outputs.length > 1) {
      const keep = outputs[0];
      patch.modules = patch.modules.filter((m) => m.type !== 'output' || m === keep);
      warnings.push('Removed extra Output modules (only one is allowed).');
    }

    // ---- cables ----
    const rawCables = get(obj, 'cables');
    const cablesIn = Array.isArray(rawCables) ? rawCables : [];
    if (rawCables !== undefined && !Array.isArray(rawCables)) {
      warnings.push('Ignored malformed cable list.');
    }
    const usedCableIds = new Set<string>();
    let cableDropped = 0;
    let cableInvalid = 0;
    for (const cv of cablesIn) {
      if (patch.cables.length >= MAX_CABLES) {
        cableDropped++;
        continue;
      }
      if (!isPlainObject(cv)) {
        cableInvalid++;
        continue;
      }
      const from = sanitizePortRef(get(cv, 'from'));
      const to = sanitizePortRef(get(cv, 'to'));
      if (!from || !to) {
        cableInvalid++;
        continue;
      }
      const chk = checkConnection(patch, from, to);
      if (!chk.ok) {
        cableInvalid++;
        continue;
      }
      let id = sanitizeString(get(cv, 'id'), 32) || '';
      if (!id || usedCableIds.has(id)) id = genCableId(usedCableIds);
      usedCableIds.add(id);
      const colorRaw = get(cv, 'color');
      const color = Number.isFinite(colorRaw as number)
        ? Math.round(clamp(colorRaw as number, 0, CABLE_COLORS - 1))
        : patch.cables.length % CABLE_COLORS;
      const cable: Cable = { id, from, to, color };
      patch.cables.push(cable);
    }
    if (cableInvalid > 0) warnings.push(`Dropped ${cableInvalid} invalid or duplicate cable${cableInvalid === 1 ? '' : 's'}.`);
    if (cableDropped > 0) warnings.push(`Only kept the first ${MAX_CABLES} cables (${cableDropped} dropped).`);

    // ---- macros ----
    const rawMacros = get(obj, 'macros');
    const macrosIn = Array.isArray(rawMacros) ? rawMacros : [];
    if (rawMacros !== undefined && !Array.isArray(rawMacros)) {
      warnings.push('Ignored malformed macro list.');
    }
    for (const mv of macrosIn) {
      if (patch.macros.length >= MAX_MACROS) {
        warnings.push(`Only kept the first ${MAX_MACROS} macros.`);
        break;
      }
      const mac = sanitizeMacro(mv, patch, warnings);
      if (mac) patch.macros.push(mac);
    }

    // ---- view ----
    const rawView = get(obj, 'view');
    if (isPlainObject(rawView)) {
      const vx = finiteOr(get(rawView, 'x'), 0);
      const vy = finiteOr(get(rawView, 'y'), 0);
      const vzoom = clamp(finiteOr(get(rawView, 'zoom'), 1), 0.2, 2);
      patch.view = { x: clamp(vx, -20000, 20000), y: clamp(vy, -20000, 20000), zoom: vzoom };
    }

    // ---- chords ----
    const chords = get(obj, 'chords');
    if (chords === true) patch.chords = true;

    return { patch, warnings };
  } catch (err) {
    return { patch: null, warnings, error: 'Something went wrong reading that patch.' };
  }
}

export function serializePatch(patch: Patch): string {
  try {
    return JSON.stringify(patch, null, 2);
  } catch {
    return JSON.stringify({ format: 'patchbay', version: 1, name: 'Untitled', tempo: 110, modules: [], cables: [], macros: [] });
  }
}
