// Engine | Egern 原生 API | JavaScript ES module
// Build: cd apple-weather && npm run build
// Run: 随 apple-weather-enhancer.egern.js 调用
// Deps: 无；不访问旧客户端全局对象
export const VERSION = '1.0.0';
export const CACHE_KEY = 'apple_weather_enhancer_cache_v1';
export const DIAG_KEY = 'apple_weather_enhancer_diag_v1';
export const LIMIT = 4 * 1024 * 1024;
const PROVIDERS = ['ColorfulClouds', 'WeatherKit', 'QWeather'];
const ALGORITHMS = ['EU_EAQI', 'None', 'UBA', 'WAQI_InstantCast_US', 'WAQI_InstantCast_CN', 'WAQI_InstantCast_CN_25_DRAFT'];
const LEVELS = ['OFF', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'ALL'];

function get(object, path) {
    return path.split('.').reduce((node, key) => node?.[key], object);
}
function set(object, path, value) {
    const keys = path.split('.');
    let node = object;
    for (const key of keys.slice(0, -1)) node = node[key] ??= {};
    node[keys.at(-1)] = value;
}

export function readOptions(env = {}) {
    const options = {};
    for (const [key, allowed, fallback] of [
        ['Weather.Provider', PROVIDERS, 'ColorfulClouds'],
        ['NextHour.Provider', PROVIDERS, 'ColorfulClouds'],
        ['AirQuality.Calculate.Algorithm', ALGORITHMS, 'EU_EAQI'],
        ['LogLevel', LEVELS, 'WARN'],
    ]) {
        const value = env[key] ?? fallback;
        if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('无效选项');
        set(options, key, value);
    }
    for (const key of ['API.ColorfulClouds.Token', 'API.QWeather.Token', 'API.WAQI.Token']) {
        const value = env[key] ?? '';
        if (typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value)) throw new Error('无效令牌格式');
        set(options, key, value);
    }
    const host = env['API.QWeather.Host'] ?? 'devapi.qweather.com';
    if (typeof host !== 'string' || host.length > 253 || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(host)) {
        throw new Error('和风天气主机必须为域名，不含协议、路径或端口');
    }
    set(options, 'API.QWeather.Host', host);
    return options;
}

export function saveDiagnostic(ctx, kind, status, extra = {}) {
    try {
        const previous = ctx.storage.getJSON(DIAG_KEY);
        ctx.storage.setJSON(DIAG_KEY, {
            version: VERSION, at: new Date().toISOString(),
            hits: Math.max(0, Number(previous?.hits) || 0) + 1,
            kind, status, ...extra,
        });
    } catch (_) { /* 诊断失败不改变业务响应。 */ }
    // 只输出我们定义的摘要，不转发上游可能包含秘密的日志或异常。
    try {
        const selected = LEVELS.indexOf(ctx.env?.LogLevel ?? 'WARN');
        const severity = /失败/.test(status) ? 1 : /无需改写/.test(status) ? 3 : /保留|未知|未读取|过大/.test(status) ? 2 : 3;
        if (selected >= severity) console.log(`[AppleWeather ${VERSION}] ${kind}: ${status}`);
    } catch (_) { /* 日志接口失败也不阻断响应。 */ }
}

export function diagnostics(ctx) {
    let state;
    try { state = ctx.storage.getJSON(DIAG_KEY); } catch (_) { /* 未授权存储也能显示版本。 */ }
    const lines = [`Apple 天气增强 · Egern ${VERSION}`, '核心：WeatherKit v3.1.0'];
    if (state?.at) lines.push(`累计命中：${state.hits}`, `最近：${state.kind} / ${state.status}`, `时间：${state.at}`);
    else lines.push('尚无目标响应记录；请打开 Apple 天气后再检查。');
    return { type: 'widget', padding: 12, children: [{ type: 'text', text: lines.join('\n') }] };
}

export function createRuntime(ctx, options) {
    const runtime = { failed: false, calls: 0, upstreamErrors: 0 };
    const started = Date.now();
    const requests = new Map();
    // 上游日志含定位、令牌和完整响应，不直接转发。只记录错误计数。
    const noop = () => {};
    runtime.Console = { log: noop, info: noop, debug: noop, warn: noop, error() { runtime.failed = true; runtime.upstreamErrors++; } };
    runtime.Lodash = { get, set };
    runtime.Storage = { setItem(key, value) {
        if (key !== '@iRingo.WeatherKit.Caches') return;
        try { ctx.storage.setJSON(CACHE_KEY, value); } catch (_) { /* 缓存可重建。 */ }
    } };
    runtime.getStorage = (_name, _platform, database) => {
        // 每次调用深拷贝默认设置，避免 setENV 或数据源修改污染其它请求。
        const copy = JSON.parse(JSON.stringify(database));
        const Settings = { ...copy.Default.Settings, ...copy.WeatherKit.Settings };
        for (const path of ['Weather.Provider', 'NextHour.Provider', 'AirQuality.Calculate.Algorithm', 'API', 'LogLevel']) {
            set(Settings, path, get(options, path));
        }
        let Caches = {};
        try { Caches = ctx.storage.getJSON(CACHE_KEY) || {}; } catch (_) { /* 首次调用或缓存损坏。 */ }
        if (!Caches || typeof Caches !== 'object' || Array.isArray(Caches)) Caches = {};
        return { Settings, Caches, Configs: copy.WeatherKit.Configs };
    };
    runtime.fetch = async request => {
        const key = JSON.stringify(request);
        if (requests.has(key)) return requests.get(key);
        const task = (async () => {
            runtime.calls++;
            const remaining = 18000 - (Date.now() - started);
            const url = new URL(request.url);
            if (runtime.calls > 16 || remaining < 1 || url.protocol !== 'https:' || url.username || url.password) throw new Error('外部请求超出范围');
            const headers = {};
            for (const [name, value] of Object.entries(request.headers || {})) {
                if (value !== undefined && value !== null) headers[name] = String(value);
            }
            const method = String(request.method || (request.body !== undefined ? 'post' : 'get')).toLowerCase();
            if (!['get', 'post'].includes(method)) throw new Error('不支持的数据源方法');
            const response = await ctx.http[method](url.toString(), {
                headers, ...(request.body !== undefined ? { body: request.body } : {}),
                timeout: Math.min(7000, remaining), credentials: 'omit', redirect: 'error',
            });
            if (response.status !== 304 && (response.status < 200 || response.status >= 300)) throw new Error('数据源返回非成功状态');
            const body = response.status === 304 ? '' : await response.text();
            if (body.length > LIMIT * 2) throw new Error('数据源正文过大');
            return { status: response.status, headers: { ETag: response.headers.get('etag') }, body };
        })().catch(error => { runtime.failed = true; throw error; });
        requests.set(key, task);
        return task;
    };
    return runtime;
}
