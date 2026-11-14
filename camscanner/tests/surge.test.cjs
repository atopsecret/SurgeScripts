// Node.js | 26+ | CommonJS
// Run: node --test camscanner/tests/surge.test.cjs
// Deps: built-in test/assert + local mock runtime; no HTTP or storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cam } = require('./runtime-mock.cjs');
const base = 'https://api.intsig.net/purchase/cs/query_property';
async function rewrite(body, url = base) {
    return cam({ request: { url, method: 'GET', headers: {} }, response: { status: 200, headers: {}, body } });
}
function effective(run, original) { return Object.hasOwn(run.result, 'body') ? run.result.body : original; }
function unchanged(run) { assert.deepEqual(run.plainResult, {}); assert.equal(run.calls.length, 0); assert.equal(run.writes.length, 0); }
for (const [name, url] of [
    ['primary-host', base],
    ['secondary-host', 'https://api-cs.intsig.net/purchase/cs/query_property'],
    ['explicit-443', 'https://api-cs.intsig.net:443/purchase/cs/query_property'],
    ['query-string', base + '?x=1&account=fixture'],
    ['empty-query', base + '?'],
]) test('Cam target URL ' + name, async () => {
    const input = '{"other":{"keep":[1,"yes"]},"data":{"psnl_vip_property":{"expiry":123,"level":2},"extra":"unchanged"}}';
    const result = await rewrite(input, url);
    assert.equal(result.result.body, input.replace('"expiry":123', '"expiry":"4102415999"'));
    assert.equal(result.doneCount, 1); assert.equal(result.calls.length, 0); assert.equal(result.writes.length, 0);
});
for (const [name, url] of [
    ['http', base.replace('https:', 'http:')],
    ['other-host', base.replace('api.intsig.net', 'fake.intsig.net')],
    ['host-suffix', base.replace('api.intsig.net', 'api.intsig.net.example.org')],
    ['other-port', base.replace('api.intsig.net', 'api.intsig.net:8443')],
    ['trailing-slash', base + '/'],
    ['suffix-path', base + '/anything'],
    ['fragment', base + '#fragment'],
    ['query-space', base + '?a=b c'],
    ['trailing-newline', base + '\n'],
]) test('Cam nontarget passthrough ' + name, async () => unchanged(await rewrite('{"data":{"psnl_vip_property":{"expiry":1}}}', url)));
for (const [name, input] of [
    ['object-property', '{"data":{"psnl_vip_property":{"expiry":1,"unused":{"expiry":5}}}}'],
    ['missing-expiry', '{"data":{"psnl_vip_property":{"kind":"fixture"}}}'],
    ['empty-property', '{"data":{"psnl_vip_property":{}}}'],
    ['null-property', '{"data":{"psnl_vip_property":null,"other":true}}'],
    ['missing-property', '{"data":{"other":true}}'],
    ['empty-data', '{"data":{}}'],
    ['string-expiry', '{"data":{"psnl_vip_property":{"expiry":"old"}}}'],
    ['null-expiry', '{"data":{"psnl_vip_property":{"expiry":null}}}'],
]) test('Cam jq-compatible structure ' + name, async () => {
    const run = await rewrite(input);
    const parsed = JSON.parse(effective(run, input));
    assert.equal(parsed.data.psnl_vip_property.expiry, '4102415999');
    assert.equal(typeof parsed.data.psnl_vip_property.expiry, 'string');
});
for (const [name, input] of [
    ['root-array', '[]'], ['root-null', 'null'], ['root-scalar', '7'],
    ['missing-data', '{"untouched":true}'], ['data-null', '{"data":null}'], ['data-array', '{"data":[]}'],
    ['data-string', '{"data":"x"}'], ['property-array', '{"data":{"psnl_vip_property":[]}}'],
    ['property-false', '{"data":{"psnl_vip_property":false}}'], ['property-number', '{"data":{"psnl_vip_property":12}}'],
    ['property-string', '{"data":{"psnl_vip_property":"x"}}'], ['already-correct', '{"data":{"psnl_vip_property":{"expiry":"4102415999"}}}'],
    ['malformed-json', '{bad'], ['empty-body', ''], ['truncated-string', '{"data":"unterminated}'],
]) test('Cam nonrewritable passthrough ' + name, async () => unchanged(await rewrite(input)));
test('Cam preserve large numbers, whitespace and escaped strings byte-for-byte', async () => {
    const input = ' \n{"huge":900719925474099312345,"fraction":1.230000,"escaped":"\\u4f60\\u597d","data" : {"psnl_vip_property" : { "expiry" : 1, "other":-0}}}\r\n';
    const run = await rewrite(input);
    assert.equal(run.result.body, input.replace('"expiry" : 1', '"expiry" : "4102415999"'));
});
test('Cam preserves a UTF-8 BOM and Unicode fields', async () => {
    const input = '\uFEFF{"名字":"测试🌍","data":{"psnl_vip_property":{"expiry":1}}}';
    const run = await rewrite(input);
    assert.equal(run.result.body, input.replace('"expiry":1', '"expiry":"4102415999"'));
});
test('Cam operates on the effective last duplicate key without replacing the JSON', async () => {
    const input = '{"data":null,"data":{"psnl_vip_property":{"expiry":5,"expiry":6,"other":7}}}';
    const run = await rewrite(input);
    assert.equal(run.result.body, input.replace('"expiry":6', '"expiry":"4102415999"'));
});
test('Cam preserves nested non-target expiry fields', async () => {
    const input = '{"expiry":1,"data":{"expiry":2,"psnl_vip_property":{"expiry":3,"nested":{"expiry":4}}}}';
    const run = await rewrite(input);
    assert.equal(run.result.body, input.replace('"expiry":3', '"expiry":"4102415999"'));
});
test('Cam non-string body and missing globals pass through once', async () => {
    const run = await cam({ request: { url: base }, response: { body: new Uint8Array([123, 125]) } });
    unchanged(run);
    const noGlobals = await cam();
    unchanged(noGlobals);
});
