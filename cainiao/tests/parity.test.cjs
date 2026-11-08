// Engine | Node.js 20+ | JavaScript
// Build: node cainiao/build.mjs
// Run: node --experimental-vm-modules --test cainiao/tests/parity.test.cjs
// Deps: Node.js 内置模块、Python 3 与 PyYAML；不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { root, source, runSurge, loadNative, runNative } = require('./surge-fixture.cjs');
const nativeScript = loadNative();
const base = { data: { data: { data: { mainSearch: { bizData: { searchContents: [1], keep: true } }, operationList: [2], parcels: [{ pickupCode: 'fixture-码😀' }] }, banner: [3], activity: [4], vip: { id: 5 }, orders: [6] } } };
const expectedPage = structuredClone(base);
delete expectedPage.data.data.data.mainSearch.bizData.searchContents;
delete expectedPage.data.data.data.operationList;
const expectedCn = structuredClone(expectedPage);
delete expectedCn.data.data.banner;
delete expectedCn.data.data.activity;
delete expectedCn.data.data.vip;
const longquan = { data: { result: { placeContentMap: { '780001': { contentList: [1], title: '广告位' }, '780002': { contentList: [2] } }, keep: true } } };
const expectedLongquan = structuredClone(longquan);
delete expectedLongquan.data.result.placeContentMap['780001'].contentList;
const cases = [
    ['cn-acs fetch', 'cn-acs.m', 'mtop.cainiao.app.e2e.engine.page.fetch', base, expectedPage],
    ['cn-acs fetch.cn', 'cn-acs.m', 'mtop.cainiao.app.e2e.engine.page.fetch.cn', base, expectedPage],
    ['e2e fetch', 'e2e-mtop', 'mtop.cainiao.app.e2e.engine.page.fetch', base, expectedPage],
    ['e2e fetch.cn', 'e2e-mtop', 'mtop.cainiao.app.e2e.engine.page.fetch.cn', base, expectedCn],
    ['longquan', 'longquan-mtop', 'mtop.com.cainiao.longquan.place.getpageresourcecontent.cn', longquan, expectedLongquan],
];

for (const [name, host, api, input, expected] of cases) test('双端页面结果一致、业务字段保留与幂等：' + name, async () => {
    const url = 'https://' + host + '.cainiao.com/gw/' + api + '/1.0/?x=1';
    let body = JSON.stringify(input);
    for (let pass = 0; pass < 2; pass++) {
        const surge = runSurge({ url, body: new TextEncoder().encode(body) });
        const native = await runNative(await nativeScript, { url, body });
        const surgeBody = surge.body === undefined ? body : Buffer.from(surge.body).toString('utf8');
        assert.deepEqual(JSON.parse(surgeBody), expected);
        assert.deepEqual(JSON.parse(native.body.toString('utf8')), expected);
        assert.equal(surgeBody, native.body.toString('utf8'));
        assert.equal(native.reads, 1);
        if (pass === 1) {
            assert.equal(JSON.stringify(surge), '{}');
            assert.equal(native.output.headers, undefined);
            assert.equal(surgeBody, body);
        }
        body = surgeBody;
    }
});

test('双端对未知正文、失败状态与无效 UTF-8 保留相同字节', async () => {
    const url = 'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn';
    for (const body of [Buffer.from(' {}\n'), Buffer.from('{broken'), Buffer.from([0xff, 0x41]), Buffer.from(JSON.stringify({ success: false, ...base })), Buffer.from(JSON.stringify({ ret: ['FAIL::fixture'], ...base }))]) {
        const surge = runSurge({ url, body: new Uint8Array(body) });
        const native = await runNative(await nativeScript, { url, body });
        assert.equal(JSON.stringify(surge), '{}');
        assert.deepEqual(native.body, body);
    }
});

test('双端构建 --check 验证三个产物，缺失或过期时只报错不覆盖', () => {
    execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--check'], { timeout: 10000 });
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cainiao-build-check-'));
    try {
        for (const file of ['build.mjs', 'cainiao-policy.js', 'cainiao-adblock.runtime.in', 'cainiao-adblock.egern.runtime.in', 'cainiao-adblock.egern.yaml']) {
            fs.copyFileSync(path.join(root, file), path.join(directory, file));
        }
        const build = path.join(directory, 'build.mjs');
        const missing = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(missing.status, 1);
        assert.equal(fs.existsSync(path.join(directory, 'cainiao-adblock.js')), false);
        execFileSync(process.execPath, [build], { timeout: 10000 });
        execFileSync(process.execPath, [build, '--check'], { timeout: 10000 });
        fs.appendFileSync(path.join(directory, 'cainiao-adblock.sgmodule'), '# fixture-stale\n');
        const stale = spawnSync(process.execPath, [build, '--check'], { encoding: 'utf8', timeout: 10000 });
        assert.equal(stale.status, 1);
        assert.match(stale.stderr, /cainiao-adblock\.sgmodule/);
        assert.match(fs.readFileSync(path.join(directory, 'cainiao-adblock.sgmodule'), 'utf8'), /fixture-stale/);
        const policy = fs.readFileSync(path.join(root, 'cainiao-policy.js'), 'utf8').trim();
        assert.ok(source.includes(policy));
        assert.ok(fs.readFileSync(path.join(root, 'cainiao-adblock.egern.js'), 'utf8').includes(policy));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
