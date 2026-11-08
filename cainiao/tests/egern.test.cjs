// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --experimental-vm-modules --test cainiao/tests/egern.test.cjs
// Deps: Node.js 内置模块；不联网
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'cainiao-adblock.egern.js'), 'utf8');
const yaml = JSON.parse(execFileSync('python3', ['-c', 'import json,yaml,sys; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))', path.join(root, 'cainiao-adblock.egern.yaml')], { encoding: 'utf8' }));

class Headers {
    constructor(values = {}) { this.values = {}; for (const [key, value] of Object.entries(values)) this.values[key] = Array.isArray(value) ? [...value] : String(value); }
    key(name) { return Object.keys(this.values).find(key => key.toLowerCase() === name.toLowerCase()); }
    get(name) { const key = this.key(name); if (!key) return null; const value = this.values[key]; return Array.isArray(value) ? value.join(', ') : value; }
    getAll(name) { const key = this.key(name); if (!key) return []; const value = this.values[key]; return Array.isArray(value) ? [...value] : [value]; }
    delete(name) { const key = this.key(name); if (key) delete this.values[key]; }
    set(name, value) { this.delete(name); this.values[name] = String(value); }
    append(name, value) { const old = this.getAll(name); this.delete(name); this.values[name] = [...old, String(value)]; }
}

async function load() {
    const context = vm.createContext({ URL, console: { log() {} } });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => { throw Error('禁止加载外部模块'); });
    await module.evaluate({ timeout: 1000 });
    return module.namespace;
}

function fixture(options = {}) {
    const bytes = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body === undefined ? '{}' : options.body);
    const stored = options.stored || new Map();
    const calls = { reads: 0, requests: 0, writes: 0, network: 0, notifications: 0 };
    const headers = new Headers(options.headers || { 'Content-Type': 'application/json; charset=utf-8' });
    const stream = new Response(bytes);
    const response = {
        status: options.status === undefined ? 200 : options.status,
        headers,
        get bodyUsed() { return stream.bodyUsed; },
        arrayBuffer: async () => { calls.reads++; if (calls.reads > 1) throw Error('body-consumed'); if (options.readError) throw Error('read-failed'); return stream.arrayBuffer(); },
        text: async () => { throw Error('text-not-allowed'); },
    };
    const ctx = {
        request: { url: options.url || 'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn?x=1', method: 'GET' },
        response,
        storage: {
            getJSON: key => { if (options.storageReadError) throw Error('storage-read'); return stored.has(key) ? JSON.parse(stored.get(key)) : null; },
            setJSON: (key, value) => { calls.writes++; if (options.storageWriteError) throw Error('storage-write'); stored.set(key, JSON.stringify(value)); },
        },
        http: { get: async () => { calls.network++; throw Error('network-forbidden'); }, post: async () => { calls.network++; throw Error('network-forbidden'); } },
        notify: () => { calls.notifications++; },
    };
    if (options.generic) { delete ctx.request; delete ctx.response; }
    return { ctx, response, bytes, stored, calls };
}

function local(url) {
    return yaml.map_locals.find(row => new RegExp(row.match).test(url));
}

test('五类请求 Map Local 为 404 空体，精确拒绝后缀与伪造主机', () => {
    assert.equal(yaml.map_locals.length, 5);
    const positives = [
        'https://nbcps-mtop.cainiao.com/gw/mtop.cainiao.nbcps.presentation.fetch.cn',
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index/1.0/?x=1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.adkeyword.get.cn/',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.mshow?x=1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.show/2',
    ];
    for (const url of positives) { const row = local(url); assert.ok(row, url); assert.equal(row.status_code, 404); assert.equal(row.body, ''); assert.equal(row.headers['X-Cainiao-Cleaner-Version'], 'eg-native-20261108-1.2.0'); }
    for (const url of [
        'https://nbcps-mtop.cainiao.com/gw/mtop.cainiao.nbcps.presentation.fetch.cnx',
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index/v1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.adkeyword.get.cn/abc',
        'https://cn-acs-mtop.cainiao.com/gw/mtop.cainiao.adkeyword.get.cn',
    ]) assert.equal(local(url), undefined, url);
});

