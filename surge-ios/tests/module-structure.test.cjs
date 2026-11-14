// Node.js | 26+ | CommonJS
// Run: node --test surge-ios/tests/module-structure.test.cjs
// Deps: built-in fs/vm/test/assert; source metadata only, no network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { publishRoot: root, fixtureRoot } = require('./layout.cjs');
const sourceRoot = path.join(fixtureRoot, 'camscanner-nio');
const camModule = fs.readFileSync(path.join(root, 'modules/camscanner-ios.sgmodule'), 'utf8');
const nioModule = fs.readFileSync(path.join(root, 'modules/nio-ios.sgmodule'), 'utf8');
const camSource = fs.readFileSync(path.join(sourceRoot, '02.matchers.yaml'), 'utf8');
const nioSource = fs.readFileSync(path.join(sourceRoot, '16.matchers.yaml'), 'utf8');
function scripts(module) { return module.split(/\r?\n/).filter(line => /^ios-.*=\s*type=/.test(line)); }
function pattern(line) { return line.match(/pattern=(.*?),(?:requires-body|engine|timeout|script-path)=/)[1]; }
test('Cam module retains the exact source matcher', () => {
    const matcher = camSource.match(/match: '([^']+)'/)[1];
    assert.equal(pattern(scripts(camModule)[0]), matcher);
    assert.match(camModule, /hostname = %APPEND% api\.intsig\.net, api-cs\.intsig\.net/);
});
test('NIO capture and observation retain both exact source matchers', () => {
    const matchers = [...nioSource.matchAll(/match: '([^']+)'/g)].map(item => item[1]);
    const lines = scripts(nioModule);
    assert.equal(pattern(lines[0]), matchers[0]); assert.equal(pattern(lines[1]), matchers[1]);
});
test('NIO module supplies all four entries with one deployed script path', () => {
    const lines = scripts(nioModule);
    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map(line => line.match(/type=([^,]+)/)[1]), ['http-request', 'http-response', 'cron', 'generic']);
    assert.equal(new Set(lines.map(line => line.match(/script-path=([^,\s]+)/)[1])).size, 1);
});
test('NIO response binary body and size limits match the source', () => {
    const lines = scripts(nioModule);
    assert.match(lines[0], /requires-body=false/);
    assert.match(lines[1], /requires-body=true,binary-body-mode=true,max-size=262144/);
    assert.match(lines[1], /timeout=5/);
});
test('NIO preserves 09:00 cron with documented Surge engine and wake options', () => {
    const cron = scripts(nioModule)[2];
    assert.match(cron, /cronexp="0 9 \* \* \*"/);
    assert.match(cron, /wake-system=1/); assert.match(cron, /engine=webview,timeout=30/);
    assert.equal(nioModule.includes('js-engine'), false);
});
test('Modules contribute only Script and appended MITM hostnames', () => {
    for (const module of [camModule, nioModule]) {
        assert.deepEqual([...module.matchAll(/^\[([^\]]+)\]/gm)].map(item => item[1]), ['Script', 'MITM']);
        assert.equal(/ca-p12|ca-passphrase|\[Module\]|\[Proxy\]|\[General\]/i.test(module), false);
        assert.match(module, /hostname = %APPEND%/);
    }
});
test('Final assets are standalone scripts without old runtime symbols', () => {
    for (const name of ['camscanner-expiry-ios.js', 'nio-auto-checkin-ios.js']) {
        const source = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
        assert.equal(/\bctx\b|^\s*(?:export|import)\s|weilai_egern_/m.test(source), false);
        assert.equal(/TextDecoder|TextEncoder|fetch\(/.test(source), false);
        new vm.Script(source, { filename: name });
    }
});
test('All script names and deployment paths use the agreed namespace', () => {
    for (const line of scripts(camModule).concat(scripts(nioModule))) {
        assert.match(line, /^ios-/);
        assert.match(line, /script-path=https:\/\/raw\.githubusercontent\.com\/atopsecret\/SurgeScripts\/main\/surge-ios\/scripts\/(?:camscanner|nio)-[A-Za-z0-9-]+\.js$/);
    }
});
test('Cam changes only the expiry string and has no HTTP/storage capability', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/camscanner-expiry-ios.js'), 'utf8');
    assert.equal(source.includes('$httpClient'), false); assert.equal(source.includes('$persistentStore'), false);
    assert.match(source, /4102415999/); assert.equal(source.includes('2033'), false);
});
test('Source deployment fixture includes only IDs 2 and 16 and correct remote assets', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'modules.json'), 'utf8'));
    assert.deepEqual(manifest.modules.map(module => module.id), [2, 16]);
    assert.equal(manifest.modules[1].entries.length, 4);
    for (const asset of manifest.assets) {
        assert.match(asset.destination, /^https:\/\/raw\.githubusercontent\.com\/atopsecret\/SurgeScripts\/main\/surge-ios\/scripts\//);
        assert.equal(fs.existsSync(path.join(root, asset.source)), true);
    }
});
