// 引擎：Egern 原生响应 API | 版本：1.2.4 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：同模块响应入口；node --experimental-vm-modules --test cainiao-widget/tests/response.test.cjs
// 依赖：core.mjs、app.mjs、auth.mjs；不发网络请求，不保存正文或凭据到取证键
import {CW_VERSION, CW_RESPONSE_STORE, CW_SELF_HEADER, CW_PATH, CW_COUNT_PATH, CW_IDENTITY_PATH, cwObject, cwCookieMap} from "./core.mjs";
import {CW_APP_HOSTS, cwAppRoute} from "./app.mjs";
import {cwConnectionMode, captureCainiaoResponseCandidate} from "./auth.mjs";

const CW_RESPONSE_NAMES = ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"];
const CW_RESPONSE_KINDS = ["personal_list", "personal_count", "public_time", "other", "login", "session_refresh", "logout"];
const CW_RESPONSE_CANDIDATE_RESULTS = ["saved", "unchanged", "anonymous", "conflict", "storage", "invalid", "superseded"];
const CW_RESPONSE_HEADER_RESULTS = [...CW_RESPONSE_CANDIDATE_RESULTS, "none", "scope", "deleted", "limit", "public_time", "logout"];
const CW_RESPONSE_SCHEMA_RESULTS = ["schema", "read_error", "too_large", "header_invalid"];
const CW_RESPONSE_FORMATS = ["JSON", "JSON_INVALID", "HTML", "GZIP", "ZLIB", "BINARY", "UNKNOWN", "EMPTY", "TOO_LARGE", "READ_ERROR", "HEADER_INVALID"];
const CW_RESPONSE_TYPES = ["missing", "null", "object", "array", "string", "number", "boolean"];
const CW_RESPONSE_PATHS = ["$.data", "$.data.returnValue", "$.data.returnValue.data"];
const CW_RESPONSE_FIELDS = ["userId", "cookies", "sid", "autoLoginToken", "success", "loginSuccess", "resultCode", "returnValue", "data"];
const CW_RESPONSE_HTTP = ["NONE", "HTTP_200", "HTTP_2XX", "HTTP_3XX", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_4XX", "HTTP_5XX", "HTTP_OTHER"];
const CW_RESPONSE_WINDOW = 7 * 86400000;
const CW_RESPONSE_MAX_BODY = 256 * 1024;
const CW_RESPONSE_MAX_COUNT = 999999;
const CW_RESPONSE_MAX_TIME = 8640000000000000;

function cwResponseError(code = "invalid") {
    const error = new Error("response-format");
    error.responseCode = code;
    return error;
}

function cwResponseTime(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= CW_RESPONSE_MAX_TIME;
}

function cwResponseHeaderValues(headers, name, limit = 64, size = 65536) {
    if (!headers) return [];
    let values;
    if (typeof headers.getAll === "function") values = headers.getAll(name);
    else if (typeof headers.get === "function") {
        const value = headers.get(name);
        values = value === null || value === undefined ? [] : [value];
    } else {
        values = [];
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() !== name.toLowerCase()) continue;
            const value = headers[key];
            const items = Array.isArray(value) ? value : [value];
            if (values.length + items.length > limit) throw cwResponseError("limit");
            for (const item of items) values.push(item);
        }
    }
    if (!Array.isArray(values)) throw cwResponseError();
    if (values.length > limit) throw cwResponseError("limit");
    let total = 0;
    for (const value of values) {
        if (typeof value !== "string") throw cwResponseError();
        total += value.length;
        if (total > size) throw cwResponseError("limit");
        if (/[^\x20-\x7e]/.test(value)) throw cwResponseError();
    }
    return values;
}

function cwResponseHasSelf(headers) {
    if (!headers) return false;
    if (typeof headers.getAll === "function") {
        const value = headers.getAll(CW_SELF_HEADER);
        if (!Array.isArray(value)) throw cwResponseError();
        return value.length !== 0;
    }
    if (typeof headers.get === "function") {
        const value = headers.get(CW_SELF_HEADER);
        return value !== null && value !== undefined;
    }
    return Object.keys(headers).some(key => key.toLowerCase() === CW_SELF_HEADER.toLowerCase());
}

