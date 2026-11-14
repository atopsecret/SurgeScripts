// Node.js | 24+ | CommonJS
// Build: none; canonical standalone scripts only.
// Run: node --test hongguo/tests/canonical.test.cjs
// Deps: built-in node:test/vm; all network APIs mocked.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root, runSurge, parity, text, commonContext, commonModules, nativeParts, sections, evaluateRule } = require('../../egern/tests/canonical-fixture.cjs');
const manifest = { modules: commonModules() };
const sources = manifest.modules.map(entry => ({ id: entry.id, source: nativeParts(entry.id) }));
test('Hongguo retains exactly 78 rules and excludes public DNS/video hosts',()=>{const entry=manifest.modules.find(x=>x.id===14);const parsed=sections(entry.sgmodule);assert.equal(parsed.Rule.length,78);for(const host of ['dns.alidns.com','doh.pub','v5-reading-video.qznovelvod.com'])assert.equal(parsed.Rule.some(line=>line.split(',')[1]===host),false);assert.ok(parsed.Rule.some(line=>line.includes('v5-reading-ad.qznovelvod.com')));});
