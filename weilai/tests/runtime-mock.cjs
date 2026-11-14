// Engine | Node.js 20+ | CommonJS
// Build: node --check weilai/tests/runtime-mock.cjs
// Run: 被 weilai/tests/checkin.test.cjs 与 nio.test.cjs 共用。
// Deps: Node.js 内置模块；虚拟时钟、存储、HTTP 与通知，无真实请求。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const canonicalSource = path.join(root, 'weilai-auto-checkin.js');
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
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
async function start(options = {}) {
    const c = options.clock || clock();
    const store = options.store || new Map();
    const reads = [], writes = [], calls = [], callbacks = [], logs = [], notices = [];
    const timers = new Map(), responses = (options.responses || []).slice();
    let serial = 0, doneCount = 0, result, failure;
    class MockDate extends nativeDate {
        constructor(...args) { super(...(args.length ? args : [c.now])); }
        static now() { return c.now; }
    }
    const environment = { store, reads, writes, calls, callbacks, clock: c };
    const sandbox = {
        Date: MockDate, Uint8Array, ArrayBuffer,
        console: {
            log: (...items) => logs.push(items.map(String).join(' ')),
            error: (...items) => logs.push(items.map(String).join(' '))
        },
        $script: { type: options.type || 'generic', name: 'weilai-offline-mock', binaryBodyMode: true },
        $environment: { system: 'iOS', 'surge-version': '6.0.0' },
        $persistentStore: {
            read(key) {
                reads.push(key);
                if (options.onRead) {
                    const value = options.onRead(key, environment);
                    if (value !== undefined) return value;
                }
                return store.has(key) ? store.get(key) : null;
            },
            write(data, key) {
                writes.push({ key, data });
                if (options.onWrite) {
                    const value = options.onWrite(data, key, environment);
                    if (value !== undefined) return value;
                }
                store.set(key, data);
                return true;
            }
        },
        $notification: { post(title, subtitle, body, noticeOptions) {
            if (options.notificationThrows) throw new Error('fixture notification failure');
            notices.push({ title, subtitle, body, options: plain(noticeOptions) });
        } },
        $httpClient: { post(request, callback) {
            calls.push(plain(request)); callbacks.push(callback);
            if (options.onPost) options.onPost(request, environment);
            const next = responses.shift();
            if (!next) {
                if (!options.allowPending) failure = new Error('Unexpected mock HTTP request');
                return;
            }
            if (typeof next === 'function') { next(request, callback, environment); return; }
            if (next.throw) throw new Error('fixture HTTP API error');
            if (next.never) return;
            queueMicrotask(() => {
                try {
                    if (next.before) next.before(environment);
                    callback(next.error || null, next.noResponse ? null : {
                        status: next.status === undefined ? 200 : next.status,
                        headers: next.headers || {}
                    }, Object.hasOwn(next, 'data') ? next.data : bodySuccess());
                } catch (error) { failure = error; }
            });
        } },
        $done(value) {
            doneCount++;
            if (doneCount !== 1) { failure = new Error('Multiple $done calls'); return; }
            result = value;
        },
        setTimeout(callback, milliseconds) {
            if (options.onTimer) options.onTimer(milliseconds, environment);
            const requested = Number(milliseconds);
            if (!Number.isFinite(requested) || requested < 0) throw new Error('Invalid mock timer');
            const id = ++serial;
            timers.set(id, { callback, at: c.now + requested, requested });
            return id;
        },
        clearTimeout(id) { timers.delete(id); }
    };
    if (options.request) sandbox.$request = options.request;
    if (options.response) sandbox.$response = options.response;
    if (options.cronexp) sandbox.$cronexp = options.cronexp;
    if (options.withoutClearTimeout) delete sandbox.clearTimeout;
    if (options.omitScript) delete sandbox.$script;
    if (options.extraGlobals) Object.assign(sandbox, options.extraGlobals);
    const context = vm.createContext(sandbox);
    const sourcePath = options.sourcePath || process.env.NIO_SURGE_SOURCE_OVERRIDE || canonicalSource;
    const source = fs.readFileSync(sourcePath, 'utf8');
    vm.runInContext(source, context, { filename: sourcePath, timeout: 1000 });
    await flush();
    function checkFailure() { if (failure) throw failure; }
    async function advance(milliseconds) {
        await flush(); checkFailure();
        const target = c.now + milliseconds;
        if (!Number.isFinite(target) || milliseconds < 0) throw new Error('Invalid clock advance');
        for (let turns = 0; turns < 1000; turns++) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!next || next[1].at > target) { c.now = target; await flush(); checkFailure(); return; }
            timers.delete(next[0]); c.now = next[1].at; next[1].callback();
            await flush(); checkFailure();
        }
        throw new Error('Mock timer loop');
    }
    const handle = {
        store, reads, writes, calls, callbacks, logs, notices, clock: c, context, timers,
        advance, flush,
        get doneCount() { return doneCount; },
        get result() { return result; },
        get plainResult() { return plain(result); },
        async settle() {
            for (let turns = 0; turns < 1000; turns++) {
                await flush(); checkFailure();
                if (doneCount === 1) return handle;
                const next = [...timers.values()].sort((a, b) => a.at - b.at)[0];
                if (!next) throw new Error('Mock script did not finish and has no pending timer');
                await advance(Math.max(0, next.at - c.now));
            }
            throw new Error('Mock script completion loop');
        }
    };
    checkFailure();
    return handle;
}
async function nio(options = {}) { return (await start(options)).settle(); }
module.exports = { start, nio, clock, savedState, storeFor, bodySuccess, plain, flush, TOKEN, TOKEN_B, UA, URL, KEYS, root, canonicalSource };
