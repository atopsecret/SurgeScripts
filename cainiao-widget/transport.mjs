// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：原模块连接状态入口显式启用 CW_TRANSPORT_CHECK=true
// 依赖：core.mjs；只发送固定合成 Cookie，不读取个人登录存储
import {CW_TRANSPORT_STORE, CW_VERSION, md5} from './core.mjs';

export const CW_TRANSPORT_ECHO_URL = "https://postman-echo.com/headers";
export const CW_TRANSPORT_TEST_COOKIE = "CW_TEST=123";
const CW_TRANSPORT_WINDOW = 7 * 86400000;
const CW_TRANSPORT_LEASE = 30000;
const CW_TRANSPORT_BUDGET = 10000;
const CW_TRANSPORT_HTTP_TIMEOUT = 4000;
const CW_TRANSPORT_MAX_BYTES = 65536;
const CW_TRANSPORT_SAMPLE_KINDS = new Set(["NOT_RUN", "ECHO", "HTTP_UNKNOWN", "REDIRECT_UNKNOWN", "NETWORK_UNKNOWN",
    "SCHEMA_UNKNOWN", "SIZE_UNKNOWN", "TIMEOUT_UNKNOWN"]);
const CW_TRANSPORT_ROOT_LABELS = {
    DISABLED: "发送对照：未启用；手动、关闭和 HTTP 入口不发送测试请求。",
    RUNNING: "发送对照：正在执行固定合成 Cookie 检查，结果尚未确认。",
    COMPLETE: "发送对照：两种模式已检查；仅验证固定合成 Cookie，不确认个人登录。",
    INCOMPLETE_UNKNOWN: "发送对照：上次检查未完整保存，结果未知；原七天窗口内不重复请求。",
    EXPIRED: "发送对照：记录已到期，等待下一次显式检查。",
    STORAGE_UNKNOWN: "发送对照：本机写入或读取未确认，结果未知；已停止本轮请求。",
    STATE_UNKNOWN: "发送对照：本机记录格式未确认，结果未知；未重新请求。",
    MODE_CHANGED: "发送对照：连接模式已变化或无法确认，结果未知；已停止本轮检查。",
    SUPERSEDED: "发送对照：存储归属已变化，结果未知；旧任务已停止。",
    CLOCK_UNKNOWN: "发送对照：本机时间未确认，结果未知；已停止本轮检查。",
};

class CwTransportFailure extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
}

function cwTransportObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cwTransportExactKeys(value, keys) {
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function cwTransportTime(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function cwTransportEnabled(ctx) {
    try {
        if (!ctx || ctx.request || ctx.response) return false;
        const env = ctx.env || {};
        const value = env.CONNECTION_MODE, mode = value === undefined || value === null || value === "" ? "auto" : value;
        return mode === "auto" && env.CW_TRANSPORT_CHECK === "true";
    } catch { throw new CwTransportFailure("MODE_CHANGED"); }
}

function cwTransportSample(kind = "NOT_RUN", at = null, markerReceived = null, extraCookies = null) {
    return {kind, markerReceived, extraCookies, at};
}

function cwTransportCleanSample(value, startedAt, at) {
    if (!cwTransportObject(value) || !cwTransportExactKeys(value, ["kind", "markerReceived", "extraCookies", "at"])
        || !CW_TRANSPORT_SAMPLE_KINDS.has(value.kind)) return null;
    if (value.kind === "NOT_RUN") {
        if (value.at !== null || value.markerReceived !== null || value.extraCookies !== null) return null;
    } else {
        if (!cwTransportTime(value.at) || value.at < startedAt || value.at > at) return null;
        if (value.kind === "ECHO" ? typeof value.markerReceived !== "boolean" || typeof value.extraCookies !== "boolean"
            : value.markerReceived !== null || value.extraCookies !== null) return null;
    }
    return cwTransportSample(value.kind, value.at, value.markerReceived, value.extraCookies);
}

// 只重建固定字段；不把外来状态、回显正文或异常原文带入结果。
export function cwTransportState(value, now = Date.now()) {
    try {
        if (!cwTransportObject(value) || !cwTransportExactKeys(value, ["schema", "version", "runId", "kind", "startedAt", "leaseUntil", "at", "expiresAt", "omit", "include"])
            || value.schema !== 1 || !["1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", CW_VERSION].includes(value.version) || !["RUNNING", "COMPLETE"].includes(value.kind)
            || typeof value.runId !== "string" || !/^[0-9a-f]{32}$/.test(value.runId) || !cwTransportTime(now)
            || !cwTransportTime(value.startedAt) || value.startedAt > now + 60000 || !cwTransportTime(value.at)
            || value.at < value.startedAt || value.at > now + 60000 || !cwTransportTime(value.leaseUntil)
            || value.leaseUntil !== value.startedAt + CW_TRANSPORT_LEASE || value.at >= value.leaseUntil
            || !cwTransportTime(value.expiresAt) || value.expiresAt !== value.startedAt + CW_TRANSPORT_WINDOW) return null;
        const omit = cwTransportCleanSample(value.omit, value.startedAt, value.at);
        const include = cwTransportCleanSample(value.include, value.startedAt, value.at);
        if (!omit || !include || include.kind !== "NOT_RUN" && omit.kind === "NOT_RUN"
            || value.kind === "COMPLETE" && (omit.kind === "NOT_RUN" || include.kind === "NOT_RUN")) return null;
        return {schema: 1, version: CW_VERSION, runId: value.runId, kind: value.kind, startedAt: value.startedAt,
            leaseUntil: value.leaseUntil, at: value.at, expiresAt: value.expiresAt, omit, include};
    } catch { return null; }
}

function cwTransportOutcome(kind, at = null) {
    return {kind, startedAt: null, at: cwTransportTime(at) ? at : null, expiresAt: null,
        omit: cwTransportSample(), include: cwTransportSample()};
}

function cwTransportPublicState(state, now) {
    if (now >= state.expiresAt) return cwTransportOutcome("EXPIRED", now);
    const kind = state.kind === "RUNNING" && now >= state.leaseUntil ? "INCOMPLETE_UNKNOWN" : state.kind;
    return {kind, startedAt: state.startedAt, at: state.at, expiresAt: state.expiresAt,
        omit: {...state.omit}, include: {...state.include}};
}

function cwTransportUtf8Size(raw) {
    let bytes = 0;
    for (const character of raw) {
        const code = character.codePointAt(0);
        bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
        if (bytes > CW_TRANSPORT_MAX_BYTES) return bytes;
    }
    return bytes;
}

function cwTransportCookieFlags(value) {
    if (!value.trim()) return {markerReceived: false, extraCookies: false};
    let markers = 0, extras = 0;
    for (const segment of value.split(";")) {
        const pair = segment.trim(), split = pair.indexOf("=");
        if (split < 1 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(pair.slice(0, split))) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        const cookieValue = pair.slice(split + 1);
        if (!/^(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.test(cookieValue)) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        if (pair === CW_TRANSPORT_TEST_COOKIE) markers++;
        else extras++;
    }
    return {markerReceived: markers > 0, extraCookies: extras > 0 || markers > 1};
}

// /headers 的已知 JSON 形状只有一个 headers 对象和字符串值。
// 小型定形解析器也拒绝重复／转义后同名键，不使用 JSON.parse 的后值覆盖来猜标记。
export function cwTransportEcho(raw) {
    const unknown = kind => ({kind, markerReceived: null, extraCookies: null});
    if (typeof raw !== "string") return unknown("SCHEMA_UNKNOWN");
    if (raw.length > CW_TRANSPORT_MAX_BYTES || cwTransportUtf8Size(raw) > CW_TRANSPORT_MAX_BYTES) return unknown("SIZE_UNKNOWN");
    try {
        let cursor = 0, count = 0, cookie = "";
        const names = new Set();
        const whitespace = () => { while (cursor < raw.length && /[\x20\t\r\n]/.test(raw[cursor])) cursor++; };
        const expect = character => {
            whitespace();
            if (raw[cursor++] !== character) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        };
        const string = () => {
            whitespace();
            const start = cursor;
            if (raw[cursor++] !== '"') throw new CwTransportFailure("SCHEMA_UNKNOWN");
            while (cursor < raw.length) {
                const character = raw[cursor++];
                if (character === "\\") { cursor++; continue; }
                if (character === '"') return JSON.parse(raw.slice(start, cursor));
            }
            throw new CwTransportFailure("SCHEMA_UNKNOWN");
        };
        expect("{");
        if (string() !== "headers") throw new CwTransportFailure("SCHEMA_UNKNOWN");
        expect(":"); expect("{"); whitespace();
        if (raw[cursor] !== "}") {
            while (true) {
                const name = string(); expect(":"); const value = string();
                if (++count > 128 || name.length > 128 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
                    || /[\x00-\x08\x0a-\x1f\x7f]/.test(value)) throw new CwTransportFailure("SCHEMA_UNKNOWN");
                const key = name.toLowerCase();
                if (names.has(key)) throw new CwTransportFailure("SCHEMA_UNKNOWN");
                names.add(key);
                if (key === "cookie") cookie = value;
                whitespace();
                if (raw[cursor] !== ",") break;
                cursor++;
            }
        }
        expect("}"); expect("}"); whitespace();
        if (cursor !== raw.length) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        return {kind: "ECHO", ...cwTransportCookieFlags(cookie)};
    } catch { return unknown("SCHEMA_UNKNOWN"); }
}

async function cwTransportBounded(task, deadline, tick, maxWait) {
    const startedAt = tick(), remaining = deadline - startedAt;
    if (remaining <= 0) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
    const wait = Math.min(remaining, maxWait || remaining), operationDeadline = startedAt + wait;
    let timer;
    try {
        const work = Promise.resolve().then(() => {
            if (tick() >= operationDeadline) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
            return task();
        });
        const limit = typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function"
            ? new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new CwTransportFailure("TIMEOUT_UNKNOWN")), wait); }) : null;
        let result;
        try { result = await (limit ? Promise.race([work, limit]) : work); }
        catch (error) {
            if (tick() >= operationDeadline) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
            throw error;
        }
        if (tick() >= operationDeadline) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
        return result;
    } finally {
        if (timer !== undefined) globalThis.clearTimeout(timer);
    }
}

