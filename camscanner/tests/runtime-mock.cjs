// Node.js | 24+ | CommonJS
// Build: node --check camscanner/tests/runtime-mock.cjs
// Run: used by the local CamScanner response regressions.
// Deps: built-in fs/vm; every network/storage API is a mock.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const filename = path.join(__dirname, '../camscanner.surge.js');
const source = fs.readFileSync(filename, 'utf8');
async function cam(options = {}) {
  const calls = [], reads = [], writes = [], logs = [];
  let result, doneCount = 0;
  const forbidden = (kind, target) => (...args) => {
    target.push({ kind, args });
    throw Error('Forbidden mock capability: ' + kind);
  };
  const sandbox = {
    Uint8Array, ArrayBuffer,
    console: { log: (...items) => logs.push(items.map(String).join(' ')) },
    $httpClient: new Proxy({}, { get(_target, key) { return forbidden('http.' + String(key), calls); } }),
    fetch: forbidden('fetch', calls),
    $persistentStore: { read: forbidden('storage.read', reads), write: forbidden('storage.write', writes) },
    $done(value) { doneCount++; result = value; },
  };
  if (options.request) sandbox.$request = options.request;
  if (options.response) sandbox.$response = options.response;
  vm.runInNewContext(source, sandbox, { filename, timeout: 500 });
  assert.equal(doneCount, 1, 'CamScanner must finish exactly once');
  assert.equal(reads.length + writes.length + calls.length, 0, 'CamScanner uses neither network nor storage');
  return { result, plainResult: result === undefined ? undefined : JSON.parse(JSON.stringify(result)), doneCount, reads, writes, calls, logs };
}
module.exports = { cam };