test('原生日志确认的广告 cn 变体和 flyad 接口在 TCP 回退后可命中', () => {
    for (const url of [
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index.cn/1.0',
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.mshow.cn/1.0',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.mshow.cn/1.0',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.show.cn/1.0/',
        'https://cn-acs.m.cainiao.com:443/gw/mtop.cainiao.adx.flyad.getad.cn/1.0/?fixture=1',
    ]) {
        const row = local(url);
        assert.ok(row, url);
        assert.equal(row.status_code, 404);
        assert.equal(row.body, '');
    }
    for (const url of [
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index.cnx/1.0',
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.index.cn/v1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.adx.flyad.getad.cn.extra/1.0',
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.adx.flyad.getad.cn/1.0',
        'https://cn-acs.m.cainiao.com.evil.test/gw/mtop.cainiao.adx.flyad.getad.cn/1.0',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.mine.main/1.0',
    ]) assert.equal(local(url), undefined, url);
});

test('页面脚本完整 API 边界：普通 fetch、cn 别名和数值版本可进入，xapi 与文字版本不进入', async () => {
    const { route } = await load();
    const match = new RegExp(yaml.scriptings[0].http_response.match);
    for (const url of [
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch',
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/1.0/?x=1',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn/',
        'https://longquan-mtop.cainiao.com/gw/mtop.com.cainiao.longquan.place.getpageresourcecontent.cn/202401',
    ]) { assert.ok(route(url), url); assert.equal(match.test(url), true, url); }
    for (const url of [
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cnx',
        'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch/v1',
        'https://longquan-mtop.cainiao.com/gw/mtop.com.cainiao.longquan.place.getpageresourcecontent.cn/abc',
        'https://e2e-mtop.cainiao.com.evil.test/gw/mtop.cainiao.app.e2e.engine.page.fetch',
    ]) { assert.equal(route(url), null, url); assert.equal(match.test(url), false, url); }
});

test('e2e fetch.cn 同时清普通 page.fetch 字段与三个额外运营字段', async () => {
    const script = (await load()).default;
    const body = JSON.stringify({ data: { data: { data: { mainSearch: { bizData: { searchContents: [1] } }, operationList: [2] }, banner: [3], activity: [4], vip: { id: 5 }, order: [6] } }, keep: true });
    const f = fixture({ body });
    const output = await script(f.ctx);
    const result = JSON.parse(output.body);
    assert.equal(result.data.data.data.mainSearch.bizData.searchContents, undefined);
    assert.equal(result.data.data.data.operationList, undefined);
    assert.equal(result.data.data.banner, undefined);
    assert.equal(result.data.data.activity, undefined);
    assert.equal(result.data.data.vip, undefined);
    assert.deepEqual(result.data.data.order, [6]);
    assert.equal(output.headers.get('X-Cainiao-Cleaner-Version'), 'eg-native-20261108-1.2.0');
    assert.equal(f.calls.reads, 1);
    assert.equal(f.response.bodyUsed, true);
});

test('cn-acs fetch.cn 只做已观察的普通字段，e2e 普通 fetch 不清额外字段', async () => {
    const script = (await load()).default;
    const body = JSON.stringify({ data: { data: { data: { mainSearch: { bizData: { searchContents: [1] } }, operationList: [2] }, banner: [3], activity: [4], vip: { id: 5 } } } });
    const cn = fixture({ body, url: 'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn' });
    const cnResult = JSON.parse((await script(cn.ctx)).body);
    assert.equal(cnResult.data.data.data.mainSearch.bizData.searchContents, undefined);
    assert.deepEqual(cnResult.data.data.banner, [3]);
    const plain = fixture({ body, url: 'https://e2e-mtop.cainiao.com/gw/mtop.cainiao.app.e2e.engine.page.fetch' });
    const plainResult = JSON.parse((await script(plain.ctx)).body);
    assert.equal(plainResult.data.data.data.operationList, undefined);
    assert.deepEqual(plainResult.data.data.banner, [3]);
});

