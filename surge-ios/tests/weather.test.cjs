// Node.js | 24+ | CommonJS | isolated Surge / Egern mocks
// Build: none; use committed scripts and the pinned upstream bundle.
// Run: node --test surge-ios/tests/weather.test.cjs
// Deps: Node.js built-ins only. Every $httpClient request is intercepted.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const os = require('node:os');
const { publishRoot: ROOT, fixtureRoot } = require('./layout.cjs');
const WEATHER_FIXTURES = path.join(fixtureRoot, 'weather');
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surge-ios-weather-'));
after(() => fs.rmSync(evidenceRoot, { recursive: true, force: true }));
const FIXED_TIME = 1794099600000;
const WEATHER_URL = 'https://weatherkit.apple.com/api/v2/weather/zh-Hans-CN/31.2/121.5?country=CN&dataSets=currentWeather';
const AVAIL_URL = 'https://weatherkit.apple.com/api/v1/availability/zh-Hans-CN/31.2/121.5';
const TYPE = 'application/vnd.apple.flatbuffer';
const PRESERVE = { 'Weather.Provider': 'WeatherKit', 'NextHour.Provider': 'WeatherKit' };
let upstream;
let codec;
const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [FIXED_TIME])); }
    static now() { return FIXED_TIME; }
};
function globals(extra = {}) {
    return { URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Date: FixedDate, setTimeout, clearTimeout, ...extra };
}
function storage(values = new Map()) {
    return { values, read(key) { return values.get(key) ?? null; }, write(value, key) { values.set(key, value); return true; } };
}
function egernStorage(values = new Map()) {
    return { values, getJSON(key) { const value = values.get(key); return value === undefined ? null : JSON.parse(value); }, setJSON(key, value) { values.set(key, JSON.stringify(value)); } };
}
class HeadersMock {
    constructor(values = {}) { this.values = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])); }
    get(key) { return this.values.get(key.toLowerCase()) ?? null; }
    has(key) { return this.values.has(key.toLowerCase()); }
    delete(key) { this.values.delete(key.toLowerCase()); }
}
function egernContext({ body = '["currentWeather"]', url = AVAIL_URL, type = 'application/json', status = 200, env = {}, http, sharedStorage } = {}) {
    let read = false;
    const readBody = () => { if (read) throw new Error('Body consumed twice'); read = true; return body; };
    const call = async (requestURL, options) => {
        if (!http) throw new Error('All real HTTP disabled in test');
        const result = await http({ url: requestURL, ...options });
        return { status: result.status ?? 200, headers: new HeadersMock(result.headers || {}), async text() { return typeof result.body === 'string' ? result.body : JSON.stringify(result.body); } };
    };
    return {
        env, storage: sharedStorage || egernStorage(),
        request: { url, method: 'GET', headers: new HeadersMock() },
        response: {
            status, headers: new HeadersMock({ 'content-type': type }),
            async text() { const value = readBody(); return typeof value === 'string' ? value : new TextDecoder().decode(value); },
            async arrayBuffer() { const value = readBody(); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); },
        },
        http: { get: call, post: call },
    };
}
function encode(data) {
    const copy = structuredClone(data);
    if (copy.currentWeather) for (const part of ['Next1h', 'Next6h', 'Next24h', 'Previous1h', 'Previous6h', 'Previous24h']) copy.currentWeather[`precipitationAmount${part}ByType`] ||= [];
    const builder = new codec.Builder();
    builder.finish(codec.WeatherKit2.encode(builder, 'all', copy));
    return builder.asUint8Array().slice();
}
function decode(bytes) { return codec.WeatherKit2.decode(new codec.ByteBuffer(new Uint8Array(bytes)), 'all'); }
function sample(extra = {}) {
    return encode({ currentWeather: { temperature: 21.5, conditionCode: 'CLEAR', humidity: 55, uvIndex: 2 }, locationInfo: { countryCode: 'CN', primaryName: '离线样例', timeZone: 'Asia/Shanghai' }, ...extra });
}
async function runSurge({ mode = 'data', body = sample(), url = WEATHER_URL, type = TYPE, status = 200, method = 'GET', env = {}, http, sharedStore, binary, headers = {}, noRequest = false } = {}) {
    const requests = [];
    const logs = [];
    const persistent = sharedStore || storage();
    let doneCount = 0;
    let completed;
    let timer;
    const completion = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Mock Surge script did not finish')), 4000);
        completed = value => { doneCount += 1; resolve(value); };
    });
    const network = (options, callback) => {
        requests.push(options);
        Promise.resolve().then(async () => {
            if (!http) throw new Error('Real network prohibited');
            const result = await http(options);
            if (result.error) { callback(result.error, undefined, undefined); return; }
            callback(null, { status: result.status ?? 200, headers: result.headers || {} }, typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
        }).catch(error => callback(error.message, undefined, undefined));
    };
    const context = globals({
        console: { log(...items) { logs.push(items.join(' ')); } },
        $script: { type: mode === 'diagnostic' ? 'generic' : 'http-response', binaryBodyMode: binary ?? (mode === 'data') },
        $argument: new URLSearchParams(env).toString(),
        $persistentStore: persistent,
        $httpClient: { get: network, post: network },
        $done: completed,
    });
    if (mode !== 'diagnostic' && !noRequest) {
        context.$request = { url, method, headers: {} };
        context.$response = { status, headers: Array.isArray(headers) ? headers : { 'content-type': type, ...headers }, body };
    }
    const sandbox = vm.createContext(context);
    new vm.Script(fs.readFileSync(path.join(ROOT, `scripts/weather-${mode}.js`), 'utf8')).runInContext(sandbox, { timeout: 1000 });
    try {
        const result = await completion;
        await Promise.resolve();
        return { result, requests, logs, persistent, doneCount, effectiveBody: Object.hasOwn(result, 'body') ? result.body : body };
    } finally { clearTimeout(timer); }
}
const realtime = {
    status: 'ok', location: [31.2, 121.5], server_time: FIXED_TIME / 1000,
    result: { server_time: FIXED_TIME / 1000, realtime: {
        status: 'ok', temperature: 27.25, apparent_temperature: 29, cloudrate: 0.2,
        skycon: 'CLEAR_DAY', humidity: 0.65, pressure: 101300, visibility: 18,
        precipitation: { local: { intensity: 0 } }, wind: { direction: 90, speed: 8 },
    } },
};
before(() => {
    const source = fs.readFileSync(path.join(WEATHER_FIXTURES, 'apple-weather-enhancer.egern.js'), 'utf8');
    const modified = source.replace('export{ui as createEngine,zi as default};', 'globalThis.__upstream={createEngine:ui,handler:zi,createRuntime:yi,readOptions:hi};');
    const context = vm.createContext(globals({ console: { log() {}, warn() {}, error() {} } }));
    new vm.Script(modified).runInContext(context, { timeout: 1000 });
    upstream = context.__upstream;
    codec = upstream.createEngine(upstream.createRuntime({ storage: egernStorage() }, upstream.readOptions(PRESERVE)));
});