function cwTransportDecode(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++];
        if (first < 128) { parts.push(String.fromCharCode(first)); continue; }
        const length = first >= 194 && first <= 223 ? 1 : first >= 224 && first <= 239 ? 2 : first >= 240 && first <= 244 ? 3 : 0;
        if (!length || i + length > bytes.length) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        let code = first & (length === 1 ? 31 : length === 2 ? 15 : 7);
        for (let j = 0; j < length; j++) {
            const next = bytes[i++];
            if (next < 128 || next > 191) throw new CwTransportFailure("SCHEMA_UNKNOWN");
            code = code << 6 | next & 63;
        }
        if (code < (length === 1 ? 128 : length === 2 ? 2048 : 65536) || code >= 55296 && code <= 57343 || code > 1114111) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        parts.push(String.fromCodePoint(code));
    }
    return parts.join("");
}

async function cwTransportReadBody(response, deadline, tick, guard) {
    const body = response.body;
    if (!body || typeof body.getReader !== "function") {
        if (typeof response.text !== "function") throw new CwTransportFailure("SCHEMA_UNKNOWN");
        // text() 是官方 API；无流读取能力时只能在读完后检查大小，仍不保存正文。
        return cwTransportBounded(() => { guard(); return response.text(); }, deadline, tick);
    }
    const reader = body.getReader(), chunks = [];
    let size = 0, complete = false;
    try {
        for (let count = 0; count < 512; count++) {
            const row = await cwTransportBounded(() => { guard(); return reader.read(); }, deadline, tick);
            guard();
            if (!cwTransportObject(row) || typeof row.done !== "boolean") throw new CwTransportFailure("SCHEMA_UNKNOWN");
            if (row.done) { complete = true; break; }
            if (!ArrayBuffer.isView(row.value) || Object.prototype.toString.call(row.value) !== "[object Uint8Array]") throw new CwTransportFailure("SCHEMA_UNKNOWN");
            size += row.value.byteLength;
            if (size > CW_TRANSPORT_MAX_BYTES) throw new CwTransportFailure("SIZE_UNKNOWN");
            chunks.push(new Uint8Array(row.value));
        }
        if (!complete) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return cwTransportDecode(bytes);
    } finally {
        // 取消不是官方事务／超时保证；不等待可能挂起的取消操作，也不输出其异常。
        if (!complete && typeof reader.cancel === "function") {
            try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
        }
        if (typeof reader.releaseLock === "function") { try { reader.releaseLock(); } catch {} }
    }
}