test('龙泉只清 780001 contentList，保留其它位置和字段', async () => {
    const script = (await load()).default;
    const input = { data: { result: { placeContentMap: { '780001': { contentList: [1], title: '广告位' }, '780002': { contentList: [2] } }, keep: true } } };
    const f = fixture({ body: JSON.stringify(input), url: 'https://longquan-mtop.cainiao.com/gw/mtop.com.cainiao.longquan.place.getpageresourcecontent.cn' });
    const result = JSON.parse((await script(f.ctx)).body);
    assert.equal(result.data.result.placeContentMap['780001'].contentList, undefined);
    assert.equal(result.data.result.placeContentMap['780001'].title, '广告位');
    assert.deepEqual(result.data.result.placeContentMap['780002'].contentList, [2]);
});

test('未知结构、业务失败、非 JSON 与空正文保留原字节', async () => {
    const script = (await load()).default;
    for (const body of ['{}', '{"data":{}}', '{broken', Buffer.from([0xff, 0x41]), JSON.stringify({ success: false, data: { data: { banner: [1] } } })]) {
        const f = fixture({ body });
        const output = await script(f.ctx);
        assert.deepEqual(Buffer.from(output.body), f.bytes);
        assert.equal(output.headers, undefined);
    }
});

test('HTTP 错误不读正文，重复处理幂等并保留诊断路由', async () => {
    const script = (await load()).default;
    const f = fixture({ status: 500, body: '{"data":{}}' });
    assert.equal(await script(f.ctx), undefined); assert.equal(f.calls.reads, 0);
    const changed = fixture({ body: JSON.stringify({ data: { data: { data: { operationList: [1] } } } }) });
    const first = await script(changed.ctx);
    const second = fixture({ body: first.body, stored: changed.stored });
    const again = await script(second.ctx);
    assert.equal(Buffer.from(again.body).toString(), first.body);
    const stored = JSON.parse(changed.stored.get('skernelx_cainiao_native_diag_v1'));
    assert.ok(stored.routes["mtop.cainiao.app.e2e.engine.page.fetch.cn"]);
    const generic = fixture({ generic: true, stored: changed.stored });
    const widget = await script(generic.ctx);
    assert.equal(widget.type, 'widget'); assert.equal(generic.calls.network, 0); assert.equal(generic.calls.notifications, 0);
});

test('改写响应头只清旧校验字段，保留 Cookie 和未知业务头', async () => {
    const script = (await load()).default;
    const f = fixture({ body: JSON.stringify({ data: { data: { data: { operationList: [1] } } } }), headers: {
        'Content-Type': 'application/json; charset=utf-8', 'Content-Length': '999', 'Content-Encoding': 'gzip', ETag: 'OLD', 'X-Business': 'keep', 'Set-Cookie': ['a=1', 'b=2'],
    } });
    const output = await script(f.ctx);
    assert.equal(output.headers.get('Content-Length'), null);
    assert.equal(output.headers.get('Content-Encoding'), null);
    assert.equal(output.headers.get('X-Business'), 'keep');
    assert.deepEqual(output.headers.getAll('Set-Cookie'), ['a=1', 'b=2']);
    assert.equal(output.headers.get('Content-Type'), 'application/json; charset=utf-8');
});

test('未知标量字段和畸形容器保留，不创建缺失路径', async () => {
    const script = (await load()).default;
    const inputs = [
        { data: { data: { data: { mainSearch: { bizData: { searchContents: 'future' } }, operationList: { future: true } }, banner: 'future', activity: 1, vip: null } } },
        { data: [1, 2] }, { data: { data: { data: null } } },
    ];
    for (const input of inputs) {
        const body = ' ' + JSON.stringify(input) + '\n';
        const f = fixture({ body });
        const output = await script(f.ctx);
        assert.deepEqual(Buffer.from(output.body), Buffer.from(body));
        assert.equal(output.headers, undefined);
    }
});

