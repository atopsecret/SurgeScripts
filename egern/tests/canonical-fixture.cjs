// Node.js | 24+ | CommonJS
// Build: node --check egern/tests/canonical-fixture.cjs
// Run: required by the per-feature canonical Surge regression suites.
// Deps: Node built-ins; reads canonical files, mocks every HTTP client.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const definitions = Object.freeze({
  6: { module: 'cainiao/cainiao-adblock.sgmodule', script: 'cainiao/cainiao-adblock.js', native: 'cainiao/cainiao-adblock.egern.js', yaml: 'cainiao/cainiao-adblock.egern.yaml' },
  10: { module: 'amap/amap-adblock.sgmodule', script: 'amap/amap-cleaner.js', native: 'amap/amap-cleaner.egern.js', yaml: 'amap/amap-adblock.egern.yaml' },
  11: { module: 'jd/jd-adblock.sgmodule', script: 'jd/jd-ad-block.js', native: 'jd/jd-ad-block.egern.js', yaml: 'jd/jd-adblock.egern.yaml' },
  12: { module: 'xianyu/xianyu-ad-block.sgmodule', script: 'xianyu/xianyu-ad-block.js', native: 'xianyu/xianyu-ad-block.egern.js', yaml: 'xianyu/xianyu-adblock.egern.yaml' },
  13: { module: 'pinduoduo/pdd-adblock.sgmodule', script: 'pinduoduo/pdd-ad-block.js', native: 'pinduoduo/pdd-ad-block.egern.js', yaml: 'pinduoduo/pdd-adblock.egern.yaml' },
  14: { module: 'hongguo/hongguo-adblock.sgmodule', yaml: 'hongguo/hongguo-adblock.egern.yaml' },
  15: { module: 'jyjt/jyjt-member.sgmodule', script: 'jyjt/jyjt-member.js', native: 'jyjt/jyjt-member.egern.js', yaml: 'jyjt/jyjt-member.egern.yaml' },
});
class MockHeaders {
  constructor(value = {}) { this.entries = Array.isArray(value) ? value.map(x => [x.field, x.value]) : Object.entries(value); }
  get(name) { const item = this.entries.find(x => x[0].toLowerCase() === name.toLowerCase()); return item ? item[1] : null; }
  getAll(name) { return this.entries.filter(x => x[0].toLowerCase() === name.toLowerCase()).map(x => x[1]); }
  set(name, value) { this.delete(name); this.entries.push([name, value]); }
  delete(name) { this.entries = this.entries.filter(x => x[0].toLowerCase() !== name.toLowerCase()); }
  append(name, value) { this.entries.push([name, value]); }
}
function bytes(value) { return typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); }
function text(value) { return typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value); }
function commonContext() {
  const store = new Map(), logs = [];
  const blocked = () => { throw Error('Forbidden real network API in mock test'); };
  return { URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, console: { log: x => logs.push(String(x)) }, module: { exports: {} },
    $persistentStore: { read: k => store.get(k) || null, write: (v, k) => { store.set(k, v); return true; } },
    $httpClient: new Proxy({}, { get() { return blocked; } }), fetch: blocked, store, logs };
}
function runSurge(id, url, body, options = {}) {
  const context = commonContext(); let result, doneCount = 0;
  if (options.initialStore) for (const [key, value] of options.initialStore) context.store.set(key, value);
  context.$done = value => { doneCount++; result = value || {}; };
  if (url !== null) {
    context.$request = { url, method: options.method || 'GET', headers: options.requestHeaders || {}, id: options.id || 'test-request', body: options.requestBody };
    context.$response = { status: options.status ?? 200, headers: options.headers || { 'Content-Type': id === 15 ? 'text/xml; charset=utf-8' : 'application/json' }, body: options.binary ? bytes(body) : body };
  }
  vm.createContext(context);
  new vm.Script(fs.readFileSync(path.join(root, definitions[id].script), 'utf8')).runInContext(context, { timeout: 2000 });
  assert.equal(doneCount, 1, 'Surge completion must run once');
  return { result, body: result.body === undefined ? body : result.body, logs: context.logs, store: context.store };
}
async function runEgern(id, url, body, options = {}) {
  const context = commonContext(), input = bytes(body);
  const headers = new MockHeaders(options.headers || { 'Content-Type': id === 15 ? 'text/xml; charset=utf-8' : 'application/json' });
  const ctx = { request: { url, method: options.method || 'GET', headers: new MockHeaders(options.requestHeaders || {}), text: async () => options.requestBody || '' },
    response: { status: options.status ?? 200, headers, arrayBuffer: async () => input.slice().buffer, text: async () => text(input) },
    storage: { getJSON: k => context.store.has(k) ? JSON.parse(context.store.get(k)) : null, setJSON: (k, v) => context.store.set(k, JSON.stringify(v)) } };
  let source = fs.readFileSync(path.join(root, definitions[id].native), 'utf8');
  source = source.replace(/^export\s+\{[^\n]+\};?\s*$/gm, '').replace(/export default async function\(ctx\)/, 'async function __egernHandler(ctx)').replace(/\bexport (const|function) /g, '$1 ');
  context.ctx = ctx;
  vm.createContext(context);
  new vm.Script(source).runInContext(context, { timeout: 2000 });
  const result = await new vm.Script('__egernHandler(ctx)').runInContext(context, { timeout: 2000 });
  return { result: result || {}, body: result && result.body !== undefined ? result.body : body };
}
async function parity(id, url, input, options = {}) {
  const original = typeof input === 'string' ? input : JSON.stringify(input);
  const surge = runSurge(id, url, original, options), egern = await runEgern(id, url, original, options);
  assert.equal(text(surge.body), text(egern.body), 'Canonical Surge body differs from current Egern behavior');
  return surge;
}
function sections(file) {
  const result = {}; let active;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]$/);
    if (match) { active = match[1]; result[active] ||= []; }
    else if (active && line.trim() && !line.trim().startsWith('#')) result[active].push(line.trim());
  }
  return result;
}
function yamlSection(source, key) {
  const lines = source.split(/\r?\n/), start = lines.findIndex(line => line === key + ':');
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z][\w-]*:/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n');
}
function scalar(raw) {
  const value = raw.trim();
  if (value.startsWith("'")) { assert.ok(value.endsWith("'")); return value.slice(1, -1).replace(/''/g, "'"); }
  if (value.startsWith('"')) return JSON.parse(value);
  return value;
}
function listBlocks(block) {
  const markers = [...block.matchAll(/^( *)- [\w-]+:/gm)];
  if (!markers.length) return [];
  const indent = Math.min(...markers.map(item => item[1].length));
  const entries = markers.filter(item => item[1].length === indent);
  return entries.map((item, index) => block.slice(item.index, entries[index + 1]?.index ?? block.length));
}
// Deliberately parse only the simple scalars/headers present in these checked-in
// Egern modules. This is a test reader, not a replacement YAML implementation.
function nativeParts(id) {
  const source = fs.readFileSync(path.join(root, definitions[id].yaml), 'utf8');
  const maps = listBlocks(yamlSection(source, 'map_locals')).map(block => {
    const match = /^ *- match: (.+)$/m.exec(block), status = /^ +status_code: (\d+)$/m.exec(block), body = /^ +body: (.*)$/m.exec(block);
    assert.ok(match && status && body, 'Unsupported canonical Map Local source');
    const headers = {}, flow = /^ +headers: \{(.+)\}$/m.exec(block);
    if (flow) for (const entry of flow[1].split(/,\s*/)) { const at = entry.indexOf(':'); assert.ok(at > 0); headers[entry.slice(0, at)] = scalar(entry.slice(at + 1)); }
    else {
      const lines = block.split(/\r?\n/), at = lines.findIndex(line => /^ +headers:$/.test(line));
      if (at >= 0) {
        const indent = lines[at].match(/^ */)[0].length;
        for (let index = at + 1; index < lines.length; index++) {
          const line = lines[index];
          if (line.trim().startsWith('#') || !line.trim()) continue;
          if (line.match(/^ */)[0].length <= indent) break;
          const header = /^ +([\w-]+): (.+)$/.exec(line);
          assert.ok(header, 'Unsupported canonical header'); headers[header[1]] = scalar(header[2]);
        }
      }
    }
    return { match: scalar(match[1]), status_code: Number(status[1]), headers, body: scalar(body[1]) };
  });
  const hosts = [...yamlSection(source, 'mitm').matchAll(/^ +- (.+)$/gm)].map(item => scalar(item[1]));
  return { rules: listBlocks(yamlSection(source, 'rules')), map_locals: maps, mitm: { hostnames: { includes: hosts } } };
}
function commonModules() {
  return Object.entries(definitions).map(([id, definition]) => ({ id: Number(id), sgmodule: path.join(root, definition.module),
    scripts: definition.script ? [{ sourcePath: path.join(root, definition.script), canonical: definition.script }] : [] }));
}
function splitTop(value) {
  const parts = []; let begin = 0, level = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '(') level++;
    else if (c === ')') level--;
    else if (c === ',' && level === 0) { parts.push(value.slice(begin, i)); begin = i + 1; }
  }
  parts.push(value.slice(begin)); return parts;
}
function evaluateRule(expression, input) {
  const tokens = splitTop(expression), kind = tokens[0], value = String(tokens[1] || '').replace(/^"|"$/g, '');
  if (kind === 'AND' || kind === 'OR' || kind === 'NOT') {
    const children = splitTop(value.slice(1, -1)).map(child => child.slice(1, -1));
    if (kind === 'AND') return children.every(child => evaluateRule(child, input));
    if (kind === 'OR') return children.some(child => evaluateRule(child, input));
    return !children.every(child => evaluateRule(child, input));
  }
  if (kind === 'DOMAIN') return new URL(input.url).hostname === value;
  if (kind === 'DOMAIN-SUFFIX') { const host = new URL(input.url).hostname; return host === value || host.endsWith('.' + value); }
  if (kind === 'DOMAIN-KEYWORD') return new URL(input.url).hostname.includes(value);
  if (kind === 'PROTOCOL') return input.protocol === value;
  if (kind === 'DEST-PORT') return Number(input.port) === Number(value);
  if (kind === 'URL-REGEX') return new RegExp(value).test(input.url);
  if (kind === 'USER-AGENT') { const pattern = value.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'); return new RegExp('^' + pattern + '$').test(input.ua || ''); }
  throw new Error('Unexpected mock predicate ' + kind);
}
module.exports = { root, definitions, commonModules, nativeParts, sections, runSurge, runEgern, parity, text, bytes, commonContext, evaluateRule };