function cwResponseHttpClass(status) {
    if (!Number.isInteger(status)) return "NONE";
    if ([200, 401, 403, 429].includes(status)) return "HTTP_" + status;
    return status >= 200 && status < 300 ? "HTTP_2XX" : status >= 300 && status < 400 ? "HTTP_3XX"
        : status >= 400 && status < 500 ? "HTTP_4XX" : status >= 500 && status < 600 ? "HTTP_5XX" : "HTTP_OTHER";
}

function cwResponseDomainMatches(host, domain) {
    return host === domain || host.endsWith("." + domain);
}

function cwResponsePathMatches(target, path) {
    return target === path || target.startsWith(path.endsWith("/") ? path : path + "/");
}

function cwResponseAttribute(name, value, hasEquals) {
    if (["secure", "httponly", "partitioned"].includes(name)) {
        if (hasEquals) throw cwResponseError();
        return "";
    }
    if (!hasEquals) throw cwResponseError();
    if (name === "domain") {
        const domain = value.toLowerCase().replace(/^\./, "");
        if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)
            || domain.split(".").some(part => part.startsWith("-") || part.endsWith("-"))) throw cwResponseError();
        return domain;
    }
    if (name === "path") {
        if (!value.startsWith("/") || value.length > 4096 || /[\s,\\]/.test(value)) throw cwResponseError();
        return value;
    }
    if (name === "max-age") {
        if (!/^-?\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) throw cwResponseError();
        return String(Number(value));
    }
    if (name === "expires") {
        const expires = Date.parse(value);
        if (!Number.isFinite(expires)) throw cwResponseError();
        return String(expires);
    }
    if (name === "samesite") {
        const sameSite = value.toLowerCase();
        if (!["lax", "strict", "none"].includes(sameSite)) throw cwResponseError();
        return sameSite;
    }
    return value;
}

