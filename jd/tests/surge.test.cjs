// Engine | Node.js 20+ | JavaScript
// Build: node jd/build.mjs
// Run: node --test jd/tests/surge.test.cjs
// Deps: Node.js 内置模块；仅执行本地 Surge 脚本，不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const responseSource = fs.readFileSync(path.join(root, 'jd-ad-block.js'), 'utf8');
const requestSource = fs.readFileSync(path.join(root, 'jd-post-capture.js'), 'utf8');
const moduleText = fs.readFileSync(path.join(root, 'jd-adblock.sgmodule'), 'utf8');

function storeHarness(initial = [], options = {}) {
    const pendingKey = 'skernelx_jd_pending_v2';
    const values = new Map([[pendingKey, JSON.stringify(initial)]]);
    return {
        read(key = pendingKey) { if (options.readThrows) throw Error('storage-read'); return values.get(key) || null; },
        write(value, key = pendingKey) { if (options.writeThrows) throw Error('storage-write'); values.set(key, value); return true; },
        list() { return JSON.parse(values.get(pendingKey)); },
    };
}
function execute(source, globals, store = storeHarness()) {
    const done = [];
    const context = {
        ...globals,
        Uint8Array,
        TextEncoder,
        URL,
        console: { log() {} },
        $persistentStore: store,
        $done(value) { done.push(value); },
    };
    vm.runInNewContext(source, context, { timeout: 1000 });
    assert.equal(done.length, 1, '脚本必须恰好调用一次 $done');
    return { output: done[0], store };
}
function response(options = {}, store) {
    const body = options.body instanceof Uint8Array ? options.body : new TextEncoder().encode(String(options.body || ''));
    return execute(responseSource, {
        $request: { url: options.url || 'https://api.m.jd.com/client.action?functionId=start', method: options.method || 'GET', id: options.id, headers: options.requestHeaders || {} },
        $response: { status: options.status === undefined ? 200 : options.status, body, headers: options.headers || [{ field: 'Content-Type', value: 'application/json; charset=utf-8' }] },
    }, store);
}
function request(options = {}, store) {
    return execute(requestSource, {
        $request: { url: options.url || 'https://api.m.jd.com/client.action', method: options.method || 'POST', id: options.id, body: options.body, headers: options.headers || { 'Content-Type': 'application/x-www-form-urlencoded' } },
    }, store);
}
function decode(value) { return new TextDecoder().decode(value instanceof Uint8Array ? value : new TextEncoder().encode(value)); }
function assertBare(value) { assert.equal(JSON.stringify(value), '{}'); }

test('Surge 二进制响应改写、full-header 多值头顺序和旧头清理', () => {
    const headers = [
        { field: 'Content-Length', value: '999' }, { field: 'Content-Encoding', value: 'gzip' },
        { field: 'ETag', value: 'old' }, { field: 'Set-Cookie', value: 'a=1' },
        { field: 'Set-Cookie', value: 'b=2' }, { field: 'X-Keep', value: 'yes' },
    ];
    const result = response({ body: '{"images":[1],"keep":true}', headers });
    assert.deepEqual(JSON.parse(decode(result.output.body)), { images: [], keep: true });
    assert.deepEqual(result.output.headers.filter(item => item.field === 'Set-Cookie'), headers.slice(3, 5));
    assert.equal(result.output.headers.some(item => item.field.toLowerCase() === 'content-length'), false);
    assert.equal(result.output.headers.find(item => item.field === 'X-Keep').value, 'yes');
    assert.equal(result.output.headers.find(item => item.field === 'X-JD-Cleaner-Version').value, '2.0.0');
});

test('Surge 查询参数位置、值边界、重复和编码键策略', () => {
    const normal = response({ url: 'https://api.m.jd.com/client.action?client=ios&functionId=start&v=1', body: '{"images":[1]}' });
    assert.deepEqual(JSON.parse(decode(normal.output.body)).images, []);
    for (const url of [
        'https://api.m.jd.com/client.action?functionId=start&functionId=cart',
        'https://api.m.jd.com/client.action?functionId=start&functionId',
        'https://api.m.jd.com/client.action?%66unctionId=start',
        'https://api.m.jd.com/client.action?functionId=start_extra',
    ]) assertBare(response({ url, body: '{"images":[1]}' }).output);
});

test('Surge 策略覆盖四个新增接口且未知业务工具保留', () => {
    const cases = [
        ['getTabHomeInfo', { result: { iconInfo: {}, roofTop: {}, keep: 1 } }, value => value.result.keep === 1 && !value.result.iconInfo],
        ['orderTrackBusiness', { bannerInfo: {}, floors: [{ mId: 'banner' }, { mId: 'track' }] }, value => !value.bannerInfo && value.floors.length === 1],
        ['myOrderInfo', { floors: [{ mId: 'bannerFloor' }, { mId: 'orders' }, { mId: 'future' }] }, value => value.floors.map(item => item.mId).join(',') === 'orders,future'],
        ['personinfoBusiness', { floors: [{ mId: 'newsFloor' }, { mId: 'userinfo', data: { newPlusBlackCard: {}, wallet: 1 } }, { mId: 'unknown' }] }, value => value.floors.length === 2 && !value.floors[0].data.newPlusBlackCard],
    ];
    for (const [id, input, verify] of cases) assert.equal(verify(JSON.parse(decode(response({ url: 'https://api.m.jd.com/client.action?functionId=' + id, body: JSON.stringify(input) }).output.body))), true, id);
});

