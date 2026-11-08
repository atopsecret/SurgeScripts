// Engine | Node.js 20+ | JavaScript
// Build: node jd/build.mjs
// Run: node --test jd/tests/parity.test.cjs
// Deps: Node.js 内置模块；合成数据，不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const { loadScript, makeContext } = require('./egern-fixture.cjs');
const root = path.resolve(__dirname, '..');
const surge = fs.readFileSync(path.join(root, 'jd-ad-block.js'), 'utf8');
const native = loadScript(root, 'jd-ad-block.egern.js');
const text = value => typeof value === 'string' ? value : Buffer.from(value).toString();

const cases = [
    ['start', { images: [1], showTimesDaily: 3, keep: true }, { images: [], showTimesDaily: 0, keep: true }],
    ['welcomeHome', { floorList: [null, { type: 'float' }, { type: 'goods' }], webViewFloorList: [1] }, { floorList: [null, { type: 'goods' }], webViewFloorList: [] }],
    ['deliverLayer', { bannerInfo: {}, floors: [{ mId: 'banner' }, { mId: 'tracking' }] }, { floors: [{ mId: 'tracking' }] }],
    ['orderTrackBusiness', { bannerInfo: {}, floors: [{ mId: 'jdDeliveryBanner' }, { mId: 'tracking' }] }, { floors: [{ mId: 'tracking' }] }],
    ['basicConfig', { data: { JDHttpToolKit: { httpdns: { httpdns: 1 } } }, keep: true }, { data: { JDHttpToolKit: { httpdns: { httpdns: 0 } } }, keep: true }],
    ['cart', { cartLocationMap: { loc_emptyCartFloor2: {}, goods: [1] }, emptyCartRecommendFloor: {}, keep: true }, { cartLocationMap: { goods: [1] }, keep: true }],
    ['secondFloor', { data: { recommendFloor: {}, weather: 'fixture' } }, { data: { weather: 'fixture' } }],
    ['lite_advertising', { title: 'jdLiteAdvertisingVO', nested: { jdLiteAdvertisingVO: [1] } }, { title: 'jdLiteAdvertisingVO', nested: { sooyaaabo: [1] } }],
    ['readCustomSurfaceList', { result: { modeMap: { normal: { navigationAll: ['index', 'future', 'video', 'cart', 'home'].map(functionId => ({ functionId })) } } } }, { result: { modeMap: { normal: { navigationAll: ['index', 'future', 'cart', 'home'].map(functionId => ({ functionId })) } } } }],
    ['getTabHomeInfo', { result: { iconInfo: {}, roofTop: {}, products: [1] } }, { result: { products: [1] } }],
    ['myOrderInfo', { floors: [{ mId: 'plusFloor' }, { mId: 'orders' }, { mId: 'future' }] }, { floors: [{ mId: 'orders' }, { mId: 'future' }] }],
    ['personinfoBusiness', { floors: [{ mId: 'newsFloor' }, { mId: 'newWalletIdFloor', data: { keep: true } }] }, { floors: [{ mId: 'newWalletIdFloor', data: { keep: true } }] }],
];

for (const [api, input, expected] of cases) test('双端协议一致与幂等：' + api, async () => {
    const url = 'https://api.m.jd.com/client.action?client=ios&functionId=' + api;
    let body = JSON.stringify(input);
    for (let pass = 0; pass < 2; pass++) {
        const f = makeContext({ body, url });
        const output = await (await native)(f.ctx);
        const done = [];
        vm.runInNewContext(surge, { URL, Uint8Array, TextEncoder, $request: { url, method: 'GET' },
            $response: { status: 200, body: new TextEncoder().encode(body), headers: [{ field: 'Content-Type', value: 'application/json' }] },
            $persistentStore: { read() { throw Error('查询分发不应读 POST 缓存'); } }, $done: value => done.push(value), console: { log() {} } }, { timeout: 1000 });
        assert.equal(done.length, 1);
        const surgeBody = Object.prototype.hasOwnProperty.call(done[0], 'body') ? text(done[0].body) : body;
        assert.deepEqual(JSON.parse(surgeBody), expected);
        assert.deepEqual(JSON.parse(text(output.body)), expected);
        assert.equal(f.calls.responseReads, 1);
        assert.equal(f.calls.network, 0);
        assert.equal(f.calls.notifications.length, 0);
        if (pass === 1) {
            assert.equal(output.headers, undefined);
            assert.equal(surgeBody, body);
            assert.deepEqual(Buffer.from(output.body), Buffer.from(body));
        }
        body = surgeBody;
    }
});

test('构建 --check 检出缺失与过期产物，不覆盖检查目录', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-build-check-'));
    try {
        for (const file of ['build.mjs', 'jd-policy.js', 'jd-ad-block.runtime.in', 'jd-ad-block.egern.runtime.in', 'jd-post-capture.runtime.in', 'jd-adblock.sgmodule', 'jd-adblock.egern.yaml']) fs.copyFileSync(path.join(root, file), path.join(directory, file));
        const build = path.join(directory, 'build.mjs');
        const missing = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(missing.status, 1);
        assert.equal(fs.existsSync(path.join(directory, 'jd-ad-block.js')), false);
        execFileSync(process.execPath, [build], { timeout: 10000 });
        execFileSync(process.execPath, [build, '--check'], { timeout: 10000 });
        fs.appendFileSync(path.join(directory, 'jd-ad-block.js'), '// fixture-stale\n');
        const stale = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(stale.status, 1);
        assert.match(fs.readFileSync(path.join(directory, 'jd-ad-block.js'), 'utf8'), /fixture-stale/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