// 同次响应独立解析。Map 中只有可同时用于来源主机和三项 H5 业务的活 Cookie。
export function cwResponseCookies(headers, route, pathname, now = Date.now()) {
    const cookies = new Map(), names = new Set(), deleted = new Set();
    let headerCount = 0, scopeCount = 0, deletedCount = 0;
    try {
        if (!route || !CW_APP_HOSTS.includes(route.host) || typeof pathname !== "string" || !pathname.startsWith("/")
            || !cwResponseTime(now)) throw cwResponseError();
        const lines = cwResponseHeaderValues(headers, "set-cookie");
        const pairs = lines.flatMap(line => line.split(/,\s*(?=[!#$%&'*+\-.^_`|~0-9A-Za-z]+\s*=)/));
        if (pairs.length > 64) throw cwResponseError("limit");
        headerCount = pairs.length;
        const seen = new Map();
        for (const line of pairs) {
            const parts = line.split(";").map(part => part.trim()), pair = parts.shift(), index = pair.indexOf("=");
            if (index <= 0) throw cwResponseError();
            const name = pair.slice(0, index).trim();
            let value = pair.slice(index + 1).trim();
            if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(name)) throw cwResponseError();
            if (value.startsWith('"') || value.endsWith('"')) {
                if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) throw cwResponseError();
                value = value.slice(1, -1);
            }
            if (value.length > 8192 || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value)) throw cwResponseError();
            const attrs = new Map();
            for (const part of parts) {
                if (!part) continue;
                const at = part.indexOf("="), key = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
                if (!/^[a-z0-9-]{1,128}$/.test(key)) throw cwResponseError();
                const item = cwResponseAttribute(key, at < 0 ? "" : part.slice(at + 1).trim(), at >= 0);
                if (attrs.has(key) && attrs.get(key) !== item) throw cwResponseError("conflict");
                attrs.set(key, item);
            }
            const fingerprint = JSON.stringify([value, [...attrs].sort(([a], [b]) => a.localeCompare(b))]);
            if (seen.has(name)) {
                if (seen.get(name) !== fingerprint) throw cwResponseError("conflict");
                continue;
            }
            seen.set(name, fingerprint);
            if (!CW_RESPONSE_NAMES.includes(name)) continue;
            names.add(name);
            const hostOnly = !attrs.has("domain"), domain = attrs.get("domain") || route.host;
            const path = attrs.get("path") || pathname.slice(0, pathname.lastIndexOf("/")) || "/";
            const usable = cwResponseDomainMatches(route.host, domain) && cwResponseDomainMatches("h5api.m.taobao.com", domain)
                && (!hostOnly || route.host === "h5api.m.taobao.com")
                && [CW_IDENTITY_PATH, CW_COUNT_PATH, CW_PATH].every(target => cwResponsePathMatches(target, path));
            if (!usable) { scopeCount++; continue; }
            const expired = attrs.has("max-age") ? Number(attrs.get("max-age")) <= 0
                : attrs.has("expires") && Number(attrs.get("expires")) <= now;
            if (!value || expired) { deleted.add(name); deletedCount++; continue; }
            cookies.set(name, value);
        }
        const result = cookies.size ? "usable" : deletedCount ? "deleted" : scopeCount ? "scope" : "none";
        return {cookies, names: CW_RESPONSE_NAMES.filter(name => names.has(name)), deleted: [...deleted], headerCount, scopeCount, deletedCount, result};
    } catch (error) {
        return {cookies: new Map(), names: [], deleted: [], headerCount: 0, scopeCount: 0, deletedCount: 0,
            result: ["limit", "conflict"].includes(error?.responseCode) ? error.responseCode : "invalid"};
    }
}

function cwResponseRequestUID(headers) {
    // 只借同请求的确切 UID。解析时检测全部重名歧义，其它值不进入响应候选。
    const cookieHeaders = cwResponseHeaderValues(headers, "cookie", 8, 32768);
    if (cookieHeaders.reduce((total, value) => total + value.length + 2, 0) > 32768) throw cwResponseError();
    const cookies = new Map();
    for (const line of cookieHeaders) for (const [name, value] of cwCookieMap(line, true)) {
        if (cookies.has(name) && cookies.get(name) !== value) throw cwResponseError("conflict");
        cookies.set(name, value);
    }
    const cookieUid = cookies.get("unb") || "";
    const values = cwResponseHeaderValues(headers, "x-uid", 16, 8192).map(value => value.trim());
    if (cookies.has("unb") && !/^[1-9][0-9]{0,19}$/.test(cookieUid)
        || values.some(value => !/^[1-9][0-9]{0,19}$/.test(value))) throw cwResponseError();
    const identities = [cookieUid, ...values].filter(Boolean);
    return {uid: identities[0] || "", conflict: identities.some(value => value !== identities[0])};
}

function cwResponseEmptySchema(format) {
    return {format, ret: "NONE", paths: []};
}

function cwResponseBytes(value) {
    if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw cwResponseError();
}

// 不依赖 TextDecoder/Buffer；严格 UTF-8 检查避免把压缩或任意二进制解释成 JSON。
function cwResponseUtf8(bytes) {
    const pieces = [];
    let start = bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0;
    for (let i = start; i < bytes.length;) {
        const a = bytes[i++];
        let cp = a, extra = a < 128 ? 0 : a >= 194 && a <= 223 ? 1 : a >= 224 && a <= 239 ? 2 : a >= 240 && a <= 244 ? 3 : -1;
        if (extra < 0 || i + extra > bytes.length) throw cwResponseError();
        cp &= extra === 1 ? 31 : extra === 2 ? 15 : extra === 3 ? 7 : 127;
        for (let j = 0; j < extra; j++) {
            const b = bytes[i++];
            if (b < 128 || b > 191) throw cwResponseError();
            cp = cp * 64 + (b & 63);
        }
        if (extra === 1 && cp < 128 || extra === 2 && cp < 2048 || extra === 3 && cp < 65536
            || cp > 1114111 || cp >= 55296 && cp <= 57343) throw cwResponseError();
        pieces.push(String.fromCodePoint(cp));
    }
    return pieces.join("");
}

function cwResponseType(value, present = true) {
    return !present ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

function cwResponseUnwrap(value, budget) {
    let resolved = value, used = budget;
    while (typeof resolved === "string" && used < 2) {
        try { resolved = JSON.parse(resolved); used++; }
        catch { break; }
    }
    return {value: resolved, used};
}

export function cwResponseSchema(raw, headers = {}) {
    let bytes;
    try { bytes = cwResponseBytes(raw); } catch { return cwResponseEmptySchema("UNKNOWN"); }
    if (bytes.byteLength > CW_RESPONSE_MAX_BODY) return cwResponseEmptySchema("TOO_LARGE");
    let encoding;
    try { encoding = cwResponseHeaderValues(headers, "content-encoding", 8, 1024).map(value => value.toLowerCase().trim()).join(","); }
    catch { return cwResponseEmptySchema("HEADER_INVALID"); }
    if (bytes[0] === 31 && bytes[1] === 139 || /(?:^|,)\s*gzip\s*(?:,|$)/.test(encoding)) return cwResponseEmptySchema("GZIP");
    if (bytes.length >= 2 && (bytes[0] & 15) === 8 && (bytes[0] >> 4) <= 7 && (bytes[0] * 256 + bytes[1]) % 31 === 0
        || /(?:^|,)\s*(?:deflate|zlib)\s*(?:,|$)/.test(encoding)) return cwResponseEmptySchema("ZLIB");
    if (encoding && encoding !== "identity") return cwResponseEmptySchema("BINARY");
    let text;
    try { text = cwResponseUtf8(bytes); } catch { return cwResponseEmptySchema("BINARY"); }
    if (!text.trim()) return cwResponseEmptySchema("EMPTY");
    if (/^\s*</.test(text)) return cwResponseEmptySchema("HTML");
    if (!/^\s*[\[{"\-0-9tfn]/.test(text) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return cwResponseEmptySchema("UNKNOWN");
    let body;
    try { body = JSON.parse(text); } catch { return cwResponseEmptySchema("JSON_INVALID"); }
    const root = cwResponseUnwrap(body, 0), schema = {format: "JSON", ret: "NONE", paths: []};
    if (!cwObject(root.value)) return schema;
    if (Array.isArray(root.value.ret) && root.value.ret.length > 0 && root.value.ret.length <= 64) {
        const codes = root.value.ret.map(item => typeof item === "string" ? item.split("::", 1)[0] : "");
        schema.ret = codes.every(code => code === "SUCCESS") ? "SUCCESS"
            : codes.every(code => code === "SUCCESS" || /^FAIL_[A-Z0-9_]{1,128}$/.test(code)) ? "FAILURE" : "UNKNOWN";
    } else if (Object.hasOwn(root.value, "ret")) schema.ret = "UNKNOWN";
    let parent = root.value, used = root.used;
    for (const [index, key] of ["data", "returnValue", "data"].entries()) {
        const present = cwObject(parent) && Object.hasOwn(parent, key), value = present ? parent[key] : undefined;
        const decoded = cwResponseUnwrap(value, used), type = cwResponseType(value, present), decodedType = cwResponseType(decoded.value, present);
        const fields = cwObject(decoded.value) ? CW_RESPONSE_FIELDS.filter(name => Object.hasOwn(decoded.value, name)).map(name => {
            const item = decoded.value[name];
            return {name, type: cwResponseType(item), count: Array.isArray(item) ? Math.min(item.length, CW_RESPONSE_MAX_COUNT) : null};
        }) : [];
        schema.paths.push({path: CW_RESPONSE_PATHS[index], type, decodedType, fields});
        parent = decoded.value; used = decoded.used;
    }
    return schema;
}

function cwResponseCleanSchema(value) {
    if (!cwObject(value) || !CW_RESPONSE_FORMATS.includes(value.format) || !["NONE", "SUCCESS", "FAILURE", "UNKNOWN"].includes(value.ret)
        || !Array.isArray(value.paths) || ![0, 3].includes(value.paths.length)
        || value.format !== "JSON" && (value.paths.length || value.ret !== "NONE")) return null;
    const paths = [];
    for (const [index, row] of value.paths.entries()) {
        if (!cwObject(row) || row.path !== CW_RESPONSE_PATHS[index] || !CW_RESPONSE_TYPES.includes(row.type)
            || !CW_RESPONSE_TYPES.includes(row.decodedType) || !Array.isArray(row.fields) || row.fields.length > CW_RESPONSE_FIELDS.length) return null;
        if (row.type !== "string" && row.type !== row.decodedType || row.type === "string" && row.decodedType === "missing"
            || row.decodedType !== "object" && row.fields.length) return null;
        if (index > 0) {
            const field = paths[index - 1].fields.find(item => item.name === (index === 1 ? "returnValue" : "data"));
            if ((field ? field.type : "missing") !== row.type) return null;
        }
        const fields = [], names = new Set();
        for (const field of row.fields) {
            if (!cwObject(field) || !CW_RESPONSE_FIELDS.includes(field.name) || names.has(field.name) || !CW_RESPONSE_TYPES.includes(field.type)
                || field.type === "missing" || !(field.type === "array" ? Number.isSafeInteger(field.count) && field.count >= 0 && field.count <= CW_RESPONSE_MAX_COUNT : field.count === null)) return null;
            names.add(field.name); fields.push({name: field.name, type: field.type, count: field.count});
        }
        paths.push({path: row.path, type: row.type, decodedType: row.decodedType,
            fields: CW_RESPONSE_FIELDS.filter(name => names.has(name)).map(name => fields.find(field => field.name === name))});
    }
    return {format: value.format, ret: value.ret, paths};
}

function cwResponseState(value, now) {
    const empty = {version: CW_VERSION, startedAt: now, rows: []};
    if (!cwResponseTime(now) || !cwObject(value) || !["1.2.3", CW_VERSION].includes(value.version)
        || !cwResponseTime(value.startedAt) || value.startedAt > now || now - value.startedAt >= CW_RESPONSE_WINDOW
        || !Array.isArray(value.rows) || value.rows.length > 32) return empty;
    const rows = [], seen = new Set();
    for (const row of value.rows) {
        if (!cwObject(row) || !CW_APP_HOSTS.includes(row.host) || !["h5", "gw"].includes(row.channel) || !CW_RESPONSE_KINDS.includes(row.apiKind)
            || !["headers", "schema"].includes(row.mode) || !(row.mode === "headers" ? CW_RESPONSE_HEADER_RESULTS : CW_RESPONSE_SCHEMA_RESULTS).includes(row.result)
            || !CW_RESPONSE_HTTP.includes(row.httpClass)
            || !Number.isSafeInteger(row.count) || row.count < 1 || !Number.isSafeInteger(row.at) || row.at < value.startedAt || row.at > now
            || !Array.isArray(row.cookies) || row.cookies.length > 7 || new Set(row.cookies).size !== row.cookies.length || row.cookies.some(name => !CW_RESPONSE_NAMES.includes(name))
            || ["usable", "scopeCount", "deletedCount"].some(key => !Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > row.cookies.length)
            || row.usable + row.scopeCount + row.deletedCount !== row.cookies.length
            || !Number.isSafeInteger(row.headerCount) || row.headerCount < row.cookies.length || row.headerCount > 64) continue;
        const schema = row.mode === "schema" ? cwResponseCleanSchema(row.schema) : null;
        if (row.mode === "schema" && (!schema || !["login", "session_refresh", "logout"].includes(row.apiKind)
                || row.cookies.length || row.usable || row.headerCount || row.scopeCount || row.deletedCount
                || row.result !== (schema.format === "READ_ERROR" ? "read_error" : schema.format === "HEADER_INVALID" ? "header_invalid"
                    : schema.format === "TOO_LARGE" ? "too_large" : "schema"))
            || row.mode === "headers" && row.schema !== null) continue;
        if (row.mode === "headers" && (["public_time", "logout"].includes(row.apiKind) ? row.result !== row.apiKind : ["public_time", "logout"].includes(row.result))
            || row.mode === "headers" && ["saved", "unchanged", "storage", "superseded"].includes(row.result)
                && (!row.usable || !row.cookies.some(name => ["cookie2", "sgcookie"].includes(name)))) continue;
        const key = row.host + "|" + row.channel + "|" + row.apiKind + "|" + row.mode;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({host: row.host, channel: row.channel, apiKind: row.apiKind, mode: row.mode, count: Math.min(row.count, CW_RESPONSE_MAX_COUNT), at: row.at,
            result: row.result, httpClass: row.httpClass, cookies: CW_RESPONSE_NAMES.filter(name => row.cookies.includes(name)), usable: row.usable,
            headerCount: row.headerCount, scopeCount: row.scopeCount, deletedCount: row.deletedCount, schema});
    }
    return {version: CW_VERSION, startedAt: value.startedAt, rows};
}

function cwResponseRecord(ctx, route, now, data) {
    try {
        const state = cwResponseState(ctx.storage.getJSON(CW_RESPONSE_STORE), now);
        const key = item => item.host + "|" + item.channel + "|" + item.apiKind + "|" + item.mode;
        const incoming = {host: route.host, channel: route.channel, apiKind: route.apiKind, mode: data.mode, count: 1, at: now, ...data};
        const previous = state.rows.find(row => key(row) === key(incoming));
        if (previous) {
            incoming.count = Math.min(previous.count + 1, CW_RESPONSE_MAX_COUNT);
            state.rows[state.rows.indexOf(previous)] = incoming;
        } else {
            if (state.rows.length === 32) state.rows.sort((a, b) => a.at - b.at).shift();
            state.rows.push(incoming);
        }
        const expected = cwResponseState(state, now);
        if (expected.rows.length !== state.rows.length) throw cwResponseError();
        ctx.storage.setJSON(CW_RESPONSE_STORE, expected);
        if (JSON.stringify(cwResponseState(ctx.storage.getJSON(CW_RESPONSE_STORE), now)) !== JSON.stringify(expected)) throw cwResponseError();
    } catch { console.log("[菜鸟响应] 本机响应状态无法保存，未记录敏感内容。"); }
}

function cwResponseCaptureHeaders(ctx, route, now, clock) {
    const parsed = cwResponseCookies(ctx.response.headers, route, new URL(ctx.request.url).pathname, now);
    let result = parsed.result === "usable" ? "anonymous" : parsed.result;
    if (["public_time", "logout"].includes(route.apiKind)) result = route.apiKind;
    else if (parsed.cookies.has("cookie2") || parsed.cookies.has("sgcookie")) {
        try {
            const requestIdentity = cwResponseRequestUID(ctx.request.headers), requestUid = requestIdentity.uid, serverUid = parsed.cookies.get("unb") || "";
            if (serverUid && !/^[1-9][0-9]{0,19}$/.test(serverUid)) throw cwResponseError();
            if (parsed.deleted.includes("unb")) result = "deleted";
            else if (parsed.names.includes("unb") && !serverUid) result = "scope";
            else if (ctx.response.status !== 200) result = "invalid";
            else if (serverUid || requestUid) {
                const cookies = new Map(parsed.cookies);
                if (!serverUid) cookies.set("unb", requestUid);
                // 有效但冲突的 UID 交给 auth helper 写账号屏障，不能只留下元数据。
                const captured = captureCainiaoResponseCandidate(ctx, {route, cookies}, clock);
                const identityConflict = requestIdentity.conflict || !!serverUid && !!requestUid && serverUid !== requestUid;
                result = identityConflict ? captured === "storage" ? "storage" : "conflict"
                    : CW_RESPONSE_CANDIDATE_RESULTS.includes(captured) ? captured : "invalid";
            }
        } catch (error) { result = error?.responseCode === "conflict" ? "conflict" : "invalid"; }
    }
    cwResponseRecord(ctx, route, now, {mode: "headers", result, httpClass: cwResponseHttpClass(ctx.response.status),
        cookies: parsed.names, usable: parsed.cookies.size, headerCount: parsed.headerCount, scopeCount: parsed.scopeCount, deletedCount: parsed.deletedCount, schema: null});
}

export async function captureCainiaoResponse(ctx, clock = () => Date.now()) {
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request || !ctx.response) return;
    let route;
    let now;
    try {
        route = cwAppRoute(ctx.request.url, ctx.request.headers);
        if (!route || cwResponseHeaderValues(ctx.request.headers, "host", 16, 8192)
            .some(value => ![route.host, route.host + ":443"].includes(value.trim().toLowerCase()))) return;
        now = clock();
        if (!cwResponseTime(now) || cwResponseHasSelf(ctx.request.headers) || cwResponseHasSelf(ctx.response.headers)) return;
    } catch { return; }
    const schemaMode = ctx.env?.CW_LOGIN_SCHEMA === "true";
    if (schemaMode && !["login", "session_refresh", "logout"].includes(route.apiKind)) return;
    const empty = {cookies: [], usable: 0, headerCount: 0, scopeCount: 0, deletedCount: 0};
    // 部署规则互斥：普通 MTOP 走无正文入口，已知登录走此入口的一次头采集＋有限正文。
    cwResponseCaptureHeaders(ctx, route, now, clock);
    if (schemaMode) {
        const request = ctx.request, response = ctx.response;
        let bytes, schema;
        try {
            let lengths;
            try { lengths = cwResponseHeaderValues(response.headers, "content-length", 8, 1024); }
            catch { throw cwResponseError("header_invalid"); }
            if (lengths.some(value => !/^\d{1,16}$/.test(value.trim()) || value.trim() !== lengths[0].trim())) throw cwResponseError("header_invalid");
            if (lengths.length && Number(lengths[0]) > CW_RESPONSE_MAX_BODY) {
                cwResponseRecord(ctx, route, now, {...empty, mode: "schema", result: "too_large", httpClass: cwResponseHttpClass(response.status), schema: cwResponseEmptySchema("TOO_LARGE")});
                return;
            }
            bytes = cwResponseBytes(await response.arrayBuffer());
            schema = cwResponseSchema(bytes, response.headers);
        } catch (error) {
            schema = cwResponseEmptySchema(error?.responseCode === "header_invalid" ? "HEADER_INVALID" : "READ_ERROR");
        }
        try {
            if (cwConnectionMode(ctx.env) === "auto" && ctx.env?.CW_LOGIN_SCHEMA === "true" && ctx.request === request && ctx.response === response) {
                const observedAt = clock();
                if (cwResponseTime(observedAt) && observedAt >= now) cwResponseRecord(ctx, route, observedAt, {...empty, mode: "schema",
                    result: schema.format === "READ_ERROR" ? "read_error" : schema.format === "HEADER_INVALID" ? "header_invalid" : schema.format === "TOO_LARGE" ? "too_large" : "schema",
                    httpClass: cwResponseHttpClass(response.status), schema});
            }
        } catch { /* 已读取正文必须仍按原字节返回；不展开异常。 */ }
        return bytes ? {body: bytes} : undefined;
    }
}

export function cwResponseLines(ctx, now = Date.now()) {
    let state;
    try { state = cwResponseState(ctx.storage.getJSON(CW_RESPONSE_STORE), now); }
    catch { return ["响应取证：本机状态无法读取，未显示异常原文。"]; }
    if (!state.rows.length) return ["响应取证：尚无有效记录；未见登录接口不代表 App 未登录。"];
    const labels = {personal_list: "个人列表", personal_count: "个人数量", public_time: "公共时间", other: "其他 MTOP", login: "登录", session_refresh: "续登", logout: "退出"};
    const results = {saved: "已保存响应候选，仍须个人查询", unchanged: "候选未变化", anonymous: "缺少同次账号组合", conflict: "账号或字段冲突，未采纳",
        storage: "候选存储未确认", invalid: "格式无效，未采纳", superseded: "候选已被更新", none: "未见可用认证 Cookie", scope: "Cookie 域或路径不适用",
        deleted: "认证字段已删除或到期", limit: "响应头超限", public_time: "公共时间不作登录凭据", logout: "退出响应不作新候选", schema: "已记录有限结构",
        read_error: "正文读取未完成", too_large: "正文超限，未解析", header_invalid: "正文相关头格式无效"};
    const lines = ["响应取证：同模块本机记录；字段和结构不等于个人登录成功。"];
    for (const row of state.rows) {
        lines.push(row.host + " · " + row.channel + " · " + labels[row.apiKind] + " · " + row.mode + " · " + row.count + " 次");
        lines.push("最近响应：" + results[row.result] + " · " + row.httpClass + " · " + new Date(row.at).toISOString());
        if (row.mode === "headers") lines.push("Set-Cookie 字段名：" + (row.cookies.join("、") || "无") + "；本次可用 " + row.usable + " 项，域路径不适用 " + row.scopeCount + " 项");
        else {
            lines.push("正文分类：" + row.schema.format + "；返回分类：" + row.schema.ret + "（不是个人查询确认）");
            for (const node of row.schema.paths) lines.push(node.path + "：" + node.type + (node.decodedType !== node.type ? " → " + node.decodedType : "")
                + (node.fields.length ? "；" + node.fields.map(field => field.name + ":" + field.type + (field.count === null ? "" : "(" + field.count + ")")).join("、") : ""));
        }
    }
    return lines;
}
