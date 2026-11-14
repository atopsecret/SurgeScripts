// Engine | Surge iOS 6.x WebView | JavaScript
// Build: node apple-weather/build-surge.mjs
// Run: apple-weather/apple-weather-enhancer.sgmodule (availability, weather, generic diagnostics)
// Deps: Surge globals; the exact committed Egern 1.0.0 bundle is embedded at build time.
// Map documented Egern APIs to Surge; keep parameters, HTTP timeout units and body fallback.
// WeatherKit v3.1.0 / FlatBuffers 24.12.23 algorithms are not rewritten here.

// A generic run always diagnoses, even if Surge exposes a request object.
// HTTP responses route by URL, not script name, arguments, or binary-body-mode.
function weatherRoute() {
    const type = typeof $script === 'undefined' ? '' : String($script?.type || '').toLowerCase();
    if (type === 'generic') return 'diagnostic';
    if (type && type !== 'http-response') return 'passthrough';
    if (typeof $request === 'undefined' || !$request) return type ? 'passthrough' : 'diagnostic';
    try {
        const url = new URL($request.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== 'weatherkit.apple.com' || url.username || url.password || url.port) return 'passthrough';
        if (url.pathname.startsWith('/api/v1/availability/')) return 'availability';
        if (url.pathname.startsWith('/api/v2/weather/')) return 'weather';
    } catch (_) { /* An unknown URL is not a manual diagnostic invocation. */ }
    return 'passthrough';
}

function weatherParameters(argument) {
    const defaults = {
        'Weather.Provider': 'ColorfulClouds',
        'NextHour.Provider': 'ColorfulClouds',
        'AirQuality.Calculate.Algorithm': 'EU_EAQI',
        'API.ColorfulClouds.Token': '',
        'API.QWeather.Host': 'devapi.qweather.com',
        'API.QWeather.Token': '',
        'API.WAQI.Token': '',
        LogLevel: 'WARN',
    };
    if (argument === undefined || argument === null || String(argument).trim() === '') return defaults;
    const text = String(argument).trim();
    if (text.startsWith('{')) {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid weather arguments');
        for (const key of Object.keys(defaults)) if (Object.hasOwn(parsed, key)) defaults[key] = parsed[key];
    } else {
        const values = new URLSearchParams(text);
        for (const key of Object.keys(defaults)) if (values.has(key)) defaults[key] = values.get(key);
    }
    return defaults;
}

function weatherBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new Error('Weather response needs a binary body');
}

function weatherText(value) {
    if (typeof value === 'string') return value;
    return new TextDecoder('utf-8').decode(weatherBytes(value));
}

class WeatherHeaders {
    constructor(headers) {
        this.arrayMode = Array.isArray(headers);
        this.fields = this.arrayMode
            ? headers.map(item => ({ field: String(item.field), value: String(item.value) }))
            : Object.entries(headers || {}).map(([field, value]) => ({ field, value: String(value) }));
    }
    get(name) {
        const key = String(name).toLowerCase();
        const found = this.fields.find(item => item.field.toLowerCase() === key);
        return found ? found.value : null;
    }
    has(name) { return this.get(name) !== null; }
    delete(name) {
        const key = String(name).toLowerCase();
        this.fields = this.fields.filter(item => item.field.toLowerCase() !== key);
    }
    toSurge() {
        if (this.arrayMode) return this.fields.map(item => ({ ...item }));
        return Object.fromEntries(this.fields.map(item => [item.field, item.value]));
    }
}

function weatherStorage() {
    const prefix = 'surge_ios_weather_';
    const keyFor = key => prefix + String(key).replace(/[^A-Za-z0-9_.-]/g, '_');
    return {
        getJSON(key) {
            const value = $persistentStore.read(keyFor(key));
            if (value === null || value === undefined || value === '') return null;
            return JSON.parse(value);
        },
        setJSON(key, value) {
            if ($persistentStore.write(JSON.stringify(value), keyFor(key)) !== true) throw new Error('Weather storage write failed');
        },
    };
}

