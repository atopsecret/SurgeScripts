// Build: 无；Run: node --test xianyu/tests/egern.test.cjs；Deps: Node.js 20+
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, makeContext, moduleText, urlPatterns } = require('../../jd/tests/egern-fixture.cjs');
const script = loadScript(__dirname, '../xianyu-ad-block.egern.js');
const yaml = moduleText(__dirname, '../xianyu-adblock.egern.yaml');
const SPLASH = 'mtop.taobao.idlecommerce.splash.ads';

async function run(body, api = SPLASH, options = {}) {
    const fixture = makeContext({ body: typeof body === 'string' ? body : JSON.stringify(body), url: 'https://g-acs.m.goofish.com/gw/' + api + '/2.0/?data=redacted', ...options });
    fixture.result = await (await script)(fixture.ctx);
    assert.equal(fixture.calls.network, 0);
    assert.equal(fixture.calls.notifications.length, 0);
    return fixture;
}

for (const prefix of ['acs', 'g-acs', 'gw']) {
    for (const suffix of ['goofish', 'taobao']) {
        test('六网关开屏：' + prefix + '.m.' + suffix + '.com', async () => {
            const f = await run({ ret: ['SUCCESS::调用成功'], data: { cacheAd: 'cache-ref', item: 'keep' } }, SPLASH, { url: 'https://' + prefix + '.m.' + suffix + '.com/h5/' + SPLASH + '/2.0/' });
            assert.deepEqual(JSON.parse(f.result.body).data, { cacheAd: '', item: 'keep' });
            assert.equal(f.calls.responseReads, 1);
            assert.equal(f.response.bodyUsed, true);
        });
    }
}

test('兼容旧异步开屏并保留版本与 ret', async () => {
    const f = await run({ api: 'old', v: '1.0', ret: ['SUCCESS::调用成功'], data: { adMap: { ad: 1 }, splashList: [1], unrelated: true } }, 'mtop.taobao.idlecommerce.splash.async.ads');
    assert.deepEqual(JSON.parse(f.result.body), { api: 'old', v: '1.0', ret: ['SUCCESS::调用成功'], data: { adMap: {}, splashList: [], unrelated: true } });
});

test('cacheAdInfo、dspList 与多层广告容器清理，未知字段保留', async () => {
    const f = await run({ data: { cacheAdInfo: { secret: 'test-only' }, nested: { dspList: [1], advertising: { ad: 1 }, goods: [2] }, token: 'test-only' } });
    assert.deepEqual(JSON.parse(f.result.body).data, { nested: { dspList: [], advertising: {}, goods: [2] }, token: 'test-only' });
    assert.doesNotMatch(JSON.stringify([...f.stored.values()]), /test-only|secret|token/);
});

test('data JSON 字符串保留包装类型并改写内部开屏', async () => {
    const f = await run({ ret: ['SUCCESS::OK'], data: '{"ads":[1],"keep":true}' });
    const output = JSON.parse(f.result.body);
    assert.equal(typeof output.data, 'string');
    assert.deepEqual(JSON.parse(output.data), { ads: [], keep: true });
    assert.deepEqual(output.ret, ['SUCCESS::OK']);
});

test('顶层开屏广告引用清理', async () => {
    const f = await run({ ret: ['SUCCESS::OK'], cacheAd: 'cache-ref', data: { keep: 1 } });
    assert.deepEqual(JSON.parse(f.result.body), { ret: ['SUCCESS::OK'], cacheAd: '', data: { keep: 1 } });
});

for (const api of ['mtop.idle.idleadv.app.launch.report', 'mtop.idle.idleadv.scene.restore', 'mtop.idle.ad.expose']) {
    test('上报/场景仅清已知广告，不伪造 ret：' + api, async () => {
        const f = await run({ ret: ['SUCCESS::server'], api, v: '1.0', data: { ads: [1], other: { keep: true } } }, api);
        assert.deepEqual(JSON.parse(f.result.body), { ret: ['SUCCESS::server'], api, v: '1.0', data: { ads: [], other: { keep: true } } });
    });
}

test('悬浮策略只删除四种已知类型', async () => {
    const f = await run({ data: { strategies: [{ type: 'FLOAT_LAYER' }, { type: 'POPUP' }, { type: 'MODAL' }, { type: 'BANNER' }, { type: 'normal' }, null] } }, 'mtop.taobao.idle.user.strategy.list');
    assert.deepEqual(JSON.parse(f.result.body).data.strategies, [{ type: 'normal' }, null]);
});

test('首页追踪只删除 idleAds 前缀', async () => {
    const f = await run({ data: { circleList: [{ trackParams: { args: { idleAdsId: 1, normal: 2 } } }, null, { trackParams: { args: [] } }] } }, 'mtop.taobao.idlehome.home.circle.list');
    assert.deepEqual(JSON.parse(f.result.body).data.circleList[0].trackParams.args, { normal: 2 });
});

for (const ret of [['FAIL_SYS_SESSION_EXPIRED::登录过期'], ['SUCCESS::OK', 'FAIL::ERROR'], [], 'FAIL::ERROR', null, [null]]) {
    test('错误或陌生 ret 完整保留：' + JSON.stringify(ret), async () => {
        const body = ' ' + JSON.stringify({ ret, data: { cacheAd: 'cache-ref', ads: [1] } }) + '\n';
        const f = await run(body);
        assert.equal(f.result.body, body);
        assert.equal(f.calls.responseReads, 1);
    });
}