test('包裹、取件码、寄件、订单与未知工具全部保留', async () => {
    const script = (await load()).default;
    const business = { parcels: [{ id: 'fixture-parcel', pickupCode: 'fixture-code' }], sendOrder: { id: 'fixture-order' }, tools: [{ id: 'future' }, { id: 'send' }], wallet: { keep: true } };
    const f = fixture({ body: JSON.stringify({ data: { data: { data: { operationList: [1], ...business } } } }) });
    const output = await script(f.ctx);
    assert.deepEqual(JSON.parse(output.body).data.data.data, business);
    assert.equal(f.calls.network, 0);
    assert.equal(f.calls.notifications, 0);
});

test('非 200 与非 JSON/非 UTF-8 声明不消费响应正文', async () => {
    const script = (await load()).default;
    for (const options of [{ status: 206 }, { status: 302 }, { status: 403 }, { status: 500 },
        { headers: { 'Content-Type': 'application/octet-stream' } },
        { headers: { 'Content-Type': 'application/jsonp' } },
        { headers: { 'Content-Type': 'application/json; charset=gbk' } }]) {
        const f = fixture({ body: '{"data":{"data":{"banner":[1]}}}', ...options });
        assert.equal(await script(f.ctx), undefined);
        assert.equal(f.calls.reads, 0);
        assert.equal(f.response.bodyUsed, false);
    }
});

test('失败 ret、陌生业务 code 与显式失败均原字节回退', async () => {
    const script = (await load()).default;
    for (const status of [{ ret: ['FAIL_SYS_SESSION_EXPIRED::fixture'] }, { ret: 'FAIL::fixture' }, { ret: null }, { code: '605' }, { success: false }]) {
        const body = ' ' + JSON.stringify({ ...status, data: { data: { banner: [1] } } }) + '\n';
        const f = fixture({ body });
        const output = await script(f.ctx);
        assert.deepEqual(Buffer.from(output.body), Buffer.from(body));
        assert.equal(output.headers, undefined);
        assert.equal(f.calls.reads, 1);
    }
});

test('正文流读取失败不二次读取，不伪造空正文', async () => {
    const script = (await load()).default;
    const f = fixture({ readError: true, body: '{"data":{"data":{"banner":[1]}}}' });
    assert.equal(await script(f.ctx), undefined);
    assert.equal(f.calls.reads, 1);
    assert.equal(f.calls.network, 0);
});

test('头更新异常恢复原头和正文，未交付的改写不计成功', async () => {
    const script = (await load()).default;
    const body = ' {"data":{"data":{"banner":[1]}}}\n';
    const f = fixture({ body, headers: { 'Content-Type': 'application/json', 'Content-Length': '999', ETag: 'old', 'Set-Cookie': ['a=1', 'b=2'] } });
    const before = JSON.stringify(f.response.headers.values);
    const original = f.response.headers.set.bind(f.response.headers);
    let failOnce = true;
    f.response.headers.set = (name, value) => {
        if (failOnce && name.toLowerCase() === 'cache-control') { failOnce = false; throw Error('fixture-header-write'); }
        original(name, value);
    };
    const output = await script(f.ctx);
    assert.deepEqual(Buffer.from(output.body), Buffer.from(body));
    assert.equal(output.headers, undefined);
    assert.deepEqual(f.response.headers.getAll('Set-Cookie'), ['a=1', 'b=2']);
    const prior = new Headers(JSON.parse(before));
    for (const name of ['Content-Type', 'Content-Length', 'ETag']) assert.deepEqual(f.response.headers.getAll(name), prior.getAll(name));
    assert.equal(f.response.headers.get('X-Cainiao-Cleaner-Version'), null);
    const saved = JSON.parse(f.stored.get('skernelx_cainiao_native_diag_v1'));
    assert.equal(saved.status, 'format');
    assert.equal(saved.routes[saved.api].changed, 0);
});

