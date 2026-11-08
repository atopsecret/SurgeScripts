// Engine | Node.js 20+ 本地模拟 Egern | JavaScript CommonJS
// Build: cd apple-weather && npm ci --ignore-scripts && npm run build
// Run: node --experimental-vm-modules --test apple-weather/tests/egern.test.cjs
// Deps: 无运行时 npm 依赖；不发送真实 HTTP 请求
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = join(__dirname, '..');
const FIXED_TIME = 1794099600000;
const WEATHER_URL = 'https://weatherkit.apple.com/api/v2/weather/zh-Hans-CN/31.2/121.5?country=CN&dataSets=currentWeather';
const AVAIL_URL = 'https://weatherkit.apple.com/api/v1/availability/zh-Hans-CN/31.2/121.5';
const TYPE = 'application/vnd.apple.flatbuffer';
const PRESERVE = { 'Weather.Provider': 'WeatherKit', 'NextHour.Provider': 'WeatherKit' };
let handler, createEngine, runtimeAPI, codec;

function storage() {
    const values = new Map();
    return {
        values,
        getJSON(key) { return values.has(key) ? JSON.parse(values.get(key)) : null; },
        setJSON(key, value) { values.set(key, JSON.stringify(value)); },
    };
}

// 只实现 Egern 文档明确保证的方法，故意不实现 entries() 和迭代器。
class DocumentedHeaders {
    constructor(values = {}) { this.values = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])); }
    get(key) { return this.values.get(key.toLowerCase()) ?? null; }
    has(key) { return this.values.has(key.toLowerCase()); }
    delete(key) { this.values.delete(key.toLowerCase()); }
}

function context({ body = '["currentWeather"]', url = AVAIL_URL, type = 'application/json', status = 200, env = {}, http, sharedStorage, headers = {}, readError = false } = {}) {
    const requests = [];
    let reads = 0;
    const read = () => {
        reads++;
        if (reads > 1 || readError) throw new Error('body unavailable');
        return body;
    };
    const call = async (url, options) => {
        requests.push({ url, options });
        if (!http) throw new Error('测试禁止真实网络');
        return http(url, options);
    };
    return {
        env, storage: sharedStorage || storage(), requests,
        request: { url, method: 'GET', headers: new DocumentedHeaders() },
        response: {
            status, headers: new DocumentedHeaders({ 'content-type': type, ...headers }),
            async text() { const value = read(); return typeof value === 'string' ? value : new TextDecoder().decode(value); },
            async arrayBuffer() { const value = read(); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); },
        },
        http: { get: call, post: call },
        get reads() { return reads; },
    };
}

function response(body, status = 200, headers = {}) {
    let read = false;
    return { status, headers: new DocumentedHeaders(headers), async text() {
        assert.equal(read, false); read = true;
        return typeof body === 'string' ? body : JSON.stringify(body);
    } };
}

function encode(data) {
    const copy = structuredClone(data);
    if (copy.currentWeather) for (const name of ['Next1h', 'Next6h', 'Next24h', 'Previous1h', 'Previous6h', 'Previous24h']) {
        copy.currentWeather[`precipitationAmount${name}ByType`] ||= [];
    }
    const builder = new codec.Builder();
    builder.finish(codec.WeatherKit2.encode(builder, 'all', copy));
    return builder.asUint8Array().slice();
}
function decode(bytes) { return codec.WeatherKit2.decode(new codec.ByteBuffer(new Uint8Array(bytes)), 'all'); }
function weather(extra = {}) {
    return encode({
        currentWeather: { temperature: 21.5, conditionCode: 'CLEAR', humidity: 55 },
        locationInfo: { countryCode: 'CN', primaryName: '离线样例', timeZone: 'Asia/Shanghai' },
        ...extra,
    });
}