test('显式 success=false 原样保留', async () => {
    const body = '{"success":false,"data":{"ads":[1]}}';
    assert.equal((await run(body)).result.body, body);
});

test('错误 ret 的非 JSON data 不作解析或改写', async () => {
    const body = '{"ret":["FAIL::LOGIN"],"data":"not-json"}';
    assert.equal((await run(body)).result.body, body);
});

for (const status of [302, 403, 500]) {
    test('HTTP ' + status + ' 不读取正文', async () => {
        const f = await run({ data: { ads: [1] } }, SPLASH, { status });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const api of ['mtop.taobao.idle.message.list', 'mtop.taobao.idle.trade.list', SPLASH + '.evil']) {
    test('未知 API 不读取正文与诊断：' + api, async () => {
        const f = await run({ data: { ads: [1] } }, api);
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
        assert.equal(f.calls.sets, 0);
    });
}

for (const url of [
    'https://g-acs.m.goofish.com.evil.test/gw/' + SPLASH + '/2.0/',
    'https://g-acs.m.goofish.com@evil.test/gw/' + SPLASH + '/2.0/',
    'https://example.test/gw/' + SPLASH + '/2.0/',
    'https://g-acs.m.goofish.com/wrong/' + SPLASH + '/2.0/',
    'invalid-url'
]) {
    test('严格归属与网关路径：' + url, async () => {
        const f = await run({ data: { ads: [1] } }, SPLASH, { url });
        assert.equal(f.result, undefined);
        assert.equal(f.calls.responseReads, 0);
    });
}

for (const body of ['cb({"data":{"ads":[1]}})', '<xml>bad</xml>', '{bad', 'null', '[]', '{"data":"{bad"}']) {
    test('读取后解析失败显式返回原文：' + body, async () => {
        const f = await run(body);
        assert.equal(f.result.body, body);
        assert.equal(f.calls.responseReads, 1);
    });
}

test('未知广告字段类型不猜测', async () => {
    const body = '{ "data": {"cacheAd": 42,"ads":"goods","cacheAdInfo":null} }';
    assert.equal((await run(body)).result.body, body);
});

test('递归深度限制保留超深未知结构', async () => {
    const root = { data: {} };
    let current = root.data;
    for (let i = 0; i < 11; i++) { current.next = {}; current = current.next; }
    current.ads = [1];
    const body = JSON.stringify(root);
    assert.equal((await run(body)).result.body, body);
});

test('读取异常无通知、无网络', async () => {
    assert.equal((await run('{}', SPLASH, { readError: true })).result, undefined);
});

test('存储异常不影响正文改写', async () => {
    const f = await run({ data: { ads: [1] } }, SPLASH, { storageReadError: true, storageWriteError: true, env: { NOTIFY_ONCE: 'true' } });
    assert.deepEqual(JSON.parse(f.result.body).data.ads, []);
});

test('第二次处理保持正文且累计真实命中', async () => {
    const first = await run({ data: { cacheAd: 'cache-ref' } });
    const second = await run(first.result.body, SPLASH, { stored: first.stored });
    assert.equal(second.result.body, first.result.body);
    const state = [...second.stored.values()][0];
    assert.equal(state.hits, 2);
    assert.equal(state.cleaned, 1);
});

test('generic 诊断只打印本地状态，无存储写入', async () => {
    const f = makeContext({ generic: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.padding, 12);
    assert.equal(widget.children.length, 1);
    assert.equal(widget.children[0].type, 'text');
    assert.match(widget.children[0].text, /闲鱼原生版本：eg-native-20261105-r1/);
    assert.equal(f.calls.network, 0);
    assert.equal(f.calls.notifications.length, 0);
    assert.equal(f.calls.sets, 0);
});

test('generic 存储不可用仍返回合法 Widget', async () => {
    const f = makeContext({ generic: true, storageReadError: true });
    const widget = await (await script)(f.ctx);
    assert.equal(widget.type, 'widget');
    assert.equal(widget.children[0].type, 'text');
    assert.equal(typeof widget.children[0].text, 'string');
    assert.equal(f.calls.network, 0);
    assert.equal(f.calls.notifications.length, 0);
    assert.equal(f.calls.sets, 0);
});

test('原生模块仅匹配指定接口与创意目录，不误伤消息/商品', () => {
    const patterns = urlPatterns(yaml);
    for (const url of [
        'https://g-acs.m.goofish.com/gw/mtop.taobao.idle.message.list/1.0/',
        'https://ossgw.alicdn.com/item-video/product.mp4',
        'https://ossgw.alicdn.com.evil.test/creatives-assets/ad.mp4'
    ]) assert.equal(patterns.some(pattern => pattern.test(url)), false, url);
    assert.ok(patterns.some(pattern => pattern.test('https://g-acs.m.goofish.com/gw/' + SPLASH + '/2.0/')));
    assert.ok(patterns.some(pattern => pattern.test('https://ossgw.alicdn.com/creatives-assets/ad.mp4')));
});

test('模块默认无通知与旧入口', () => {
    assert.doesNotMatch(yaml, /NOTIFY_ONCE/);
    assert.doesNotMatch(yaml, /skernelx\/SurgeScripts|\.sgmodule/);
    assert.match(yaml, /xianyu-ad-block\.egern\.js\?v=eg-native-20261105-r1/);
});
