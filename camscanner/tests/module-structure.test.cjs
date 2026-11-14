// Node.js | 24+ | CommonJS
// Build: node --check camscanner/camscanner.surge.js
// Run: node --test camscanner/tests/module-structure.test.cjs
// Deps: built-in fs/vm/test/assert; canonical files only, no network.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const moduleText = fs.readFileSync(path.join(root, 'camscanner.sgmodule'), 'utf8');
const native = fs.readFileSync(path.join(root, 'camscanner.egern.yaml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'camscanner.surge.js'), 'utf8');
const scripts = moduleText.split(/\r?\n/).filter(line => !line.startsWith('#') && / = type=/.test(line));
const remote = 'https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/camscanner/camscanner.surge.js';
test('Cam module retains the exact source matcher', () => {
  assert.equal(scripts.length, 1);
  const matcher = native.match(/match: '([^']+)'/)[1];
  assert.equal(scripts[0].match(/pattern=(.*?),requires-body=/)[1], matcher);
  assert.match(moduleText, /hostname = %APPEND% api\.intsig\.net, api-cs\.intsig\.net/);
});
test('Cam module contributes only Script and appended MITM hostnames', () => {
  assert.deepEqual([...moduleText.matchAll(/^\[([^\]]+)\]/gm)].map(item => item[1]), ['Script', 'MITM']);
  assert.equal(/ca-p12|ca-passphrase|\[Module\]|\[Proxy\]|\[General\]/i.test(moduleText), false);
});
test('Cam final asset is a standalone script without native runtime symbols', () => {
  assert.equal(/\bctx\b|^\s*(?:export|import)\s|weilai_egern_/m.test(source), false);
  assert.equal(/TextDecoder|TextEncoder|fetch\(/.test(source), false);
  new vm.Script(source, { filename: 'camscanner.surge.js' });
});
test('Cam script name and deployment path use the canonical feature directory', () => {
  assert.match(scripts[0], /^扫描全能王到期改写 = type=http-response,/);
  const url = new URL(scripts[0].match(/script-path=([^,\s]+)/)[1]);
  assert.equal(url.origin + url.pathname, remote);
  assert.equal(url.searchParams.get('v'), '1.0.1');
  for (const option of ['requires-body=true', 'binary-body-mode=false', 'max-size=1048576', 'engine=jsc', 'timeout=5']) assert.ok(scripts[0].includes(option));
});
test('Cam changes only the expiry string and has no HTTP/storage capability', () => {
  assert.equal(source.includes('$httpClient'), false);
  assert.equal(source.includes('$persistentStore'), false);
  assert.match(source, /4102415999/);
  assert.equal(source.includes('2033'), false);
});
test('Cam deployed asset resolves directly to its canonical standalone file', () => {
  const url = new URL(scripts[0].match(/script-path=([^,\s]+)/)[1]);
  const relative = url.pathname.slice('/atopsecret/SurgeScripts/main/'.length);
  assert.equal(relative, 'camscanner/camscanner.surge.js');
  assert.equal(fs.readFileSync(path.resolve(root, '..', relative), 'utf8'), source);
  assert.equal(/\/surge-ios\/|\/(?:Users|home)\/|127\.0\.0\.1/.test(moduleText), false);
  assert.match(moduleText, /#!name=扫描全能王\n/);
});
