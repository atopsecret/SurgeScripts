// Engine | Node.js 20+ | JavaScript
// Build: node cainiao/build.mjs
// Run: node --test cainiao/tests/surge.test.cjs
// Deps: Node.js 内置模块、Python 3 与 PyYAML；不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readModule, rejects } = require('./rules-fixture.cjs');
const { source, section, readSurgeModule, runSurge } = require('./surge-fixture.cjs');

const bare = value => assert.equal(JSON.stringify(value), '{}');
const data = { data: { data: { banner: [1], parcels: [{ pickupCode: 'fixture-取件码😀' }] } } };
const body = JSON.stringify(data);
const decode = value => Buffer.from(value).toString('utf8');

test('Surge 二进制改写保留多值响应头和顺序，清除旧正文头', () => {
    const headers = [
        { field: 'Content-Type', value: 'application/json' }, { field: 'Content-Length', value: '999' },
        { field: 'Content-Encoding', value: 'gzip' }, { field: 'ETag', value: 'old' },
        { field: 'Digest', value: 'old' }, { field: 'Content-Digest', value: 'old' },
        { field: 'Set-Cookie', value: 'a=1' }, { field: 'X-Keep', value: 'business' },
        { field: 'Set-Cookie', value: 'b=2' },
    ];
    const before = JSON.stringify(headers);
    const output = runSurge({ body: new TextEncoder().encode(body), headers });
    assert.deepEqual(JSON.parse(decode(output.body)), { data: { data: { parcels: data.data.data.parcels } } });
    assert.deepEqual(output.headers.slice(0, 3), headers.slice(6));
    for (const field of ['content-length', 'content-encoding', 'etag', 'digest', 'content-digest']) {
        assert.equal(output.headers.some(row => row.field.toLowerCase() === field), false, field);
    }
    assert.equal(output.headers.find(row => row.field === 'X-Cainiao-Cleaner-Version').value, '1.2.0');
    assert.equal(JSON.stringify(headers), before);
});