async function upstream({ body, url = WEATHER_URL, type = TYPE, env = PRESERVE, http } = {}) {
    let timer;
    const result = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('上游模拟超时')), 3000);
        const network = (request, callback) => {
            Promise.resolve().then(async () => {
                if (!http) throw new Error('禁止真实网络');
                const value = await http(request.url, request);
                return [value, await value.text()];
            }).then(([value, text]) => callback(null, { status: value.status, statusCode: value.status, headers: {} }, text), error => callback(String(error), null, null));
        };
        const sandbox = {
            URL, URLSearchParams, TextEncoder, TextDecoder, Date, setTimeout, clearTimeout,
            console: { log() {}, warn() {}, error() {} },
            Egern: {}, $script: {},
            $argument: Object.entries(env).map(([key, value]) => `${key}="${value}"`).join('&'),
            $request: { url, method: 'GET', headers: {} },
            $response: { status: 200, headers: { 'content-type': type }, body },
            $persistentStore: { read() { return null; }, write() { return true; } },
            $httpClient: { get: network, post: network },
            $done(value) { resolve(value); },
        };
        new vm.Script(readFileSync(join(__dirname, 'fixtures/upstream-v3.1.0.bundle.js'), 'utf8')).runInNewContext(sandbox, { timeout: 1000 });
    });
    try { return await result; } finally { clearTimeout(timer); }
}

before(async () => {
    mock.method(Date, 'now', () => FIXED_TIME);
    const module = await import(pathToFileURL(join(ROOT, 'apple-weather-enhancer.egern.js')));
    handler = module.default; createEngine = module.createEngine;
    runtimeAPI = await import(pathToFileURL(join(ROOT, 'src/runtime.mjs')));
    codec = createEngine(runtimeAPI.createRuntime({ storage: storage() }, runtimeAPI.readOptions(PRESERVE)));
});
after(() => mock.restoreAll());

test('产物是自包含 Egern 原生入口，无旧全局 API、eval 或远程 import', () => {
    const source = readFileSync(join(ROOT, 'apple-weather-enhancer.egern.js'), 'utf8');
    assert.equal(typeof handler, 'function');
    assert.doesNotMatch(source, /\$(?:request|response|done|httpClient|persistentStore|notification)\b|\beval\s*\(|new Function|\bimport\s*\(/);
});

test('固定的上游源码、公开绑定和原始发布包哈希全部一致', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'vendor/manifest.json')));
    for (const [name, expected] of Object.entries(manifest.files)) assert.equal(createHash('sha256').update(readFileSync(join(ROOT, name))).digest('hex'), expected, name);
});

test('可用性 JSON 扩展为 11 个数据集，且与 v3.1.0 原发布脚本一致', async () => {
    const ctx = context();
    const output = await handler(ctx);
    const old = await upstream({ body: '["currentWeather"]', url: AVAIL_URL, type: 'application/json' });
    assert.equal(output.body, old.body);
    assert.equal(JSON.parse(output.body).length, 11);
    assert.equal(ctx.reads, 1); assert.equal(ctx.requests.length, 0);
});

test('只使用文档化 Headers 方法，成功改写时移除失效的长度、编码与校验头', async () => {
    const ctx = context({ headers: { 'content-length': '18', 'content-encoding': 'gzip', etag: 'fixture', digest: 'fixture', 'x-keep': 'yes' } });
    const output = await handler(ctx);
    assert.equal(output.headers, ctx.response.headers);
    for (const name of ['content-length', 'content-encoding', 'etag', 'digest']) assert.equal(output.headers.has(name), false);
    assert.equal(output.headers.get('x-keep'), 'yes');
});

for (const body of ['{broken', '{"error":"fixture"}', '[1,2]']) test(`未知或损坏 JSON 保留正文：${body}`, async () => {
    const ctx = context({ body, headers: { etag: 'keep' } });
    const output = await handler(ctx);
    assert.equal(output.body, body); assert.equal(ctx.reads, 1); assert.equal(ctx.response.headers.get('etag'), 'keep');
});

for (const status of [204, 301, 401, 403, 429, 500]) test(`HTTP ${status} 不读取正文`, async () => {
    const ctx = context({ status });
    assert.equal(await handler(ctx), undefined); assert.equal(ctx.reads, 0);
});

for (const url of [
    'https://weatherkit.apple.com.evil.invalid/api/v1/availability/x',
    'https://weatherkit.apple.com@evil.invalid/api/v1/availability/x',
    'https://evil.invalid@weatherkit.apple.com/api/v1/availability/x',
    'https://weatherkit.apple.com:8443/api/v1/availability/x',
    'https://weatherkit.apple.com/api/v2/weather_other/x',
    'not a URL',
]) test(`非目标请求不消费正文：${url}`, async () => {
    const ctx = context({ url });
    assert.equal(await handler(ctx), undefined); assert.equal(ctx.reads, 0);
});

