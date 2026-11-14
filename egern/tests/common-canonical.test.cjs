// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test egern/tests/common-canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('./canonical-fixture.cjs');
test('Manual diagnostics are local only and never create widgets',()=>{for(const id of [6,10,11,12,13]){const result=runSurge(id,null,'');assert.equal(Object.keys(result.result).length,0);assert.ok(result.logs.length);assert.equal(result.logs.some(line=>line.includes('type":"widget')),false);}});
const manifest = { modules: commonModules() };
const sources = manifest.modules.map(entry => ({ id: entry.id, source: nativeParts(entry.id) }));
test('Static rule/Map Local counts equal all seven active Egern sources',()=>{for(const entry of manifest.modules){const source=sources.find(x=>x.id===entry.id).source;const parsed=sections(entry.sgmodule);assert.equal((parsed.Rule||[]).length,(source.rules||[]).length);assert.equal((parsed['Map Local']||[]).length,(source.map_locals||[]).length);}});
test('Every Map Local preserves source status, headers and exact bytes',()=>{for(const entry of manifest.modules){const source=sources.find(x=>x.id===entry.id).source;const maps=sections(entry.sgmodule)['Map Local']||[];for(const [index,item]of(source.map_locals||[]).entries()){const line=maps[index];assert.equal(line.slice(0,line.indexOf(' data-type=')),item.match);const data=/data="([^"]*)"/.exec(line)[1];assert.equal(Buffer.from(data,'base64').toString('utf8'),item.body||'');assert.ok(line.includes('status-code='+item.status_code));for(const [key,value]of Object.entries(item.headers||{}))assert.ok(line.includes(`${key}:${value}`));}}});
test('Remote module paths and no runtime Egern/native widget remnants',()=>{const names=[];for(const entryof of manifest.modules){const parsed=sections(entryof.sgmodule);assert.equal(Object.hasOwn(parsed,'Module'),false);for(const line of parsed.Script||[]){names.push(line.split('=')[0].trim());const remote = new URL(line.match(/script-path=([^,\s]+)/)[1]);assert.equal(remote.origin,'https://raw.githubusercontent.com');assert.equal(remote.pathname,'/atopsecret/SurgeScripts/main/'+entryof.scripts[0].canonical);assert.equal(/\/(?:Users|home)\//.test(line),false);assert.equal(line.includes('127.0.0.1'),false);}for(const script of entryof.scripts){const code=fs.readFileSync(script.sourcePath,'utf8');assert.equal(/export default|ctx\.(request|response|storage)|type:\s*["']widget/.test(code),false);}}assert.equal(new Set(names).size,names.length);assert.ok(names.every(name=>!name.startsWith('ios-')));});