test('诊断存储异常不影响正文，generic 不联网或写入', async () => {
    const script = (await load()).default;
    const f = fixture({ body: '{"data":{"data":{"banner":[1]}}}', storageReadError: true, storageWriteError: true });
    assert.equal(JSON.parse((await script(f.ctx)).body).data.data.banner, undefined);
    const generic = fixture({ generic: true, storageReadError: true });
    const output = await script(generic.ctx);
    assert.equal(output.type, 'widget');
    assert.equal(generic.calls.writes, 0);
    assert.equal(generic.calls.network, 0);
    assert.equal(generic.calls.notifications, 0);
});

test('诊断连续计数，计数封顶且不重新存储未知数据', async () => {
    const script = (await load()).default;
    const key = 'skernelx_cainiao_native_diag_v1';
    const api = 'mtop.cainiao.app.e2e.engine.page.fetch.cn';
    const stored = new Map([[key, JSON.stringify({ version: 'eg-native-20261108-1.2.0', routes: { [api]: { changed: 999998 }, unknown: { token: 'fixture' } }, token: 'fixture' })]]);
    for (let i = 0; i < 2; i++) await script(fixture({ stored, body: '{"data":{"data":{"banner":[1]}}}' }).ctx);
    const saved = JSON.parse(stored.get(key));
    assert.equal(saved.routes[api].changed, 999999);
    assert.deepEqual(Object.keys(saved.routes), [api]);
    assert.equal(saved.token, undefined);
    const generic = fixture({ generic: true, stored });
    assert.match((await script(generic.ctx)).children[0].text, /已改写=999999/);
    assert.equal(generic.calls.writes, 0);
});

test('netflow 未知广告响应和非目标业务不被响应脚本认领', async () => {
    const script = (await load()).default;
    for (const url of [
        'https://netflow-mtop.cainiao.com/gw/mtop.cainiao.guoguo.nbnetflow.ads.future/1.0/',
        'https://cn-acs.m.cainiao.com/gw/mtop.cainiao.app.mine.main/1.0/',
        'https://e2e-mtop.cainiao.com@evil.test/gw/mtop.cainiao.app.e2e.engine.page.fetch.cn',
    ]) {
        const f = fixture({ url, body: '{"data":{"result":[{"materialId":"unknown"}]}}' });
        assert.equal(await script(f.ctx), undefined);
        assert.equal(f.calls.reads, 0);
        assert.equal(f.calls.writes, 0);
        assert.equal(local(url), undefined);
    }
});

test('1.2.0 模块与脚本版本同步，诊断不把域名拦截误计为响应改写', async () => {
    const { VERSION, default: script } = await load();
    assert.equal(VERSION, 'eg-native-20261108-1.2.0');
    assert.ok(yaml.description.startsWith(VERSION + '；'));
    for (const item of yaml.scriptings) {
        const entry = item[Object.keys(item)[0]];
        assert.equal(new URL(entry.script_url).searchParams.get('v'), VERSION);
    }
    const key = 'skernelx_cainiao_native_diag_v1';
    const stored = new Map([[key, JSON.stringify({ version: 'eg-native-20261108-1.1.1', at: '2026-11-08T00:00:00.000Z', routes: {} })]]);
    const f = fixture({ generic: true, stored });
    const text = (await script(f.ctx)).children[0].text;
    assert.match(text, /菜鸟原生版本：eg-native-20261108-1\.2\.0/);
    assert.match(text, /尚未记录到本版本目标接口/);
    assert.match(text, /以上仅统计三个页面响应结构/);
    assert.match(text, /Map Local 拦截请查看请求日志/);
    assert.equal(f.calls.writes, 0);
});
