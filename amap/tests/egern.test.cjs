// Engine | Node.js 20+ | JavaScript
// Build: 无需构建
// Run: node --experimental-vm-modules --test amap/tests/egern.test.cjs
// Deps: Node.js 内置模块；Python 3 + PyYAML（只解析公开 YAML）；无网络
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'amap-cleaner.egern.js'), 'utf8');
const yaml = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1], encoding="utf-8"))))',
    path.join(root, 'amap-adblock.egern.yaml')], { encoding: 'utf8', timeout: 5000 }));
const surge = fs.readFileSync(path.join(root, 'amap-adblock.sgmodule'), 'utf8');
const oldTransform = require('../amap-cleaner.js').transform;
const KEY = 'egern_amap_cleaner_v2';
const paths = {
    notice: '/ws/message/notice/list', home: '/ws/faas/amap-navigation/main-page',
    message: '/ws/msgbox/pull', profile: '/ws/shield/dsp/profile/index/nodefaas',
    hotword: '/ws/shield/search/new_hotword', config: '/ws/shield/frogserver/aocs/updatable',
    nearby: '/ws/shield/search/nearbyrec_smart', taxi: '/ws/promotion-web/resource',
};
const plain = value => JSON.parse(JSON.stringify(value));
class Headers {
    constructor(values = {}) { Object.assign(this, values); }
    get(name) {
        const key = Object.keys(this).find(key => key.toLowerCase() === name.toLowerCase());
        if (!key) return null;
        return Array.isArray(this[key]) ? this[key].join(', ') : this[key];
    }
    getAll(name) {
        const key = Object.keys(this).find(key => key.toLowerCase() === name.toLowerCase());
        return !key ? [] : Array.isArray(this[key]) ? [...this[key]] : [this[key]];
    }
    delete(name) { for (const key of Object.keys(this)) if (key.toLowerCase() === name.toLowerCase()) delete this[key]; }
    set(name, value) { this.delete(name); this[name] = value; }
    append(name, value) { const old = this.getAll(name); this.set(name, [...old, value]); }
}
async function harness(options = {}) {
    const logs = [], notices = [], writes = [], store = options.store || new Map();
    const context = vm.createContext({ console: { log: (...args) => logs.push(args.join(' ')) } });
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => { throw Error('禁止加载外部模块'); });
    await module.evaluate({ timeout: 1000 });
    let reads = 0;
    const bytes = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body === undefined ? '{}' : options.body);
    const response = {
        status: options.status === undefined ? 200 : options.status,
        headers: options.headers && typeof options.headers.get === 'function' ? options.headers : new Headers(options.headers),
        arrayBuffer: async () => {
            reads++;
            assert.equal(reads, 1, '正文只能消费一次');
            if (options.bodyThrows) throw Error('SECRET_BODY_READ');
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
        text: async () => { throw Error('不能在 arrayBuffer 后消费 text'); },
        json: async () => { throw Error('不能二次消费 json'); },
    };
    const ctx = {
        storage: {
            getJSON: key => { if (options.readThrows) throw Error('SECRET_STORAGE_READ'); return store.has(key) ? JSON.parse(store.get(key)) : null; },
            setJSON: (key, value) => {
                if (options.writeThrows) throw Error('SECRET_STORAGE_WRITE');
                const raw = JSON.stringify(value); writes.push([key, raw]); store.set(key, raw);
                // 原生 setJSON 返回 void。
            },
        },
        notify: value => notices.push(value),
        http: new Proxy({}, { get: () => { throw Error('禁止生产请求'); } }),
    };
    if (!options.generic) {
        ctx.request = { url: options.url || 'https://m5.amap.com' + paths.notice, headers: new Headers() };
        if (!options.requestOnly) ctx.response = response;
    }
    const output = await module.namespace.default(ctx);
    return { output, logs, notices, writes, store, namespace: module.namespace, response, bytes, get reads() { return reads; } };
}
function map(url) { return yaml.map_locals.find(entry => new RegExp(entry.match).test(url)); }
function bytesOf(output) { return Buffer.from(output.body); }