async function cwTransportRequest(ctx, mode, deadline, tick, guard) {
    try {
        guard();
        const remaining = deadline - tick();
        if (remaining <= 0) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
        const response = await cwTransportBounded(() => {
            guard();
            const requestRemaining = deadline - tick();
            if (requestRemaining <= 0) throw new CwTransportFailure("TIMEOUT_UNKNOWN");
            return ctx.http.get(CW_TRANSPORT_ECHO_URL, {headers: {Cookie: CW_TRANSPORT_TEST_COOKIE, Accept: "application/json"},
                credentials: mode, redirect: "manual", insecureTls: false, timeout: Math.max(1, Math.min(CW_TRANSPORT_HTTP_TIMEOUT, requestRemaining))});
        }, deadline, tick, CW_TRANSPORT_HTTP_TIMEOUT);
        guard();
        if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new CwTransportFailure("SCHEMA_UNKNOWN");
        if (response.status >= 300 && response.status < 400) throw new CwTransportFailure("REDIRECT_UNKNOWN");
        if (response.status !== 200) throw new CwTransportFailure("HTTP_UNKNOWN");
        let raw;
        try { raw = await cwTransportReadBody(response, deadline, tick, guard); }
        catch (error) { throw error instanceof CwTransportFailure ? error : new CwTransportFailure("SCHEMA_UNKNOWN"); }
        guard();
        return {...cwTransportEcho(raw), at: tick()};
    } catch (error) {
        if (error instanceof CwTransportFailure && ["MODE_CHANGED", "SUPERSEDED", "STORAGE_UNKNOWN", "CLOCK_UNKNOWN"].includes(error.kind)) throw error;
        const kind = error instanceof CwTransportFailure && CW_TRANSPORT_SAMPLE_KINDS.has(error.kind) ? error.kind : "NETWORK_UNKNOWN";
        return cwTransportSample(kind, tick());
    }
}

// 入口由原模块 generic 调度限定；helper 再拒绝 HTTP、关闭、手动和未显式启用的调用。
export async function runCainiaoTransportCheck(ctx, clock = () => Date.now()) {
    let now = null, record, lastTick;
    const tick = () => {
        let at;
        try { at = clock(); } catch { throw new CwTransportFailure("CLOCK_UNKNOWN"); }
        if (!cwTransportTime(at) || lastTick !== undefined && at < lastTick) throw new CwTransportFailure("CLOCK_UNKNOWN");
        lastTick = at;
        return at;
    };
    const read = () => {
        try { return ctx.storage.getJSON(CW_TRANSPORT_STORE); }
        catch { throw new CwTransportFailure("STORAGE_UNKNOWN"); }
    };
    const confirmed = expected => {
        const saved = cwTransportState(read(), tick());
        if (!saved || JSON.stringify(saved) !== JSON.stringify(expected)) throw new CwTransportFailure(saved && saved.runId !== expected.runId ? "SUPERSEDED" : "STORAGE_UNKNOWN");
    };
    const guard = () => {
        if (!cwTransportEnabled(ctx)) throw new CwTransportFailure("MODE_CHANGED");
        const at = tick(), saved = cwTransportState(read(), at);
        if (!saved || saved.runId !== record.runId || JSON.stringify(saved) !== JSON.stringify(record) || at >= record.leaseUntil) throw new CwTransportFailure("SUPERSEDED");
        if (!cwTransportEnabled(ctx)) throw new CwTransportFailure("MODE_CHANGED");
        if (tick() >= record.leaseUntil) throw new CwTransportFailure("SUPERSEDED");
    };
    const persist = next => {
        guard();
        try { ctx.storage.setJSON(CW_TRANSPORT_STORE, next); }
        catch { throw new CwTransportFailure("STORAGE_UNKNOWN"); }
        confirmed(next);
        record = next;
        guard();
    };
    try {
        if (!cwTransportEnabled(ctx)) return cwTransportOutcome("DISABLED");
        now = tick();
        const raw = read(), old = raw === null || raw === undefined ? null : cwTransportState(raw, now);
        if (raw !== null && raw !== undefined && !old) return cwTransportOutcome("STATE_UNKNOWN", now);
        if (old && now < old.expiresAt) return cwTransportPublicState(old, now);
        const previous = JSON.stringify(old);
        record = {schema: 1, version: CW_VERSION, runId: md5("transport:" + now + ":" + Math.random() + ":" + Math.random()),
            kind: "RUNNING", startedAt: now, leaseUntil: now + CW_TRANSPORT_LEASE, at: now, expiresAt: now + CW_TRANSPORT_WINDOW,
            omit: cwTransportSample(), include: cwTransportSample()};
        if (!cwTransportEnabled(ctx)) throw new CwTransportFailure("MODE_CHANGED");
        const currentRaw = read(), current = currentRaw === null || currentRaw === undefined ? null : cwTransportState(currentRaw, tick());
        if (currentRaw !== null && currentRaw !== undefined && !current || JSON.stringify(current) !== previous) throw new CwTransportFailure("SUPERSEDED");
        if (!cwTransportEnabled(ctx)) throw new CwTransportFailure("MODE_CHANGED");
        try { ctx.storage.setJSON(CW_TRANSPORT_STORE, record); }
        catch { throw new CwTransportFailure("STORAGE_UNKNOWN"); }
        confirmed(record); guard();
        const deadline = now + CW_TRANSPORT_BUDGET;
        for (const mode of ["omit", "include"]) {
            const sample = await cwTransportRequest(ctx, mode, deadline, tick, guard);
            guard();
            persist({...record, [mode]: sample, at: tick()});
        }
        persist({...record, kind: "COMPLETE", at: tick()});
        return cwTransportPublicState(record, tick());
    } catch (error) {
        const kind = error instanceof CwTransportFailure && Object.hasOwn(CW_TRANSPORT_ROOT_LABELS, error.kind) ? error.kind : "STORAGE_UNKNOWN";
        return cwTransportOutcome(kind, lastTick ?? now);
    }
}