test('可选 POST 请求捕获默认不启用；启用时按稳定 request.id 关联', () => {
    const active = moduleText.split('\n').filter(line => !line.trimStart().startsWith('#'));
    assert.equal(active.some(line => line.includes('type=http-request')), false);
    assert.match(moduleText, /# 京东去广告 POST 关联 = type=http-request/);
    const store = storeHarness();
    assertBare(request({ id: undefined, body: 'functionId=start' }, store).output);
    assertBare(request({ id: 'req-1', body: 'client=ios&functionId=start' }, store).output);
    assert.deepEqual(store.list().map(item => item.api), ['start']);
    const linked = response({ id: 'req-1', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store);
    assert.deepEqual(JSON.parse(decode(linked.output.body)).images, []);
    assert.deepEqual(store.list(), []);
    assertBare(response({ id: 'req-other', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store).output);
});

test('POST 捕获拒绝重复/编码键，TTL、容量和存储异常均保守放行', () => {
    const store = storeHarness();
    for (const body of ['functionId=start&functionId=cart', '%66unctionId=start', '{"functionId":"start","functionId":"cart"}', '{"functionId":"start","funct\\u0069onId":"cart"}']) {
        request({ id: 'bad-' + body.length, body }, store);
    }
    assert.deepEqual(store.list(), []);
    const expired = storeHarness([{ requestId: 'old', api: 'start', expires: Date.now() - 1 }]);
    assertBare(response({ id: 'old', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, expired).output);
    const full = storeHarness();
    for (let i = 0; i < 70; i++) request({ id: 'r' + i, body: 'functionId=start' }, full);
    assert.equal(full.list().length, 64);
    assertBare(request({ id: 'write-error', body: 'functionId=start' }, storeHarness([], { writeThrows: true })).output);
});

test('Surge 非200、非JSON/charset与异常主机精确放行', () => {
    for (const status of [201, 204, 206, 302, 403, 500]) assertBare(response({ body: '{"images":[1]}', status }).output);
    for (const type of ['application/json; charset=gbk', 'application/octet-stream', 'text/html']) {
        assertBare(response({ body: '{"images":[1]}', headers: [{ field: 'CoNtEnT-TyPe', value: type }] }).output);
    }
    for (const url of [
        'https://api.m.jd.com.evil.test/client.action?functionId=start',
        'https://user@api.m.jd.com/client.action?functionId=start',
        'ftp://api.m.jd.com/client.action?functionId=start',
        'https://api.m.jd.com/client.action-extra?functionId=start',
    ]) assertBare(response({ body: '{"images":[1]}', url }).output);
    for (const ret of ['FAIL::LOGIN', null, {}, [false], ['FAIL::LOGIN']]) assertBare(response({ body: JSON.stringify({ ret, images: [1] }) }).output);
});

test('POST 转义JSON键、请求隔离、删除失败和缺失请求ID不猜测', () => {
    const store = storeHarness();
    request({ id: 'one', body: '{"funct\\u0069onId":"start"}' }, store);
    request({ id: 'two', body: 'functionId=cart' }, store);
    assert.deepEqual(store.list().map(item => [item.requestId, item.api]), [['one', 'start'], ['two', 'cart']]);
    const one = response({ id: 'one', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store);
    assert.deepEqual(JSON.parse(decode(one.output.body)).images, []);
    assert.deepEqual(store.list().map(item => item.requestId), ['two']);
    const two = response({ id: 'two', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"emptyCartRecommendFloor":{},"orders":[1]}' }, store);
    assert.deepEqual(JSON.parse(decode(two.output.body)), { orders: [1] });
    const blockedDelete = storeHarness([{ requestId: 'delete-error', api: 'start', expires: Date.now() + 60000 }], { writeThrows: true });
    assertBare(response({ id: 'delete-error', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, blockedDelete).output);
    assertBare(response({ url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store).output);
});

test('静态规则允许非首参数、显式推荐变体并拒绝前缀误匹配和重复键', () => {
    const local = moduleText.split('[Map Local]')[1].split('[MITM]')[0].split('\n').filter(line => line.startsWith('^')).map(line => new RegExp(line.split(' data-type=')[0]));
    const matching = url => local.some(pattern => pattern.test(url));
    assert.equal(matching('https://api.m.jd.com/client.action?client=ios&functionId=uniformRecommend0'), true);
    assert.equal(matching('https://api.m.jd.com/client.action?functionId=uniformRecommend6&v=1'), true);
    assert.equal(matching('https://api.m.jd.com/client.action?functionId=uniformRecommendation'), false);
    assert.equal(matching('https://api.m.jd.com/client.action?functionId=queryMaterialAdverts&functionId=search'), false);
    assert.equal(matching('https://api.m.jd.com/client.action?%66unctionId=queryMaterialAdverts'), false);
    assert.equal(matching('https://api.m.jd.com/client.action?functionId=queryMaterialAdverts&functionId'), false);
    assert.equal(matching('https://api.m.jd.com/client.action?functionId&functionId=queryMaterialAdverts'), false);
    assert.equal(matching('https://api.m.jd.com/client.action?body=a%3D=fixture&functionId=queryMaterialAdverts'), true);
});

test('Surge 不让 GET 或未知请求消费 POST 缓存，读取失败保持原存储', () => {
    const store = storeHarness();
    request({ id: 'post-only', body: 'returnUrl=https://example.test/path&functionId=start' }, store);
    assertBare(response({ id: 'post-only', method: 'GET', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store).output);
    assert.equal(store.list().length, 1);
    const output = response({ id: 'post-only', method: 'POST', url: 'https://api.m.jd.com/client.action', body: '{"images":[1]}' }, store).output;
    assert.deepEqual(JSON.parse(decode(output.body)).images, []);
    const unreadable = storeHarness([{ requestId: 'keep', api: 'cart', expires: Date.now() + 30000 }], { readThrows: true });
    request({ id: 'new', body: 'functionId=start' }, unreadable);
    assert.deepEqual(unreadable.list().map(row => row.requestId), ['keep']);
});