test('Surge 对象式头保留 Cookie 数组，字符串正文也可处理', () => {
    const headers = { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'], 'X-Business': 'keep', ETag: 'old' };
    const output = runSurge({ body, headers });
    assert.deepEqual(output.headers['Set-Cookie'], ['a=1', 'b=2']);
    assert.equal(output.headers['X-Business'], 'keep');
    assert.equal(output.headers.ETag, undefined);
    assert.equal(output.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.parse(decode(output.body)).data.data.banner, undefined);
    assert.equal(headers.ETag, 'old');
});

test('Surge 未知结构、标量容器、业务失败和非 JSON 保留原响应', () => {
    for (const input of [
        '{}', '[]', 'null', '', '{broken', '\ufeff' + body,
        JSON.stringify({ data: { data: { banner: 'future', activity: null, vip: 1 } } }),
        JSON.stringify({ success: false, ...data }),
        JSON.stringify({ code: '605', ...data }),
        JSON.stringify({ ret: ['FAIL_SYS_SESSION_EXPIRED::fixture'], ...data }),
        JSON.stringify({ ret: null, ...data }),
    ]) bare(runSurge({ body: input }));
});

test('Surge 非 200、非 JSON 与不支持的 charset 不读取正文', () => {
    const unread = () => { assert.fail('被保护的响应不应读取正文'); };
    for (const status of [201, 204, 206, 302, 403, 500]) bare(runSurge({ status, bodyGetter: unread }));
    for (const type of ['text/html', 'application/octet-stream', 'application/jsonp', 'application/json; charset=gbk']) {
        bare(runSurge({ headers: [{ field: 'Content-Type', value: type }], bodyGetter: unread }));
    }
});

test('Surge 主机、完整 API、凭据和数值版本边界与 Egern 相同', () => {
    for (const url of [
        'https://e2e-mtop.cainiao.com.evil.test/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn',
        'https://user@e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn',
        'http://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn',
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cnx',
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/v1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.mine.main/1.0/',
    ]) bare(runSurge({ url, bodyGetter() { assert.fail('非目标路由不应读取正文'); } }));
    assert.ok(runSurge({ url: 'https://e2e-mtop.cainiao.com:443/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0/?x=1', body }).body);
});

test('Surge 无效 UTF-8 和不支持的正文类型保留，支持 ArrayBuffer 与字节视图', () => {
    for (const bytes of [[0xff], [0xc0, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80]]) {
        bare(runSurge({ body: new Uint8Array(bytes) }));
    }
    for (const value of [undefined, null, 123, {}]) bare(runSurge({ body: value }));
    const bytes = new TextEncoder().encode(body);
    for (const value of [bytes.buffer, new DataView(bytes.buffer)]) {
        assert.equal(JSON.parse(decode(runSurge({ body: value }).body)).data.data.banner, undefined);
    }
});

test('Surge 上下文、正文或响应头异常也只完成一次且不伪造空体', () => {
    bare(runSurge({ noRequest: true }));
    bare(runSurge({ noResponse: true }));
    bare(runSurge({ bodyGetter() { throw Error('body-failed'); } }));
    const headers = new Proxy({}, { ownKeys() { throw Error('headers-failed'); } });
    bare(runSurge({ body, headers }));
});

test('Surge 模块五类 404 的正负边界及空正文与 Egern 一致', () => {
    const native = readModule();
    const lines = section('Map Local');
    assert.equal(lines.length, 5);
    assert.deepEqual(lines.map(line => line.split(' data-type=')[0]), native.map_locals.map(row => row.match));
    assert.ok(lines.every(line => line.includes('data="" status-code=404')));
    const match = url => lines.some(line => new RegExp(line.split(' data-type=')[0]).test(url));
    assert.equal(match('https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index/1.0/?x=1'), true);
    assert.equal(match('https://cn-acs.m.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.show/2'), true);
    assert.equal(match('https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index.cn/1.0'), true);
    assert.equal(match('https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.mshow.cn/1.0'), true);
    assert.equal(match('https://cn-acs.m.cainiao.com/gw/mtop.cainiao.adx.flyad.getad.cn/1.0'), true);
    assert.equal(match('https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.future/1.0/'), false);
    assert.equal(match('https://nbcps-mtop.cainiao.com.evil.test/gw/mtop.cainiao.nbcps.presentation.fetch.cn'), false);
});

test('Surge 20 条原生规则解析后与 Egern 完全一致，含 QUIC 与嵌套 UA 条件', () => {
    const native = readModule();
    const surge = readSurgeModule();
    assert.equal(surge.rules.length, 20);
    assert.deepEqual(surge.rules, native.rules);
    const images = [
        'https://p3-sign.douyinpic.com/tos-cn-p-0051-ce/ok2sNqJ87HJEDO6BEAI5EftfgaHwlFEDB0oBkD~tplv-noop.image',
        'https://p3-sign.douyinpic.com/tos-cn-p-0051/ooEkIBANmMqcAhB1Oizkf23JLm4B4iMQhuh3AA~tplv-noop.image',
        'https://p3-sign.douyinpic.com/tos-cn-p-0051/fixtureRotatedCreative_A-1~tplv-noop.image?x-signature=fixture',
        'https://a1.alibabausercontent.com/prod/feupload/user/7clgu/fixture-rotated.mp4_.mp4',
        'https://ossgw.alicdn.com/creatives-assets/prod/feupload/user/7clgu/fixture-rotated.jpg',
    ];
    for (const image of images) {
        for (const ua of ['Cainiao4iPhone/fixture', 'TBIOS/Native com.cainiao.cnwireless fixture']) {
            assert.equal(rejects(surge, image, ua), true, image);
        }
        assert.equal(rejects(surge, image, 'Douyin/fixture'), false, image);
    }
    assert.equal(rejects(surge, 'https://p3-sign.douyinpic.com/tos-cn-p-0051/photo.jpg', 'Cainiao4iPhone/fixture'), false);
    for (const host of native.mitm.hostnames.includes) {
        assert.equal(rejects(surge, 'https://' + host + '/', '', 'quic'), true);
        assert.equal(rejects(surge, 'https://' + host + '/', '', 'tcp'), false);
    }
    assert.equal(rejects(surge, 'https://guoguouser.cainiao.com/', '', 'quic'), false);
});

test('Surge 模块启用二进制正文与多值头，九个精确 MITM 主机齐全', () => {
    const native = readModule();
    const scripts = section('Script');
    assert.equal(scripts.length, 1);
    for (const option of ['requires-body=true', 'binary-body-mode=true', 'full-header-mode=true', 'engine=webview', 'max-size=2097152', 'script-update-interval=3600']) {
        assert.ok(scripts[0].includes(option), option);
    }
    assert.ok(scripts[0].includes('cainiao-adblock.js?v=1.2.0'));
    const pattern = scripts[0].split(',pattern=')[1].split(',requires-body=')[0];
    assert.equal(pattern, native.scriptings[0].http_response.match);
    const hosts = section('MITM')[0].replace('hostname = %APPEND% ', '').split(', ');
    assert.deepEqual(new Set(hosts), new Set(native.mitm.hostnames.includes));
    assert.doesNotMatch(source, /\bimport\b|\bexport\b|\bctx\./);
});
