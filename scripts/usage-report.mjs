// Sums token usage from Claude Code transcript JSONL files (lead + subagents).
// Each assistant API response can appear on several lines (one per content block)
// carrying the same message.id and the same usage, so we count each id once.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const files = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.jsonl')) files.push(p); } };
if (existsSync(dir + '.jsonl')) files.push(dir + '.jsonl');
if (existsSync(dir)) walk(dir);
const byModel = {}, byFile = {};
// Streaming writes several lines per response; keep the one with the largest usage.
const best = new Map();
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const m = j.message;
    if (!m || m.role !== 'assistant' || !m.usage) continue;
    const key = m.id || j.uuid;
    const prev = best.get(key);
    if (!prev || (m.usage.output_tokens || 0) > (prev.u.output_tokens || 0)) best.set(key, { u: m.usage, model: m.model || 'unknown', f });
  }
}
for (const { u, model, f } of best.values()) {
  {
    const add = (o) => { o.input = (o.input || 0) + (u.input_tokens || 0); o.output = (o.output || 0) + (u.output_tokens || 0); o.cacheRead = (o.cacheRead || 0) + (u.cache_read_input_tokens || 0); o.cacheWrite = (o.cacheWrite || 0) + (u.cache_creation_input_tokens || 0); o.responses = (o.responses || 0) + 1; };
    add(byModel[model] ??= {});
    add(byFile[f.split('/').pop() + ' [' + model + ']'] ??= {});
  }
}
const total = {};
for (const v of Object.values(byModel)) for (const [k, n] of Object.entries(v)) total[k] = (total[k] || 0) + n;
console.log(JSON.stringify({ files: files.length, byModel, byFile, total }, null, 2));
