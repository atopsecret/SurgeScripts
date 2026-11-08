// 引擎：Egern 原生请求头 API | 版本：1.2.3 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由同一小组件的请求入口调用；离线 node --test cainiao-widget/tests/app-entry.test.cjs
// 依赖：core.mjs；不读 App 正文、不改流量、不发网络请求
import {CW_VERSION, CW_API, CW_COUNT_API, CW_APP_STORE, cwObject} from "./core.mjs";

export const CW_APP_HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const CW_APP_ROUTE = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com|cn-acs\.m\.cainiao\.com|e2e-mtop\.cainiao\.com)(?::443)?\/(h5|gw)\/(mtop(?:\.[A-Za-z0-9_-]+)+|com\.taobao\.mtop\.mLoginUnitService\.(?:login|autoLogin|logout))(?:\/([0-9]+(?:\.[0-9]+)*|\*))?\/?(?:\?[^#\s]*)?$/i;
const CW_APP_COOKIES = ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"];
const CW_APP_NATIVE_HEADERS = ["x-sid", "x-uid", "x-t", "x-sign", "x-mini-wua", "x-umt", "x-sgext"];
const CW_APP_API_KINDS = ["personal_list", "personal_count", "public_time", "login", "session_refresh", "logout", "other"];
const CW_APP_WINDOW = 7 * 86400000;

export function cwAppHeaderValues(headers, name) {
    if (!headers) return [];
    let values;
    if (typeof headers.getAll === "function") values = headers.getAll(name);
    else if (typeof headers.get === "function") values = [headers.get(name)].filter(value => value !== null && value !== undefined);
    else {
        if (!cwObject(headers)) throw new Error("header-format");
        const entries = Object.entries(headers);
        if (entries.length > 64) throw new Error("header-format");
        values = entries.filter(([key]) => key.toLowerCase() === name.toLowerCase())
            .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
    }
    if (!Array.isArray(values) || values.length > 16 || values.some(value => typeof value !== "string")
        || values.reduce((size, value) => size + value.length, 0) > 65536
        || values.some(value => /[\r\n\x00]/.test(value))) throw new Error("header-format");
    return values;
}

export function cwAppRoute(value, headers) {
    if (typeof value !== "string" || value.length > 65536 || /[\x00-\x20\x7f]/.test(value)) return null;
    const match = CW_APP_ROUTE.exec(value);
    if (!match || match[2].toLowerCase() === "h5" && (!match[4] || match[4] === "*")) return null;
    const host = match[1].toLowerCase(), channel = match[2].toLowerCase();
    try {
        // HTTP/2 的伪头不属于已文档化的普通头名；Host 若有则必须与 URL 一致。
        for (const declared of cwAppHeaderValues(headers, "host")) {
            if (declared.trim().toLowerCase() !== host && declared.trim().toLowerCase() !== host + ":443") return null;
        }
    } catch { return null; }
    const api = match[3].toLowerCase();
    const apiKind = api === CW_API.toLowerCase() ? "personal_list" : api === CW_COUNT_API.toLowerCase() ? "personal_count"
        : api === "mtop.common.gettimestamp" ? "public_time"
        : api === "com.taobao.mtop.mloginunitservice.login" ? "login"
        : api === "com.taobao.mtop.mloginunitservice.autologin" ? "session_refresh"
        : api === "com.taobao.mtop.mloginunitservice.logout" ? "logout" : "other";
    return {host, channel, apiKind};
}

function cwAppSingleHeader(headers, name) {
    const values = cwAppHeaderValues(headers, name).map(value => value.trim());
    if (values.some(value => value !== values[0])) throw new Error("native-duplicate");
    return values[0] || "";
}

// 这是待验证的 native 会话，不是官方承诺的 H5 Cookie 别名。
export function cwAppNativeFields(headers) {
    const uid = cwAppSingleHeader(headers, "x-uid"), sid = cwAppSingleHeader(headers, "x-sid");
    if (uid && !/^[1-9][0-9]{0,19}$/.test(uid) || sid && !/^[A-Za-z0-9._~%+/=-]{8,8192}$/.test(sid)) throw new Error("native-format");
    return {uid, sid};
}

function cwAppNames(value, allowed) {
    return Array.isArray(value) && value.length <= 16 && value.every(name => typeof name === "string" && name.length <= 128)
        ? allowed.filter(name => value.includes(name)) : [];
}

function cwAppState(value, now) {
    const rows = [], empty = {version: CW_VERSION, startedAt: now, rows};
    if (!cwObject(value) || !["1.2.1", "1.2.2", CW_VERSION].includes(value.version) || !Array.isArray(value.rows)
        || !Number.isSafeInteger(value.startedAt) || value.startedAt <= 0 || value.startedAt > now
        || now - value.startedAt > CW_APP_WINDOW) return empty;
    const seen = new Set();
    for (const row of value.rows.slice(0, 32)) {
        if (!cwObject(row) || !CW_APP_HOSTS.includes(row.host) || !["h5", "gw"].includes(row.channel)
            || !CW_APP_API_KINDS.includes(row.apiKind) || !Number.isSafeInteger(row.count) || row.count < 1
            || !Number.isSafeInteger(row.at) || row.at < value.startedAt || row.at > now) continue;
        const key = row.host + "|" + row.channel + "|" + row.apiKind;
        if (seen.has(key)) continue;
        seen.add(key);
        const cookies = cwAppNames(row.cookies, CW_APP_COOKIES), nativeHeaders = cwAppNames(row.nativeHeaders, CW_APP_NATIVE_HEADERS);
        const validTime = at => Number.isSafeInteger(at) && at >= value.startedAt && at <= row.at;
        const sameRequestLoginFields = row.sameRequestLoginFields === true && cookies.includes("unb")
            && (cookies.includes("cookie2") || cookies.includes("sgcookie")) && validTime(row.sameRequestLoginFieldsAt);
        const sameRequestNativeSession = row.sameRequestNativeSession === true && row.channel === "gw"
            && nativeHeaders.includes("x-uid") && nativeHeaders.includes("x-sid") && validTime(row.sameRequestNativeSessionAt);
        rows.push({host: row.host, channel: row.channel, apiKind: row.apiKind, count: Math.min(row.count, 999999), at: row.at,
            cookies, nativeHeaders, sameRequestLoginFields, sameRequestLoginFieldsAt: sameRequestLoginFields ? row.sameRequestLoginFieldsAt : null,
            sameRequestNativeSession, sameRequestNativeSessionAt: sameRequestNativeSession ? row.sameRequestNativeSessionAt : null});
    }
    return {version: CW_VERSION, startedAt: value.startedAt, rows};
}

export function cwObserveApp(ctx, route, cookies, native, now) {
    const nativeHeaders = CW_APP_NATIVE_HEADERS.filter(name => cwAppHeaderValues(ctx.request.headers, name).some(value => value.trim()));
    const presentCookies = CW_APP_COOKIES.filter(name => cookies.has(name));
    const sameRequestLoginFields = !!cookies.get("unb") && (cookies.has("cookie2") || cookies.has("sgcookie"));
    const sameRequestNativeSession = route.channel === "gw" && !!native.uid && !!native.sid;
    const state = cwAppState(ctx.storage.getJSON(CW_APP_STORE), now);
    let row = state.rows.find(item => item.host === route.host && item.channel === route.channel && item.apiKind === route.apiKind);
    if (!row) {
        if (state.rows.length === 32) state.rows.sort((a, b) => a.at - b.at).shift();
        row = {...route, count: 0, at: now, cookies: [], nativeHeaders: [], sameRequestLoginFields: false, sameRequestLoginFieldsAt: null,
            sameRequestNativeSession: false, sameRequestNativeSessionAt: null};
        state.rows.push(row);
    }
    row.count = Math.min(row.count + 1, 999999);
    row.at = now;
    row.cookies = CW_APP_COOKIES.filter(name => row.cookies.includes(name) || presentCookies.includes(name));
    row.nativeHeaders = CW_APP_NATIVE_HEADERS.filter(name => row.nativeHeaders.includes(name) || nativeHeaders.includes(name));
    if (sameRequestLoginFields) { row.sameRequestLoginFields = true; row.sameRequestLoginFieldsAt = now; }
    if (sameRequestNativeSession) { row.sameRequestNativeSession = true; row.sameRequestNativeSessionAt = now; }
    ctx.storage.setJSON(CW_APP_STORE, state);
    if (JSON.stringify(cwAppState(ctx.storage.getJSON(CW_APP_STORE), now)) !== JSON.stringify(state)) throw new Error("app-storage-not-confirmed");
}

export function cwAppSummary(ctx, now = Date.now()) {
    const state = cwAppState(ctx.storage.getJSON(CW_APP_STORE), now), rows = state.rows;
    return {observed: rows.length > 0, lastAt: rows.length ? Math.max(...rows.map(row => row.at)) : null,
        sameRequestLoginFields: rows.some(row => row.sameRequestLoginFields), sameRequestNativeSession: rows.some(row => row.sameRequestNativeSession), rows};
}
