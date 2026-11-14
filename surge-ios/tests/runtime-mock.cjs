// Node.js | 26+ | CommonJS
// Build: node --check surge-ios/tests/runtime-mock.cjs
// Run: used only by local *.test.cjs.
// Deps: node:vm and node:fs; all HTTP/storage/notifications are mocks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { publishRoot: root } = require('./layout.cjs');
const nativeDate = Date;
const TOKEN = 'Bearer fixture-NIO-token-1234567890';
const TOKEN_B = 'Bearer fixture-NIO-token-9876543210';
const UA = 'NIOAppCN/6.10.0 fixture-iOS-client';
const URL = 'https://gateway-front-external.nio.com/moat/10086/c/award_cn/checkin?app_id=10086';
const KEYS = Object.freeze({
    state: 'ios_nio_v3_auth_state_v1', journal: 'ios_nio_v3_checkin_v1',
    stats: 'ios_nio_v3_statistics_v1', notice: 'ios_nio_v3_capture_notice_v1', capture: 'ios_nio_v3_capture_status_v1'
});
function clock(at = '2026-11-14T01:00:00.000Z') { return { now: new nativeDate(at).getTime() }; }
function plain(value) {
    if (value instanceof Uint8Array || ArrayBuffer.isView(value)) return Array.from(value);
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function savedState(c, overrides = {}) {
    return { token: TOKEN, observedAt: c.now, invalid: false, userAgent: UA, generation: 'fixture-generation', ...overrides };
}
function storeFor(c, overrides = {}) {
    return new Map([[KEYS.state, JSON.stringify(savedState(c, overrides))]]);
}
function bodySuccess(stats = { continuous_checkin_days: 3, accumulate_days: 12 }) {
    return JSON.stringify({ result_code: 'success', data: { checked_in: true, stats } });
}
async function execute(filename, options = {}) {
    const c = options.clock || clock();
    const store = options.store || new Map();
    const reads = [], writes = [], calls = [], logs = [], notices = [], timers = new Set();
    const responses = (options.responses || []).slice();
    let doneCount = 0, result;
    let resolveDone, rejectDone;
    const complete = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    class MockDate extends nativeDate {
        constructor(...args) { super(...(args.length ? args : [c.now])); }
        static now() { return c.now; }
    }
    const sandbox = {
        Date: MockDate, Uint8Array, ArrayBuffer, console: {
            log: (...items) => logs.push(items.map(String).join(' ')),
            error: (...items) => logs.push(items.map(String).join(' '))
        },
        $script: { type: options.type || 'generic', name: 'ios-mock', binaryBodyMode: true },
        $environment: { system: 'iOS', 'surge-version': '6.0.0' },
        $persistentStore: {
            read(key) {
                reads.push(key);
                if (options.onRead) {
                    const value = options.onRead(key, { store, reads, writes, clock: c });
                    if (value !== undefined) return value;
                }
                return store.has(key) ? store.get(key) : null;
            },
            write(data, key) {
                writes.push({ key, data });
                if (options.onWrite) {
                    const value = options.onWrite(data, key, { store, reads, writes, clock: c });
                    if (value !== undefined) return value;
                }
                store.set(key, data);
                return true;
            }
        },
        $notification: { post(title, subtitle, body, noticeOptions) {
            notices.push({ title, subtitle, body, options: plain(noticeOptions) });
            if (options.notificationThrows) throw new Error('fixture notification failure');
        } },
        $httpClient: { post(request, callback) {
            calls.push(plain(request));
            const next = responses.shift();
            if (options.onPost) options.onPost(request, { store, calls, clock: c });
            if (!next) { rejectDone(new Error('Unexpected mock HTTP request')); return; }
            if (typeof next === 'function') { next(request, callback, { store, calls, clock: c }); return; }
            if (next.throw) throw new Error('fixture HTTP API error');
            if (next.never) return;
            queueMicrotask(() => {
                if (next.before) next.before({ store, calls, clock: c });
                callback(next.error || null, next.noResponse ? null : { status: next.status === undefined ? 200 : next.status, headers: next.headers || {} },
                    Object.hasOwn(next, 'data') ? next.data : bodySuccess());
            });
        } },
        $done(value) {
            doneCount++;
            if (doneCount !== 1) { rejectDone(new Error('Multiple $done calls')); return; }
            result = value;
            resolveDone();
        },
        setTimeout(callback, milliseconds) {
            const requested = Number(milliseconds);
            const wait = requested <= 3000 ? 1 : 15;
            const timer = setTimeout(() => {
                timers.delete(timer);
                c.now += requested;
                callback();
            }, wait);
            timers.add(timer);
            return timer;
        },
        clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    };
    if (options.request) sandbox.$request = options.request;
    if (options.response) sandbox.$response = options.response;
    if (options.cronexp) sandbox.$cronexp = options.cronexp;
    if (options.withoutClearTimeout) delete sandbox.clearTimeout;
    if (options.extraGlobals) Object.assign(sandbox, options.extraGlobals);
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(root, 'scripts', filename), 'utf8');
    let watchdog;
    try {
        vm.runInContext(source, context, { filename, timeout: 500 });
        await Promise.race([complete, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Mock script did not finish')), 400); })]);
        await new Promise(resolve => setImmediate(resolve));
        if (doneCount !== 1) throw new Error('Incorrect $done count');
        return { result, plainResult: plain(result), doneCount, store, reads, writes, calls, logs, notices, clock: c, context };
    } finally {
        clearTimeout(watchdog);
        for (const timer of timers) clearTimeout(timer);
    }
}
async function nio(options = {}) { return execute('nio-auto-checkin-ios.js', options); }
async function cam(options = {}) { return execute('camscanner-expiry-ios.js', { type: 'http-response', ...options }); }
module.exports = { execute, nio, cam, clock, savedState, storeFor, bodySuccess, plain, TOKEN, TOKEN_B, UA, URL, KEYS, root };