test('原生 YAML 七条 Map Local 与原 Surge 正文、状态和头逐项一致', () => {
    const lines = surge.slice(surge.indexOf('[Map Local]'), surge.indexOf('[URL Rewrite]')).split('\n').filter(line => line.startsWith('^'));
    assert.equal(yaml.map_locals.length, 7); assert.equal(lines.length, 7);
    for (const [index, line] of lines.entries()) {
        const row = yaml.map_locals[index], data = line.match(/ data="([^"]*)"/)[1];
        const expected = line.includes('data-type=base64') ? Buffer.from(data, 'base64') : Buffer.from(data);
        assert.deepEqual(Buffer.from(row.body), expected);
        assert.equal(row.status_code, Number(line.match(/status-code=(\d+)/)[1]));
        const headers = Object.fromEntries(line.match(/ header="([^"]*)"/)[1].split('|').map(item => {
            const at = item.indexOf(':'); return [item.slice(0, at), item.slice(at + 1)];
        }));
        assert.deepEqual(row.headers, headers);
    }
});
test('RT multipart 仅 jsonData，CRLF、结束边界及零图片完全保留', () => {
    const row = map('https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt?x=fixture');
    const parts = row.body.split('--amap-cleaner-2-0-0').filter(part => part.includes('Content-Disposition'));
    assert.equal(parts.length, 1);
    const data = JSON.parse(parts[0].split('\r\n\r\n')[1].trim());
    assert.deepEqual(data.data.custom_list, []); assert.deepEqual(data.data.ad, []);
    assert.equal(data.version, '1.0_amap-aos-info-nogw');
    assert.match(row.body, /\r\n--amap-cleaner-2-0-0--\r\n$/);
    assert.doesNotMatch(row.body, /image_url|filename=|imgData|imgMsg/);
    assert.equal(row.headers['X-AMap-Cleaner-Version'], '2.0.0');
});
test('开屏 `_rt` 排在普通入口前且只覆盖已知通道，允许显式端口及版本子路径', () => {
    assert.match(yaml.map_locals[0].match, /splash_screen_rt/);
    for (const scheme of ['http', 'https']) for (const channel of ['aos', 'valueadded']) for (const suffix of ['', '_rt']) {
        for (const ending of ['', '?x=1', '/1.0?x=1']) {
            const found = map(`${scheme}://m5.amap.com:443/ws/${channel}/alimama/splash_screen${suffix}${ending}`);
            assert.equal(Boolean(found), !(channel === 'valueadded' && suffix === '_rt'));
        }
    }
});
test('本地替换拒绝伪造主机、未知后缀、普通导航和定位路径', () => {
    for (const host of ['evilamap.com', 'amap.com.evil.test', 'm5.amap.com.evil.test', 'm5.amap.com@evil.test']) {
        assert.equal(map(`https://${host}/ws/aos/alimama/splash_screen_rt`), undefined);
    }
    for (const tail of ['_rtx', '_report', '_rt_extra', '2']) assert.equal(map('https://m5.amap.com/ws/aos/alimama/splash_screen' + tail), undefined);
    for (const tail of ['/v3/direction/driving', '/v3/geocode/regeo', '/ws/render/bmd/tile', '/v3/place/text',
        '/ws/tservice/team/family/member/status', '/ws/valueadded/weather_detail']) assert.equal(map('https://m5.amap.com' + tail), undefined);
});
test('五类推广 Map Local 不扩大到整域名或主地图业务', () => {
    for (const tail of ['/v12/ai_rec/home_explore', '/ws/faas/amap-navigation/card-service-route-plan',
        '/ws/boss/order_web/1234abcd_information', '/ws/shield/scene/recommend', '/ws/valueadded/weather']) {
        assert.equal(map('https://m5.amap.com' + tail).body, '{}');
    }
    assert.deepEqual(yaml.rules[0], { domain: { match: 'optimus-ads.amap.com', policy: 'REJECT' } });
    const reject = new RegExp(yaml.rules[1].url_regex.match);
    assert.equal(reject.test('https://m5.amap.com/ws/asa/ads_attribution?x=1'), true);
    assert.equal(reject.test('https://m5.amap.com/ws/asa/ads_attribution_report'), false);
});