for (const type of ['application/octet-stream', 'text/html', 'application/grpc']) test(`天气响应不猜测 ${type} 格式`, async () => {
    const ctx = context({ body: weather(), url: WEATHER_URL, type });
    assert.equal(await handler(ctx), undefined); assert.equal(ctx.reads, 0);
});

test('正文读取失败不伪造空正文或“成功回退”', async () => {
    const ctx = context({ readError: true });
    assert.equal(await handler(ctx), undefined); assert.equal(ctx.reads, 1);
    assert.match(ctx.storage.getJSON(runtimeAPI.DIAG_KEY).status, /无法重建/);
});

test('超出 4 MiB 的 JSON 原文回传', async () => {
    const body = ' '.repeat(runtimeAPI.LIMIT + 1);
    const ctx = context({ body });
    assert.equal((await handler(ctx)).body, body);
});

test('WeatherKit 模式保留温度、定位和已知字段，FlatBuffers 输出与原发布脚本逐字节一致', async () => {
    const body = weather({ forecastDaily: { days: [] }, forecastHourly: { hours: [] } });
    const ctx = context({ body, url: WEATHER_URL, type: TYPE, env: PRESERVE });
    const result = await handler(ctx);
    const old = await upstream({ body, env: PRESERVE });
    assert.deepEqual(Buffer.from(result.body), Buffer.from(old.body));
    assert.equal(decode(result.body).currentWeather.temperature, 21.5);
    assert.equal(decode(result.body).locationInfo.primaryName, '离线样例');
    assert.equal(ctx.reads, 1); assert.equal(ctx.requests.length, 0);
});

for (const body of [new Uint8Array(), new Uint8Array([1, 2, 3, 4]), new Uint8Array(20), new Uint8Array([255, 255, 255, 127, ...new Array(16).fill(0)])]) {
    test(`无效 FlatBuffers 根表保留字节（${body.length} 字节，首字节 ${body[0] ?? '-'}）`, async () => {
        const ctx = context({ body, url: WEATHER_URL, type: TYPE });
        assert.deepEqual((await handler(ctx)).body, body); assert.equal(ctx.reads, 1); assert.equal(ctx.requests.length, 0);
    });
}

test('无效坐标在读取正文前退出', async () => {
    const ctx = context({ body: weather(), url: WEATHER_URL.replace('/31.2/', '/91/'), type: TYPE });
    assert.equal(await handler(ctx), undefined); assert.equal(ctx.reads, 0);
});

const realTime = {
    status: 'ok', location: [31.2, 121.5], server_time: FIXED_TIME / 1000,
    result: { server_time: FIXED_TIME / 1000, realtime: {
        status: 'ok', temperature: 27.25, apparent_temperature: 29, cloudrate: 0.2,
        skycon: 'CLEAR_DAY', humidity: 0.65, pressure: 101300, visibility: 18,
        precipitation: { local: { intensity: 0 } }, wind: { direction: 90, speed: 8 },
    } },
};