// 本轮写失败结果由调用者直接追加；不可用一次旧缓存读取覆盖本轮提示。
export function cwTransportResultLines(result, now = Date.now()) {
    try {
        const kind = cwTransportObject(result) && typeof result.kind === "string" && Object.hasOwn(CW_TRANSPORT_ROOT_LABELS, result.kind) ? result.kind : "STATE_UNKNOWN";
        const lines = [CW_TRANSPORT_ROOT_LABELS[kind]];
        if (!["RUNNING", "COMPLETE", "INCOMPLETE_UNKNOWN"].includes(kind)) return lines;
        if (!cwTransportTime(now) || !cwTransportTime(result.startedAt) || !cwTransportTime(result.at) || result.at < result.startedAt
            || result.at > now + 60000 || result.expiresAt !== result.startedAt + CW_TRANSPORT_WINDOW) return [CW_TRANSPORT_ROOT_LABELS.STATE_UNKNOWN];
        if (now >= result.expiresAt) return [CW_TRANSPORT_ROOT_LABELS.EXPIRED];
        for (const mode of ["omit", "include"]) {
            const sample = cwTransportCleanSample(result[mode], result.startedAt, result.at);
            if (!sample) return [CW_TRANSPORT_ROOT_LABELS.STATE_UNKNOWN];
            if (sample.kind === "ECHO") lines.push(mode + "：测试标记" + (sample.markerReceived ? "已收到" : "未收到")
                + "；额外或重复 Cookie：" + (sample.extraCookies ? "有" : "无"));
            else lines.push(mode + "：结果未知（" + sample.kind + "），不能据此认定 Cookie 被剥离。");
        }
        lines.push("发送对照时间：" + new Date(result.at).toISOString());
        return lines;
    } catch { return [CW_TRANSPORT_ROOT_LABELS.STATE_UNKNOWN]; }
}

// 只读独立键；不续期、不触碰个人 auth/cache、不输出 runId 或任何回显值。
export function cwTransportLines(ctx, now = Date.now()) {
    try {
        const raw = ctx.storage.getJSON(CW_TRANSPORT_STORE);
        if (raw === null || raw === undefined) return ["发送对照：尚无已确认的本机记录。"];
        const state = cwTransportState(raw, now);
        return cwTransportResultLines(state ? cwTransportPublicState(state, now) : cwTransportOutcome("STATE_UNKNOWN"), now);
    } catch { return [CW_TRANSPORT_ROOT_LABELS.STORAGE_UNKNOWN]; }
}