const fixtures = {
    notice: { noticeList: [1], route: '保留' },
    home: { cardList: [{ dataType: 'AdCard' }, { dataType: 'UnknownCard', text: '地图😀' }], mapBizList: { ad: { isAd: true }, business: { id: 1 } }, business_position: [1], route: [1] },
    message: { msgs: [1], pull3: { msgs: { badge: 1 } }, realMessage: '保留' },
    profile: { tipData: {}, cardList: [{ adFlag: 1 }, { dataType: 'OrderCard' }], orders: [1] },
    hotword: { header_hotword: ['广告'], results: ['真实搜索'] },
    config: { gd_notch_logo: { value: '广告', version: 'x', extra: 1 }, ai_route_navigation: { value: '保留', version: 'x' } },
    nearby: { coupon: [1], activity: {}, modules: ['coupon', 'map', { name: 'activity', unknown: true }], result: '保留' },
    taxi: { icon: {}, banner: [1], tips: '未知字符串', popup: [1], orders: [1] },
};
for (const [id, data] of Object.entries(fixtures)) {
    test('原生页面分支 ' + id + ' 与旧纯函数相同，只清理已知字段', async () => {
        const body = JSON.stringify({ result: 'true', code: '1', data, extra: '未知😀' });
        const h = await harness({ url: 'https://m5.amap.com' + paths[id] + '?x=1', body });
        assert.equal(h.reads, 1); assert.equal(h.output.body, oldTransform(id, body).body);
        assert.equal(h.output.headers['X-AMap-Cleaner-Version'], '2.0.0');
        const again = await harness({ url: 'https://m5.amap.com' + paths[id], body: h.output.body });
        assert.deepEqual(bytesOf(again.output), Buffer.from(h.output.body));
    });
}
test('模块页面 match 与原生分流八路一致，未知前缀或伪造域名不读正文', async () => {
    const h = await harness({ generic: true });
    const pattern = new RegExp(yaml.scriptings[0].http_response.match);
    for (const [id, tail] of Object.entries(paths)) {
        assert.equal(h.namespace.route('https://m5.amap.com:443' + tail + '/1?x=1'), id);
        assert.equal(pattern.test('https://m5.amap.com:443' + tail + '/1?x=1'), true);
        assert.equal(h.namespace.route('https://m5.amap.com' + tail + '_report'), null);
    }
    for (const url of ['https://m5.amap.com.evil.test' + paths.notice, 'https://m5.amap.com/ws/shield/search/real_search',
        'https://m5.amap.com/ws/message/notice/list_extra']) {
        const run = await harness({ url, body: '{"data":{"noticeList":[1]}}' });
        assert.equal(run.output, undefined); assert.equal(run.reads, 0);
    }
});
test('非 200 不消费 body，HTTP 错误仅计数并保持响应', async () => {
    for (const status of [204, 302, 403, 500]) {
        const h = await harness({ status, body: '{"data":{"noticeList":[1]}}' });
        assert.equal(h.output, undefined); assert.equal(h.reads, 0);
        assert.equal(JSON.parse(h.store.get(KEY)).routes.notice['http-error'], 1);
    }
});
test('服务端明确失败、未知 JSON、JSONP、空体和非 UTF-8 都回传已读原字节', async () => {
    for (const body of ['', 'callback({"data":{}})', '{', '[1]', 'null', ' { "data": {"noticeList":[]}, "extra": 1 } ',
        '{"code":500,"data":{"noticeList":[1]}}', '{"result":"false","data":{"noticeList":[1]}}',
        Buffer.from([0xff, 0xc0, 0x80]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf4, 0x90, 0x80, 0x80])]) {
        const h = await harness({ body });
        assert.equal(h.reads, 1); assert.deepEqual(bytesOf(h.output), h.bytes);
        assert.equal(h.output.headers, undefined);
    }
});
test('改写后去除旧校验/压缩/长度头，多值 Cookie 保持数组，返回原 Headers', async () => {
    const headers = { 'cOnTeNt-LeNgTh': '400', 'Content-Encoding': 'gzip', 'Transfer-Encoding': 'chunked',
        ETag: 'old', 'Content-MD5': 'old', 'Content-Digest': 'old', 'Cache-Control': 'public',
        'Content-Type': 'application/json', 'Set-Cookie': ['fixture-a=1', 'fixture-b=2'], 'X-Unknown': '保留' };
    const h = await harness({ body: '{"data":{"noticeList":[1]}}', headers });
    assert.deepEqual(plain(h.output.headers), { 'Set-Cookie': ['fixture-a=1', 'fixture-b=2'], 'X-Unknown': '保留',
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-AMap-Cleaner-Version': '2.0.0' });
    assert.equal(h.response.headers.get('Content-Length'), null);
    assert.equal(h.output.headers, h.response.headers);
});
test('真实不可枚举 Response Headers 保留两条 Set-Cookie 和未知业务头', async () => {
    const headers = new Response('', { headers: { 'Content-Type': 'application/json', 'Content-Length': '400', 'X-Business': 'preserved' } }).headers;
    headers.append('Set-Cookie', 'fixture-a=1'); headers.append('Set-Cookie', 'fixture-b=2');
    assert.equal(Object.keys(headers).length, 0);
    const h = await harness({ headers, body: '{"data":{"noticeList":[1]}}' });
    assert.equal(h.output.headers, headers); assert.equal(headers.get('X-Business'), 'preserved');
    assert.deepEqual(headers.getSetCookie(), ['fixture-a=1', 'fixture-b=2']);
    assert.equal(headers.get('Content-Length'), null); assert.equal(headers.get('Cache-Control'), 'no-store');
});
test('Headers 方法修改后抛错，入口回传原字节并恢复触及的头', async () => {
    const headers = new Response('', { headers: { 'Content-Type': 'application/json', 'Content-Length': '400', 'X-Business': 'yes' } }).headers;
    const set = headers.set.bind(headers);
    let failed = false;
    headers.set = (name, value) => { set(name, value); if (!failed) { failed = true; throw Error('SECRET_HEADER_FAILURE'); } };
    const body = '{"data":{"noticeList":[1]}}';
    const h = await harness({ headers, body });
    assert.deepEqual(Buffer.from(h.output.body), Buffer.from(body)); assert.equal(h.output.headers, undefined);
    assert.equal(headers.get('Content-Length'), '400'); assert.equal(headers.get('Content-Type'), 'application/json');
    assert.equal(headers.get('X-Business'), 'yes'); assert.equal(headers.get('X-AMap-Cleaner-Version'), null);
    assert.equal(JSON.parse(h.store.get(KEY)).routes.notice.changed, 0);
});
test('不支持的声明 charset 不消费正文或错误转码', async () => {
    const h = await harness({ headers: { 'Content-Type': 'application/json; charset=gbk' }, body: '{"data":{"noticeList":[1]}}' });
    assert.equal(h.output, undefined); assert.equal(h.reads, 0);
});
test('原生存储读写异常不影响页面，也不泄露异常或发通知', async () => {
    for (const options of [{ readThrows: true }, { writeThrows: true }]) {
        const h = await harness({ ...options, body: '{"data":{"noticeList":[1]}}' });
        assert.deepEqual(JSON.parse(h.output.body).data.noticeList, []);
        assert.equal(h.notices.length, 0); assert.doesNotMatch(JSON.stringify(h.logs), /SECRET_|Bearer/);
    }
});
test('处理统计仅固定路由/枚举/封顶数字；不会存 URL、账号或未知字段', async () => {
    const store = new Map([[KEY, JSON.stringify({ version: '2.0.0', secret: 'SECRET_SAVED', routes: {
        notice: { changed: 9999999999, unchanged: 'SECRET_COUNT', unknown: 'SECRET_EXTRA' }, 'SECRET_ROUTE': { changed: 1 },
    } })]]);
    const h = await harness({ store, url: 'https://m5.amap.com' + paths.notice + '?token=SECRET_QUERY', body: '{"data":{"noticeList":[1]},"account":"SECRET_BODY"}' });
    const saved = JSON.parse(store.get(KEY));
    assert.equal(saved.routes.notice.changed, 999999); assert.equal(saved.routes.notice.unchanged, 0);
    assert.doesNotMatch(JSON.stringify(saved), /SECRET_|https?:|account|unknown/);
    const diagnostic = await harness({ generic: true, store });
    assert.equal(diagnostic.output.type, 'widget');
    assert.match(JSON.stringify(diagnostic.output), /Map Local/);
    assert.doesNotMatch(JSON.stringify([diagnostic.output, diagnostic.logs]), /SECRET_/);
    assert.equal(diagnostic.writes.length, 0); assert.equal(diagnostic.notices.length, 0);
});
test('generic 存储不可读明确说明，不发送请求或通知', async () => {
    const h = await harness({ generic: true, readThrows: true });
    assert.equal(h.output.type, 'widget'); assert.match(JSON.stringify(h.output), /零值不代表没有命中/);
    assert.equal(h.reads, 0); assert.equal(h.writes.length, 0); assert.equal(h.notices.length, 0);
});
test('流读取本身拒绝不二次消费、不伪造空正文；缺失 response 只放行', async () => {
    const h = await harness({ bodyThrows: true });
    assert.equal(h.output, undefined); assert.equal(h.reads, 1);
    const request = await harness({ requestOnly: true });
    assert.equal(request.output, undefined); assert.equal(request.reads, 0); assert.equal(request.writes.length, 0);
});
test('原生配置启用二进制取体、2MiB 上限，所有脚本 URL 指向存在的新文件', () => {
    const response = yaml.scriptings[0].http_response;
    assert.equal(response.body_required, true); assert.equal(response.binary_body, true);
    assert.equal(response.max_size, 2097152); assert.equal(response.timeout, 10);
    assert.deepEqual(yaml.mitm, { hostnames: { includes: ['*.amap.com'] } });
    for (const item of yaml.scriptings) {
        const row = Object.values(item)[0], url = new URL(row.script_url);
        assert.equal(url.hostname, 'raw.githubusercontent.com');
        assert.equal(url.pathname, '/atopsecret/SurgeScripts/main/amap/amap-cleaner.egern.js');
        assert.equal(url.searchParams.get('v'), '2.0.0');
        assert.ok(fs.existsSync(path.join(root, path.basename(url.pathname))));
    }
    assert.doesNotMatch(source, /\$(?:done|request|response|persistentStore|httpClient|notification)\b|\bimport\s/);
});