test('彩云当前天气使用原生 ctx.http，结果与原脚本逐字节一致', async () => {
    const body = weather();
    const env = { 'API.ColorfulClouds.Token': 'fixture-token' };
    const http = async () => response(realTime);
    const ctx = context({ body, url: WEATHER_URL, type: TYPE, env, http });
    const output = await handler(ctx);
    const old = await upstream({ body, env, http });
    assert.equal(decode(output.body).currentWeather.temperature, 27.25);
    assert.deepEqual(Buffer.from(output.body), Buffer.from(old.body));
    assert.equal(ctx.requests.length, 1);
    assert.match(ctx.requests[0].url, /^https:\/\/api\.caiyunapp\.com\/v2\.6\/fixture-token\//);
    assert.equal(ctx.requests[0].options.credentials, 'omit');
    assert.equal(ctx.requests[0].options.redirect, 'error');
    assert.equal(ctx.requests[0].options.timeout, 7000);
});

test('彩云缺失降水补充为最多 85 分钟，结果与原脚本逐字节一致', async () => {
    const body = weather();
    const url = WEATHER_URL.replace('dataSets=currentWeather', 'dataSets=forecastNextHour');
    const minutely = { status: 'ok', location: [31.2, 121.5], server_time: FIXED_TIME / 1000,
        result: { minutely: { status: 'ok', probability: [0, 0, 0, 0], precipitation_2h: new Array(120).fill(0), description: '未来两小时无降水' } } };
    const http = async () => response(minutely);
    const ctx = context({ body, url, type: TYPE, http });
    const output = await handler(ctx);
    const old = await upstream({ body, url, env: {}, http });
    assert.equal(decode(output.body).forecastNextHour.minutes.length, 85);
    assert.deepEqual(Buffer.from(output.body), Buffer.from(old.body));
});

for (const algorithm of ['EU_EAQI', 'None', 'UBA', 'WAQI_InstantCast_US', 'WAQI_InstantCast_CN', 'WAQI_InstantCast_CN_25_DRAFT']) {
    test(`AQI ${algorithm} 的真实 FlatBuffers 结果与原脚本逐字节一致`, async () => {
        const airQuality = {
            metadata: { providerName: 'fixture', sourceType: 'STATION' },
            index: 75, categoryIndex: 2, scale: 'HJ6332012.2414', previousDayComparison: 'SAME', primaryPollutant: 'PM2_5',
            pollutants: ['PM2_5', 'PM10', 'NO2', 'SO2', 'OZONE'].map(pollutantType => ({ pollutantType, amount: 35, units: 'MICROGRAMS_PER_CUBIC_METER' })),
        };
        const body = weather({ airQuality });
        const env = { ...PRESERVE, 'AirQuality.Calculate.Algorithm': algorithm };
        const url = WEATHER_URL.replace('dataSets=currentWeather', 'dataSets=airQuality');
        const ctx = context({ body, url, type: TYPE, env });
        const output = await handler(ctx);
        const old = await upstream({ body, url, env });
        assert.deepEqual(Buffer.from(output.body), Buffer.from(old.body));
        assert.equal(ctx.requests.length, 0);
        assert.equal(decode(output.body).airQuality.previousDayComparison, 'SAME');
    });
}

for (const failure of ['http', 'json', 'throw']) test(`数据源 ${failure} 失败时保留原字节和原响应头`, async () => {
    const body = weather();
    const http = async () => {
        if (failure === 'throw') throw new Error('fixture-token-private-url');
        return response(failure === 'json' ? '{broken' : '{}', failure === 'http' ? 429 : 200);
    };
    const ctx = context({ body, url: WEATHER_URL, type: TYPE, http, headers: { etag: 'keep' } });
    assert.deepEqual((await handler(ctx)).body, body); assert.equal(ctx.response.headers.get('etag'), 'keep');
    assert.equal(ctx.reads, 1);
});

for (const env of [{ 'Weather.Provider': 'bad' }, { 'API.QWeather.Host': 'https://bad.invalid/path' }, { 'API.ColorfulClouds.Token': 'bad\r\nheader' }]) {
    test(`无效参数保留原文且不发送请求：${JSON.stringify(env)}`, async () => {
        const ctx = context({ env });
        assert.equal((await handler(ctx)).body, '["currentWeather"]'); assert.equal(ctx.requests.length, 0);
    });
}

test('和风主机与 API Key 正确传入原生 HTTP，不混用 JWT 鉴权', async () => {
    const body = weather();
    const ctx = context({ body, url: WEATHER_URL, type: TYPE, env: {
        'Weather.Provider': 'QWeather', 'API.QWeather.Host': 'fixture.qweatherapi.com', 'API.QWeather.Token': 'fixture-key',
    }, http: async () => response({ code: '200', updateTime: new Date(FIXED_TIME).toISOString(), now: {
        temp: '26', feelsLike: '28', icon: '100', humidity: '60', precip: '0', pressure: '1013', vis: '12', wind360: '90', windSpeed: '5', cloud: '20',
    }, fxLink: 'https://fixture.invalid/weather' }) });
    const output = await handler(ctx);
    assert.equal(decode(output.body).currentWeather.temperature, 26);
    assert.equal(ctx.requests[0].options.headers['X-QW-Api-Key'], 'fixture-key');
    assert.match(ctx.requests[0].url, /^https:\/\/fixture\.qweatherapi\.com\/v7\/weather\/now/);
});

test('不同 ctx 的数据源、令牌和结果不通过全局上下文串用', async () => {
    const body = weather();
    const first = context({ body, url: WEATHER_URL, type: TYPE, env: { 'API.ColorfulClouds.Token': 'first' },
        http: async () => { await new Promise(resolve => setTimeout(resolve, 5)); return response(realTime); } });
    const second = context({ body, url: WEATHER_URL, type: TYPE, env: PRESERVE });
    const [a, b] = await Promise.all([handler(first), handler(second)]);
    assert.equal(decode(a.body).currentWeather.temperature, 27.25);
    assert.equal(decode(b.body).currentWeather.temperature, 21.5);
    assert.equal(first.requests.length, 1); assert.equal(second.requests.length, 0);
});

test('存储故障不阻断可用性改写', async () => {
    const ctx = context({ sharedStorage: { getJSON() { throw new Error('denied'); }, setJSON() { throw new Error('denied'); } } });
    assert.equal(JSON.parse((await handler(ctx)).body).length, 11);
});

test('诊断不包含令牌、坐标、完整 URL 或请求头', async () => {
    const ctx = context({ body: weather(), url: WEATHER_URL, type: TYPE, env: { 'API.ColorfulClouds.Token': 'PRIVATE_FIXTURE_TOKEN' }, http: async () => response(realTime) });
    await handler(ctx);
    const report = await handler({ storage: ctx.storage });
    const stored = JSON.stringify([...ctx.storage.values]);
    assert.equal(report.type, 'widget');
    assert.doesNotMatch(stored + JSON.stringify(report), /PRIVATE_FIXTURE_TOKEN|31\.2|121\.5|https:\/\/|X-QW-Api-Key/);
});

test('原生 fetch 同一调用内去重，304 保留 ETag 且不重复消费正文', async () => {
    let calls = 0;
    const ctx = { storage: storage(), http: { get: async () => { calls++; return response('', 304, { etag: 'fixture-etag' }); } } };
    const runtime = runtimeAPI.createRuntime(ctx, runtimeAPI.readOptions());
    const request = { url: 'https://fixture.invalid/data' };
    const [a, b] = await Promise.all([runtime.fetch(request), runtime.fetch(request)]);
    assert.equal(calls, 1); assert.equal(a, b); assert.equal(a.headers.ETag, 'fixture-etag');
});

test('原生 fetch 拒绝 HTTP、认证 URL 和非 GET/POST 方法', async () => {
    const runtime = runtimeAPI.createRuntime({ storage: storage() }, runtimeAPI.readOptions());
    for (const request of [{ url: 'http://fixture.invalid' }, { url: 'https://name:pass@fixture.invalid' }, { url: 'https://fixture.invalid', method: 'DELETE' }]) {
        await assert.rejects(runtime.fetch(request));
    }
});

test('原生 fetch 每次核心调用最多发送 16 个不同请求', async () => {
    let calls = 0;
    const runtime = runtimeAPI.createRuntime({ storage: storage(), http: { get: async () => { calls++; return response({}); } } }, runtimeAPI.readOptions());
    for (let i = 0; i < 16; i++) await runtime.fetch({ url: `https://fixture.invalid/${i}` });
    await assert.rejects(runtime.fetch({ url: 'https://fixture.invalid/17' }));
    assert.equal(calls, 16);
});

test('最终产物在没有 Node.js、旧全局 API 或外部 import 的隔离 ES module 环境中运行', async () => {
    const sandbox = vm.createContext({ URL, URLSearchParams, TextEncoder, TextDecoder, console: { log() {} } });
    const module = new vm.SourceTextModule(readFileSync(join(ROOT, 'apple-weather-enhancer.egern.js'), 'utf8'), { context: sandbox });
    await module.link(() => { throw new Error('不允许外部模块'); });
    await module.evaluate({ timeout: 1000 });
    const availability = await module.namespace.default(context());
    assert.equal(JSON.parse(availability.body).length, 11);
    const ctx = context({ body: weather(), url: WEATHER_URL, type: TYPE, env: PRESERVE });
    const output = await module.namespace.default(ctx);
    assert.equal(ArrayBuffer.isView(output.body), true);
    assert.equal(decode(output.body).currentWeather.temperature, 21.5);
    assert.equal(ctx.reads, 1);
});