function weatherHTTP(method, url, options = {}) {
    return new Promise((resolve, reject) => {
        if (typeof $httpClient === 'undefined' || typeof $httpClient[method] !== 'function') {
            reject(new Error('Weather HTTP adapter unavailable'));
            return;
        }
        const timeoutMilliseconds = Number(options.timeout ?? 7000);
        if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
            reject(new Error('Invalid weather request timeout'));
            return;
        }
        const request = {
            url: String(url),
            headers: { ...(options.headers || {}) },
            timeout: timeoutMilliseconds / 1000,
            'auto-cookie': options.credentials !== 'omit',
            'auto-redirect': options.redirect !== 'error',
            'binary-mode': false,
        };
        if (Object.hasOwn(options, 'body')) request.body = options.body;
        $httpClient[method](request, (error, response, data) => {
            if (error || !response) {
                reject(new Error('Weather data source request failed'));
                return;
            }
            const status = Number(response.status ?? response.statusCode);
            if (options.redirect === 'error' && status >= 300 && status < 400 && status !== 304) {
                reject(new Error('Weather data source redirect rejected'));
                return;
            }
            let read = false;
            resolve({
                status,
                headers: new WeatherHeaders(response.headers),
                async text() {
                    if (read) throw new Error('Weather data source body consumed');
                    read = true;
                    if (data === undefined || data === null) return '';
                    return weatherText(data);
                },
            });
        });
    });
}

function weatherContext(mode) {
    const context = {
        env: weatherParameters(typeof $argument === 'undefined' ? undefined : $argument),
        storage: weatherStorage(),
        http: {
            get: (url, options) => weatherHTTP('get', url, options),
            post: (url, options) => weatherHTTP('post', url, options),
        },
    };
    if (mode === 'diagnostic') return context;
    if (typeof $request !== 'undefined') {
        context.request = {
            url: $request.url,
            method: String($request.method || 'GET').toUpperCase(),
            headers: new WeatherHeaders($request.headers),
        };
    }
    if (typeof $response !== 'undefined') {
        let consumed = false;
        const original = $response.body;
        const read = () => {
            if (consumed) throw new Error('Weather response body consumed');
            consumed = true;
            return original;
        };
        context.response = {
            status: Number($response.status ?? $response.statusCode),
            headers: new WeatherHeaders($response.headers),
            async text() { return weatherText(read()); },
            async arrayBuffer() {
                const bytes = weatherBytes(read());
                return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
        };
    }
    return context;
}

function weatherSurgeResult(result, mode) {
    if (mode === 'diagnostic') {
        const text = Array.isArray(result?.children)
            ? result.children.filter(item => item?.type === 'text').map(item => item.text).join('\n')
            : 'Apple 天气增强 · Surge iOS\n核心：WeatherKit v3.1.0';
        const content = text.replace('Apple 天气增强 · Egern 1.0.0', 'Apple 天气增强 · Surge iOS（同版本 Egern 1.0.0 核心）');
        console.log(content);
        return { title: 'Apple 天气增强', content, icon: 'cloud.sun.fill' };
    }
    if (!result || typeof result !== 'object' || !Object.hasOwn(result, 'body')) return {};
    // The exact Egern wrapper returns headers only after a successful rewrite.
    // Its body-only results are restore/no-change paths: preserve Surge's original bytes.
    if (!result.headers) return {};
    let body = result.body;
    if (typeof body !== 'string') body = weatherBytes(body);
    const binaryMode = typeof $script !== 'undefined' && $script.binaryBodyMode === true;
    if (binaryMode && typeof body === 'string') body = new TextEncoder().encode(body);
    const output = { body };
    if (result.headers instanceof WeatherHeaders) output.headers = result.headers.toSurge();
    else if (result.headers) output.headers = result.headers;
    return output;
}

async function weatherRun(mode, handler) {
    let completed = false;
    const finish = result => {
        if (completed) return;
        completed = true;
        $done(result);
    };
    try {
        if (mode === 'passthrough') {
            finish({});
            return;
        }
        const context = weatherContext(mode);
        const result = await handler(context);
        finish(weatherSurgeResult(result, mode));
    } catch (_) {
        console.log('[AppleWeather Surge] 参数或适配失败，保留原响应。');
        finish({});
    }
}

void weatherRun(weatherRoute(), zi);