test('all three production scripts are self-contained and keep the fixed v3.1.0 source', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(WEATHER_FIXTURES, 'source.json')));
    assert.equal(manifest.source.weatherKitVersion, 'v3.1.0');
    assert.equal(manifest.source.flatBuffersVersion, '24.12.23');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(WEATHER_FIXTURES, 'apple-weather-enhancer.egern.js'))).digest('hex'), manifest.source.scriptSHA256);
    for (const mode of ['availability', 'data', 'diagnostic']) {
        const code = fs.readFileSync(path.join(ROOT, `scripts/weather-${mode}.js`), 'utf8');
        assert.doesNotMatch(code, /\bimport\s*(?:\(|['"{*])|\bexport\s*[{*]|\brequire\s*\(|\beval\s*\(|new Function/);
        new vm.Script(code);
    }
});
test('availability expands to 11 datasets with no HTTP and matches the exact Egern wrapper', async () => {
    const body = '["currentWeather"]';
    const result = await runSurge({ mode: 'availability', body, url: AVAIL_URL, type: 'application/json' });
    const reference = await upstream.handler(egernContext({ body }));
    assert.equal(result.result.body, reference.body);
    assert.equal(JSON.parse(result.result.body).length, 11);
    assert.equal(result.requests.length, 0);
    assert.equal(result.doneCount, 1);
});
test('availability also returns Uint8Array when the Surge binary flag is set', async () => {
    const result = await runSurge({ mode: 'availability', body: new TextEncoder().encode('["currentWeather"]'), url: AVAIL_URL, type: 'application/json', binary: true });
    assert.ok(result.result.body instanceof Uint8Array);
    assert.equal(JSON.parse(new TextDecoder().decode(result.result.body)).length, 11);
});
test('a real FlatBuffers sample encodes and decodes known original semantics', () => {
    const body = sample();
    assert.ok(body instanceof Uint8Array);
    assert.ok(body.length > 12);
    assert.equal(decode(body).currentWeather.temperature, 21.5);
    assert.equal(decode(body).locationInfo.primaryName, '离线样例');
});
test('default ColorfulClouds modifies temperature while retaining binary type and location', async () => {
    const original = sample();
    const result = await runSurge({ body: original, http: async () => ({ body: realtime }) });
    assert.ok(result.result.body instanceof Uint8Array);
    assert.equal(decode(result.result.body).currentWeather.temperature, 27.25);
    assert.equal(decode(result.result.body).locationInfo.primaryName, '离线样例');
    assert.notDeepEqual(Buffer.from(result.result.body), Buffer.from(original));
    assert.equal(result.requests.length, 1);
    const evidence = {
        input: { type: 'Uint8Array', bytes: original.length, sha256: crypto.createHash('sha256').update(original).digest('hex'), semantic: { temperature: decode(original).currentWeather.temperature, locationName: decode(original).locationInfo.primaryName } },
        output: { type: 'Uint8Array', bytes: result.result.body.length, sha256: crypto.createHash('sha256').update(result.result.body).digest('hex'), semantic: { temperature: decode(result.result.body).currentWeather.temperature, locationName: decode(result.result.body).locationInfo.primaryName } },
        dataSource: 'mock ColorfulClouds response', externalNetworkRequests: 0,
    };
    fs.writeFileSync(path.join(evidenceRoot, 'flatbuffers-before.bin'), original);
    fs.writeFileSync(path.join(evidenceRoot, 'flatbuffers-after.bin'), result.result.body);
    fs.writeFileSync(path.join(evidenceRoot, 'flatbuffers-roundtrip.json'), JSON.stringify(evidence, null, 2) + '\n');
});
test('default current weather output is byte-identical to the same Egern core', async () => {
    const body = sample();
    const mock = async () => ({ body: realtime });
    const result = await runSurge({ body, env: { 'API.ColorfulClouds.Token': 'fixture-token' }, http: mock });
    const reference = await upstream.handler(egernContext({ body, url: WEATHER_URL, type: TYPE, env: { 'API.ColorfulClouds.Token': 'fixture-token' }, http: mock }));
    assert.deepEqual(Buffer.from(result.result.body), Buffer.from(reference.body));
});
test('ctx.http milliseconds become seconds and omit cookies/redirects', async () => {
    const result = await runSurge({ http: async () => ({ body: realtime }) });
    assert.equal(result.requests[0].timeout, 7);
    assert.equal(result.requests[0]['auto-cookie'], false);
    assert.equal(result.requests[0]['auto-redirect'], false);
    assert.equal(result.requests[0]['binary-mode'], false);
});
test('WeatherKit-only mode preserves original weather without data-source requests', async () => {
    const body = sample();
    const result = await runSurge({ body, env: PRESERVE });
    assert.ok(result.effectiveBody instanceof Uint8Array);
    assert.equal(decode(result.effectiveBody).currentWeather.temperature, 21.5);
    assert.equal(result.requests.length, 0);
});
test('subarray input uses only the correct byteOffset and byteLength', async () => {
    const body = sample();
    const allocation = new Uint8Array(body.length + 48);
    allocation.fill(255);
    allocation.set(body, 16);
    const result = await runSurge({ body: allocation.subarray(16, 16 + body.length), env: PRESERVE });
    assert.equal(decode(result.effectiveBody).currentWeather.temperature, 21.5);
    const canonical = await runSurge({ body, env: PRESERVE });
    assert.deepEqual(Buffer.from(result.effectiveBody), Buffer.from(canonical.effectiveBody));
});
test('modified responses remove stale length, encoding and digest headers case-insensitively', async () => {
    const result = await runSurge({ http: async () => ({ body: realtime }), headers: { 'Content-Length': '12', 'Content-Encoding': 'gzip', ETag: 'old', Digest: 'old', 'Transfer-Encoding': 'chunked', 'X-Keep': 'yes' } });
    for (const name of ['content-length', 'content-encoding', 'etag', 'digest', 'transfer-encoding']) assert.equal(Object.keys(result.result.headers).some(key => key.toLowerCase() === name), false);
    assert.equal(result.result.headers['X-Keep'], 'yes');
});
test('full-header mode preserves duplicate headers while removing stale metadata', async () => {
    const headers = [{ field: 'Content-Type', value: TYPE }, { field: 'Set-Cookie', value: 'fixture-a' }, { field: 'Set-Cookie', value: 'fixture-b' }, { field: 'Content-Length', value: '1' }];
    const result = await runSurge({ headers, http: async () => ({ body: realtime }) });
    assert.equal(Array.isArray(result.result.headers), true);
    assert.equal(result.result.headers.filter(item => item.field === 'Set-Cookie').length, 2);
    assert.equal(result.result.headers.some(item => item.field === 'Content-Length'), false);
});
test('default next-hour source supplies 85 minutes from a mock response', async () => {
    const minutely = { status: 'ok', location: [31.2, 121.5], server_time: FIXED_TIME / 1000, result: { minutely: { status: 'ok', probability: [0, 0, 0, 0], precipitation_2h: new Array(120).fill(0), description: '未来两小时无降水' } } };
    const result = await runSurge({ url: WEATHER_URL.replace('dataSets=currentWeather', 'dataSets=forecastNextHour'), http: async () => ({ body: minutely }) });
    assert.equal(decode(result.result.body).forecastNextHour.minutes.length, 85);
});
for (const algorithm of ['EU_EAQI', 'None', 'UBA', 'WAQI_InstantCast_US', 'WAQI_InstantCast_CN', 'WAQI_InstantCast_CN_25_DRAFT']) {
    test(`FlatBuffers AQI ${algorithm} matches same-version Egern output`, async () => {
        const body = sample({ airQuality: { metadata: { providerName: 'fixture', sourceType: 'STATION' }, index: 75, categoryIndex: 2, scale: 'HJ6332012.2414', previousDayComparison: 'SAME', primaryPollutant: 'PM2_5', pollutants: ['PM2_5', 'PM10', 'NO2', 'SO2', 'OZONE'].map(pollutantType => ({ pollutantType, amount: 35, units: 'MICROGRAMS_PER_CUBIC_METER' })) } });
        const env = { ...PRESERVE, 'AirQuality.Calculate.Algorithm': algorithm };
        const url = WEATHER_URL.replace('dataSets=currentWeather', 'dataSets=airQuality');
        const result = await runSurge({ body, url, env });
        const reference = await upstream.handler(egernContext({ body, url, type: TYPE, env }));
        assert.deepEqual(Buffer.from(result.effectiveBody), Buffer.from(reference.body));
        assert.equal(result.requests.length, 0);
        assert.equal(decode(result.effectiveBody).airQuality.previousDayComparison, 'SAME');
    });
}
for (const status of [204, 301, 401, 403, 429, 500]) test(`HTTP ${status} passes through without HTTP`, async () => {
    const result = await runSurge({ status });
    assert.equal(Object.keys(result.result).length, 0);
    assert.equal(result.requests.length, 0);
    assert.equal(result.doneCount, 1);
});
for (const url of ['https://example.invalid/api/v2/weather/zh-CN/31.2/121.5', 'https://weatherkit.apple.com.evil.invalid/api/v2/weather/zh-CN/31.2/121.5', 'https://fixture@weatherkit.apple.com/api/v2/weather/zh-CN/31.2/121.5', 'https://weatherkit.apple.com:8443/api/v2/weather/zh-CN/31.2/121.5', 'https://weatherkit.apple.com/api/v2/weather-other/x', 'not a URL']) test(`unrelated URL passes through: ${url}`, async () => {
    const result = await runSurge({ url });
    assert.equal(Object.keys(result.result).length, 0);
    assert.equal(result.requests.length, 0);
});
for (const body of [new Uint8Array(), new Uint8Array([1, 2, 3, 4]), new Uint8Array(20)]) test(`invalid FlatBuffers passes through unchanged: ${body.length} bytes`, async () => {
    const result = await runSurge({ body });
    assert.deepEqual(Buffer.from(result.effectiveBody), Buffer.from(body));
    assert.equal(result.requests.length, 0);
});
for (const type of ['application/octet-stream', 'text/html', 'application/grpc']) test(`unknown media type passes through: ${type}`, async () => {
    const result = await runSurge({ type });
    assert.equal(Object.keys(result.result).length, 0);
    assert.equal(result.requests.length, 0);
});
for (const body of ['{broken', '{"error":"fixture"}', '[1,2]']) test(`bad availability JSON remains untouched: ${body}`, async () => {
    const result = await runSurge({ mode: 'availability', body, url: AVAIL_URL, type: 'application/json' });
    assert.equal(result.effectiveBody, body);
    assert.equal(Object.keys(result.result).length, 0);
});
for (const failure of ['http', 'json', 'throw', 'redirect']) test(`data source ${failure} failure restores original bytes`, async () => {
    const body = sample();
    const result = await runSurge({ body, http: async () => {
        if (failure === 'throw') throw new Error('fixture secret stays private');
        return { status: failure === 'http' ? 429 : failure === 'redirect' ? 302 : 200, body: failure === 'json' ? '{broken' : '{}' };
    } });
    assert.deepEqual(Buffer.from(result.effectiveBody), Buffer.from(body));
    assert.equal(Object.keys(result.result).length, 0);
});
test('malformed UTF-8 binary availability data remains byte-for-byte untouched', async () => {
    const body = new Uint8Array([0xff, 0xfe, 0x7b, 0x22, 0x78]);
    const result = await runSurge({ mode: 'availability', body, url: AVAIL_URL, type: 'application/json', binary: true });
    assert.equal(Object.keys(result.result).length, 0);
    assert.deepEqual(Buffer.from(result.effectiveBody), Buffer.from(body));
    assert.equal(result.requests.length, 0);
});
test('QWeather custom host and X-QW-Api-Key are preserved', async () => {
    const result = await runSurge({ env: { 'Weather.Provider': 'QWeather', 'API.QWeather.Host': 'fixture.qweatherapi.com', 'API.QWeather.Token': 'fixture-key' }, http: async () => ({ body: { code: '200', updateTime: new FixedDate().toISOString(), now: { temp: '26', feelsLike: '28', icon: '100', humidity: '60', precip: '0', pressure: '1013', vis: '12', wind360: '90', windSpeed: '5', cloud: '20' }, fxLink: 'https://fixture.invalid/weather' } }) });
    assert.equal(result.requests[0].headers['X-QW-Api-Key'], 'fixture-key');
    assert.match(result.requests[0].url, /^https:\/\/fixture\.qweatherapi\.com/);
    assert.equal(decode(result.result.body).currentWeather.temperature, 26);
});
test('diagnostic uses shared persistent JSON keys with no network or secrets', async () => {
    const sharedStore = storage();
    await runSurge({ sharedStore, env: { 'API.ColorfulClouds.Token': 'PRIVATE_FIXTURE' }, http: async () => ({ body: realtime }) });
    const result = await runSurge({ mode: 'diagnostic', sharedStore, noRequest: true });
    assert.equal(result.result.title, 'Apple 天气增强');
    assert.match(result.result.content, /WeatherKit v3\.1\.0/);
    assert.equal(result.requests.length, 0);
    assert.doesNotMatch(JSON.stringify(result.result) + JSON.stringify([...sharedStore.values]), /PRIVATE_FIXTURE|31\.2|121\.5|api\.caiyunapp\.com/);
    assert.ok([...sharedStore.values.keys()].every(key => key.startsWith('surge_ios_weather_')));
    assert.equal(result.doneCount, 1);
});
test('HEAD and invalid coordinates leave original response untouched', async () => {
    const a = await runSurge({ method: 'HEAD' });
    const b = await runSurge({ url: WEATHER_URL.replace('/31.2/', '/91/') });
    assert.equal(Object.keys(a.result).length, 0);
    assert.equal(Object.keys(b.result).length, 0);
    assert.equal(a.requests.length + b.requests.length, 0);
});
test('module uses documented binary/engine parameters and no CA, global DNS or proxy sections', () => {
    const module = fs.readFileSync(path.join(ROOT, 'modules/ios-weather.sgmodule'), 'utf8');
    assert.match(module, /weather-data = .*binary-body-mode=true.*max-size=4194304.*timeout=30.*engine=webview/);
    assert.match(module, /weather-availability = .*binary-body-mode=false/);
    assert.doesNotMatch(module, /js-engine=|\[Module\]|\[General\]|\[Proxy\]|\[Proxy Group\]|ca-p12|ca-passphrase|127\.0\.0\.1|\/Users\//);
    assert.equal((module.match(/script-path=https:\/\/raw\.githubusercontent\.com\/atopsecret\/SurgeScripts\/main\/surge-ios\/scripts\/weather-/g) || []).length, 3);
});
