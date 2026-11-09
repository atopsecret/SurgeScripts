// 引擎：Egern JavaScript | 版本：1.3.0 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：同一模块捕获本人 App 的实际专用 token 和 RPC 模板，再由 generic 独立查询
// 依赖：core.mjs、app.mjs；不执行 APK、不调用原生签名、不在 hook 发送个人查询
import {CW_VERSION, CW_STORE, CW_OFFICIAL_STORE, CW_SELF_HEADER, cwObject, cwCookieMap, cwText, md5} from "./core.mjs";
import {CW_APP_HOSTS, cwAppRoute, cwAppHeaderValues} from "./app.mjs";

export const CW_OFFICIAL_TOKEN_API = "mtop.cainiao.guoguo.widget.token.get.cn";
export const CW_OFFICIAL_QUERY_URL = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const CW_OFFICIAL_ARGS_TYPE = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const CW_OFFICIAL_BODY_LIMIT = 256 * 1024;
const CW_OFFICIAL_TICKET_WINDOW = 120000;
const CW_OFFICIAL_SNAPSHOT_WINDOW = 7 * 86400000;
const CW_OFFICIAL_TOKEN_ROUTE = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com|cn-acs\.m\.cainiao\.com|e2e-mtop\.cainiao\.com)(?::443)?\/(h5|gw)\/mtop\.cainiao\.guoguo\.widget\.token\.get\.cn(?:\/(1\.0|\*))?\/?(?:\?[^#\s]*)?$/i;
const CW_OFFICIAL_QUERY_ROUTE = /^https:\/\/guoguouser\.cainiao\.com(?::443)?(\/[^?#]*)$/i;
const CW_OFFICIAL_QUERY_PATH = CW_OFFICIAL_QUERY_URL.slice("https://guoguouser.cainiao.com".length);
const CW_OFFICIAL_CONFLICT_OWNER = md5("capture-conflicting-identities");
const CW_OFFICIAL_INSTALL_KEYS = ["isLargeInstall", "isMediumInstall", "isSmallInstall", "isNewSmallInstall", "isLargeV2Install"];
const CW_OFFICIAL_STATUSES = ["waiting_token", "waiting_template", "pending", "ready", "expired", "invalid", "signed_out"];
const CW_OFFICIAL_FAILURES = ["NONE", "INVALID_TOKEN", "QUERY_ERROR", "BUSINESS_FAILURE", "HTTP_REJECTED", "SCHEMA_INVALID", "OFFLINE", "DEADLINE", "STORAGE_UNCONFIRMED", "ACCOUNT_BLOCKED", "SIGNED_OUT"];
const CW_OFFICIAL_CAPTURES = ["NONE", "ticket", "issued", "template", "unchanged", "anonymous", "invalid", "token_mismatch", "conflict", "signed_out"];

class CwOfficialFailure extends Error {
    constructor(code) { super(code); this.officialCode = code; }
}

function cwOfficialFail(code = "SCHEMA_INVALID") { return new CwOfficialFailure(code); }
function cwOfficialTime(value) { return Number.isSafeInteger(value) && value > 0; }
function cwOfficialHash(value) { return typeof value === "string" && /^[0-9a-f]{32}$/.test(value); }
function cwOfficialNonce(now) { return md5("official:" + now + ":" + Math.random() + ":" + Math.random()); }
function cwOfficialAuto(ctx) { return (ctx.env?.CONNECTION_MODE || "auto") === "auto"; }
function cwOfficialOpaque(value) { return typeof value === "string" && value.length > 0 && value.length <= 8192 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value); }
function cwOfficialString(value, max, empty = true) { return typeof value === "string" && value.length <= max && (empty || value.length > 0) && !/[\x00-\x1f\x7f]/.test(value); }
function cwOfficialSameKeys(value, keys) { return cwObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }

export function cwOfficialRoute(url, headers) {
    if (typeof url !== "string" || url.length > 65536 || /[\x00-\x20\x7f]/.test(url)) return null;
    const match = CW_OFFICIAL_TOKEN_ROUTE.exec(url);
    let route = match ? {kind: "token", host: match[1].toLowerCase(), channel: match[2].toLowerCase()} : null;
    if (route && (route.channel === "h5" ? match[3] !== "1.0" : ![undefined, "1.0", "*"].includes(match[3]))) return null;
    const query = route ? null : CW_OFFICIAL_QUERY_ROUTE.exec(url);
    if (query && query[1] === CW_OFFICIAL_QUERY_PATH) route = {kind: "query", host: "guoguouser.cainiao.com", channel: "rpc"};
    if (!route) return null;
    try {
        for (const host of cwAppHeaderValues(headers, "host")) if (![route.host, route.host + ":443"].includes(host.trim().toLowerCase())) return null;
    } catch { return null; }
    return route;
}

function cwOfficialSelf(request, response) {
    return cwAppHeaderValues(request?.headers, CW_SELF_HEADER).length > 0 || cwAppHeaderValues(response?.headers, CW_SELF_HEADER).length > 0;
}

function cwOfficialIdentity(headers) {
    const values = [], cookieLines = cwAppHeaderValues(headers, "cookie");
    if (cookieLines.length > 8 || cookieLines.reduce((size, item) => size + item.length + 2, 0) > 32768) throw cwOfficialFail();
    for (const line of cookieLines) {
        const parts = line.split(";");
        if (parts.length > 512) throw cwOfficialFail();
        // 逐项验证后保留全部明确 UID，重名冲突不能被 Map 的覆盖行为吞掉。
        for (const part of parts) {
            if (!part.trim()) continue;
            const parsed = cwCookieMap(part, true);
            if (parsed.has("unb")) values.push(parsed.get("unb"));
        }
    }
    values.push(...cwAppHeaderValues(headers, "x-uid").map(value => value.trim()));
    if (values.some(value => !/^[1-9][0-9]{0,19}$/.test(value))) throw cwOfficialFail();
    const identities = [...new Set(values)];
    return {owner: identities.length === 1 ? md5("account:" + identities[0]) : "", conflict: identities.length > 1};
}

function cwOfficialTicketHash(request) {
    const method = String(request.method || "GET").toUpperCase();
    if (!["GET", "POST"].includes(method)) throw cwOfficialFail();
    const fields = ["cookie", "x-uid", "x-t", "x-sign"].map(name => [name, cwAppHeaderValues(request.headers, name)]);
    // 只保存摘要，不保存 URL、UID、Cookie 或一次性签名。响应重算同请求摘要。
    return md5(JSON.stringify([request.url, method, fields]));
}

function cwOfficialBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw cwOfficialFail();
}

function cwOfficialDeclaredBody(headers) {
    const lengths = cwAppHeaderValues(headers, "content-length").map(value => value.trim());
    if (lengths.some(value => !/^\d{1,16}$/.test(value) || value !== lengths[0])) throw cwOfficialFail();
    return lengths.length ? Number(lengths[0]) : null;
}

// 使用严格 UTF-8，不依赖 Egern 未承诺的 Buffer/TextDecoder，也不解压或改写原字节。
function cwOfficialUtf8(bytes) {
    const parts = [];
    for (let i = bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 3 : 0; i < bytes.length;) {
        const first = bytes[i++];
        const extra = first < 128 ? 0 : first >= 194 && first <= 223 ? 1 : first >= 224 && first <= 239 ? 2 : first >= 240 && first <= 244 ? 3 : -1;
        if (extra < 0 || i + extra > bytes.length) throw cwOfficialFail();
        let point = first & (extra === 1 ? 31 : extra === 2 ? 15 : extra === 3 ? 7 : 127);
        for (let j = 0; j < extra; j++) {
            const next = bytes[i++];
            if (next < 128 || next > 191) throw cwOfficialFail();
            point = point * 64 + (next & 63);
        }
        if (extra === 1 && point < 128 || extra === 2 && point < 2048 || extra === 3 && point < 65536
            || point > 1114111 || point >= 55296 && point <= 57343) throw cwOfficialFail();
        parts.push(String.fromCodePoint(point));
    }
    return parts.join("");
}

// JSON.parse 不报告重复键；受限解析器先拒绝歧义、超深和超多节点，再按固定路径取字段。
function cwOfficialJSON(text) {
    if (typeof text !== "string" || text.length > CW_OFFICIAL_BODY_LIMIT) throw cwOfficialFail();
    let at = 0, nodes = 0;
    const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
    const string = () => {
        const start = at++;
        while (at < text.length) {
            const ch = text[at++];
            if (ch === '"') {
                try { return JSON.parse(text.slice(start, at)); } catch { throw cwOfficialFail(); }
            }
            if (ch === "\\") at++;
        }
        throw cwOfficialFail();
    };
    const value = depth => {
        if (++nodes > 50000 || depth > 20) throw cwOfficialFail();
        space();
        if (text[at] === '"') return string();
        if (text[at] === "{") {
            at++; space(); const object = Object.create(null), keys = new Set();
            if (text[at] === "}") { at++; return object; }
            while (at < text.length) {
                space(); if (text[at] !== '"') throw cwOfficialFail();
                const key = string();
                if (keys.has(key)) throw cwOfficialFail();
                keys.add(key); space(); if (text[at++] !== ":") throw cwOfficialFail();
                object[key] = value(depth + 1); space();
                const end = text[at++];
                if (end === "}") return object;
                if (end !== ",") throw cwOfficialFail();
            }
        } else if (text[at] === "[") {
            at++; space(); const array = [];
            if (text[at] === "]") { at++; return array; }
            while (at < text.length) {
                array.push(value(depth + 1)); space(); const end = text[at++];
                if (end === "]") return array;
                if (end !== ",") throw cwOfficialFail();
            }
        } else {
            for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]]) if (text.slice(at, at + literal.length) === literal) { at += literal.length; return parsed; }
            const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
            if (number) {
                at += number[0].length; const parsed = Number(number[0]);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        throw cwOfficialFail();
    };
    const parsed = value(0); space();
    if (at !== text.length) throw cwOfficialFail();
    return parsed;
}

function cwOfficialBodyHeaders(headers) {
    const encoding = cwAppHeaderValues(headers, "content-encoding").map(value => value.trim().toLowerCase());
    if (encoding.some(value => value !== "identity")) throw cwOfficialFail();
    const types = cwAppHeaderValues(headers, "content-type").map(value => value.split(";", 1)[0].trim().toLowerCase());
    if (types.some(value => !["application/json", "text/json"].includes(value))) throw cwOfficialFail();
}

export function cwOfficialParseBytes(raw, headers) {
    const bytes = cwOfficialBytes(raw);
    if (!bytes.byteLength || bytes.byteLength > CW_OFFICIAL_BODY_LIMIT) throw cwOfficialFail();
    cwOfficialBodyHeaders(headers);
    const parsed = cwOfficialJSON(cwOfficialUtf8(bytes));
    if (!cwObject(parsed)) throw cwOfficialFail();
    return parsed;
}

function cwOfficialParseText(text, headers) {
    if (typeof text !== "string" || !text.length || text.length > CW_OFFICIAL_BODY_LIMIT) throw cwOfficialFail();
    // HTTP 返回体使用文档化 text()；按 UTF-8 字节而非 UTF-16 长度执行解析上限。
    let size = 0;
    for (const character of text) {
        const point = character.codePointAt(0);
        if (point >= 55296 && point <= 57343) throw cwOfficialFail();
        size += point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
        if (size > CW_OFFICIAL_BODY_LIMIT) throw cwOfficialFail();
    }
    cwOfficialBodyHeaders(headers);
    const parsed = cwOfficialJSON(text.charCodeAt(0) === 65279 ? text.slice(1) : text);
    if (!cwObject(parsed)) throw cwOfficialFail();
    return parsed;
}

function cwOfficialTemplateFields(value) {
    const keys = ["appName", "source", "channel", "brand", "installStatus", "version", "ext"];
    if (!cwOfficialSameKeys(value, keys) || value.appName !== "GUOGUO_APP" || ![1, 2].includes(value.version)
        || !cwOfficialString(value.source, 128, false) || !cwOfficialString(value.channel, 256) || !cwOfficialString(value.brand, 256)
        || !cwOfficialString(value.installStatus, 4096, false) || !cwOfficialString(value.ext, 4096, false)) throw cwOfficialFail();
    const install = cwOfficialJSON(value.installStatus), ext = cwOfficialJSON(value.ext);
    if (!cwOfficialSameKeys(install, CW_OFFICIAL_INSTALL_KEYS) || CW_OFFICIAL_INSTALL_KEYS.some(key => typeof install[key] !== "boolean")
        || !cwOfficialSameKeys(ext, ["apiVersion"]) || ext.apiVersion !== "V3") throw cwOfficialFail();
    return {appName: value.appName, source: value.source, channel: value.channel, brand: value.brand,
        installStatus: value.installStatus, version: value.version, ext: value.ext};
}

export function cwOfficialTemplate(body) {
    if (!cwOfficialSameKeys(body, ["argsTypes", "argsObjs"]) || !Array.isArray(body.argsTypes) || body.argsTypes.length !== 1
        || body.argsTypes[0] !== CW_OFFICIAL_ARGS_TYPE || !Array.isArray(body.argsObjs) || body.argsObjs.length !== 1) throw cwOfficialFail();
    const object = body.argsObjs[0], keys = ["appName", "source", "channel", "brand", "installStatus", "version", "ext", "token", "timestamp"];
    if (!cwObject(object) || !keys.every(key => Object.hasOwn(object, key)) || Object.keys(object).some(key => ![...keys, "lbs"].includes(key))
        || !cwOfficialOpaque(object.token) || !cwOfficialTime(object.timestamp)
        || Object.hasOwn(object, "lbs") && !cwOfficialString(object.lbs, 1024)) throw cwOfficialFail();
    const fields = Object.fromEntries(keys.slice(0, 7).map(key => [key, object[key]]));
    return {token: object.token, template: cwOfficialTemplateFields(fields)};
}

function cwOfficialObservedTemplateToken(body) {
    // 只在唯一、明确的专用 RPC 包装中读取同次 token；未知字段不参与状态或请求。
    if (!cwObject(body) || !Array.isArray(body.argsTypes) || body.argsTypes.length !== 1 || body.argsTypes[0] !== CW_OFFICIAL_ARGS_TYPE
        || !Array.isArray(body.argsObjs) || body.argsObjs.length !== 1 || !cwObject(body.argsObjs[0])
        || typeof body.argsObjs[0].token !== "string") return null;
    return body.argsObjs[0].token;
}

function cwOfficialSnapshot(value, now) {
    if (!cwObject(value) || !Array.isArray(value.items) || value.items.length > 1000 || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 1000000 || value.items.length > value.total
        || typeof value.updatedAt !== "string" || !cwOfficialTime(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > now
        || now - Date.parse(value.updatedAt) >= CW_OFFICIAL_SNAPSHOT_WINDOW) return null;
    const items = [];
    for (const item of value.items) {
        if (!cwObject(item) || !cwOfficialHash(item.id) || item.code !== "" || item.company !== "" || item.requiresVerification !== false
            || !cwOfficialString(item.summary, 240, false) || !cwOfficialString(item.station, 160)
            || !cwOfficialString(item.tail, 4) || cwText(item.summary, 240) !== item.summary || cwText(item.station, 160) !== item.station || cwText(item.tail, 4) !== item.tail) return null;
        items.push({id: item.id, code: "", summary: item.summary, station: item.station, company: "", tail: item.tail, requiresVerification: false});
    }
    return {items, total: value.total, updatedAt: value.updatedAt};
}

export function cwOfficialReadSummary(body, now) {
    if (!cwOfficialTime(now) || !cwObject(body)) throw cwOfficialFail();
    // 官方调用先判断 success；失败载荷里的同名 status 不能伪造 token 拒绝。
    if (body.success === false) throw cwOfficialFail("BUSINESS_FAILURE");
    if (body.success !== true || !cwObject(body.data)) throw cwOfficialFail();
    if (body.data.status === "INVALID_TOKEN") throw cwOfficialFail("INVALID_TOKEN");
    if (body.data.status === "QUERY_ERROR") throw cwOfficialFail("QUERY_ERROR");
    if (Object.hasOwn(body.data, "status") && !cwOfficialString(body.data.status, 128)) throw cwOfficialFail();
    const info = body.data.packageInfo;
    if (!cwObject(info) || !Number.isSafeInteger(info.agentSignPackNum) || info.agentSignPackNum < 0 || info.agentSignPackNum > 1000000
        || info.packageItemInfoList !== undefined && info.packageItemInfoList !== null && !Array.isArray(info.packageItemInfoList)
        || Array.isArray(info.packageItemInfoList) && info.packageItemInfoList.length > 1000) throw cwOfficialFail();
    const items = [];
    for (const [index, item] of (info.packageItemInfoList || []).entries()) {
        if (!cwObject(item)) throw cwOfficialFail();
        // 未知状态和字符串 "900" 均不转换；官方计数独立于可显示的受限摘要。
        if (item.logisticsStatus !== 900) continue;
        if (typeof item.logisticsStatusSimpleDesc !== "string") continue;
        const summary = cwText(item.logisticsStatusSimpleDesc, 240), station = typeof item.stationName === "string" ? cwText(item.stationName, 160) : "";
        if (!summary) continue;
        const mail = typeof item.mailNo === "string" ? cwText(item.mailNo, 128) : "";
        const identity = mail || (typeof item.packageId === "string" ? cwText(item.packageId, 128) : Number.isSafeInteger(item.packageId) ? String(item.packageId) : "") || summary + ":" + station + ":" + index;
        items.push({id: md5("official-package:" + identity), code: "", summary, station, company: "", tail: mail.slice(-4), requiresVerification: false});
    }
    if (items.length > info.agentSignPackNum) throw cwOfficialFail();
    return {items, total: info.agentSignPackNum, updatedAt: new Date(now).toISOString()};
}

export function cwOfficialState(value, now = Date.now()) {
    try {
        if (!cwOfficialTime(now) || !cwObject(value) || value.version !== CW_VERSION || !cwOfficialHash(value.owner)
            || !cwOfficialHash(value.generation) || !cwOfficialHash(value.revision) || !CW_OFFICIAL_STATUSES.includes(value.status)
            || !cwOfficialTime(value.at) || value.at > now || !CW_OFFICIAL_FAILURES.includes(value.failure) || !CW_OFFICIAL_CAPTURES.includes(value.captureResult)
            || typeof value.token !== "string" || value.token && !cwOfficialOpaque(value.token)
            || value.tokenHash !== "" && !cwOfficialHash(value.tokenHash) || value.token && value.tokenHash !== md5(value.token)
            || value.runId !== "" && !cwOfficialHash(value.runId) || value.lastIssueHash !== "" && !cwOfficialHash(value.lastIssueHash)
            || ["requestCount", "successCount"].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 999999)
            || value.successCount > value.requestCount
            || ["tokenCapturedAt", "templateCapturedAt", "lastRequestAt", "lastSuccessAt"].some(key => value[key] !== null
                && (!cwOfficialTime(value[key]) || value[key] > now + (key === "lastRequestAt" ? 60000 : 0)))) return null;
        const template = value.template === null ? null : cwOfficialTemplateFields(value.template);
        if (template ? !value.token || value.templateHash !== md5(JSON.stringify(template)) || value.templateCapturedAt === null : value.templateHash !== "" || value.templateCapturedAt !== null) return null;
        if (value.token ? value.tokenCapturedAt === null : value.tokenCapturedAt !== null) return null;
        if (["pending", "ready"].includes(value.status) && (!value.token || !template)
            || value.status === "waiting_template" && (!value.token || template)
            || ["waiting_token", "invalid", "signed_out", "expired"].includes(value.status) && (value.token || template)) return null;
        let issueTicket = null;
        if (value.issueTicket !== null) {
            const ticket = value.issueTicket;
            if (!cwObject(ticket) || !cwOfficialHash(ticket.requestHash) || ticket.owner !== value.owner || ticket.generation !== value.generation
                || !cwOfficialTime(ticket.at) || ticket.at > now || !CW_APP_HOSTS.includes(ticket.host) || !["h5", "gw"].includes(ticket.channel)) return null;
            issueTicket = {requestHash: ticket.requestHash, owner: ticket.owner, generation: ticket.generation, at: ticket.at, host: ticket.host, channel: ticket.channel};
        }
        return {version: CW_VERSION, owner: value.owner, generation: value.generation, revision: value.revision, status: value.status,
            token: value.token, tokenHash: value.tokenHash, tokenCapturedAt: value.tokenCapturedAt, template, templateHash: value.templateHash,
            templateCapturedAt: value.templateCapturedAt, issueTicket, lastIssueHash: value.lastIssueHash, runId: value.runId,
            snapshot: cwOfficialSnapshot(value.snapshot, now), requestCount: value.requestCount, successCount: value.successCount,
            lastRequestAt: value.lastRequestAt, lastSuccessAt: value.lastSuccessAt, failure: value.failure, captureResult: value.captureResult, at: value.at};
    } catch { return null; }
}

function cwOfficialInitial(owner, now, status = "waiting_token", tokenHash = "") {
    return {version: CW_VERSION, owner, generation: cwOfficialNonce(now), revision: cwOfficialNonce(now), status, token: "", tokenHash,
        tokenCapturedAt: null, template: null, templateHash: "", templateCapturedAt: null, issueTicket: null, lastIssueHash: "", runId: "", snapshot: null,
        requestCount: 0, successCount: 0, lastRequestAt: null, lastSuccessAt: null, failure: "NONE", captureResult: "NONE", at: now};
}

function cwOfficialSignature(value) {
    const text = JSON.stringify(value ?? null);
    if (typeof text !== "string" || text.length > 768 * 1024) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return text;
}

function cwOfficialAccess(ctx, now) {
    try {
        const raw = ctx.storage.getJSON(CW_OFFICIAL_STORE), barrier = ctx.storage.getJSON(CW_STORE);
        return {raw, state: cwOfficialState(raw, now), signature: cwOfficialSignature(raw), barrier, barrierSignature: cwOfficialSignature(barrier)};
    } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
}

function cwOfficialGuard(ctx, reference, now) {
    if (!cwOfficialAuto(ctx) || !cwOfficialTime(now)) throw cwOfficialFail("SUPERSEDED");
    const current = cwOfficialAccess(ctx, now);
    if (current.signature !== reference.signature || current.barrierSignature !== reference.barrierSignature) throw cwOfficialFail("SUPERSEDED");
    return current;
}

function cwOfficialBlocked(reference, owner) {
    return cwObject(reference.barrier) && reference.barrier.blocked === true && reference.barrier.owner !== owner;
}

function cwOfficialCaptureBlocked(reference, owner) {
    if (!cwOfficialBlocked(reference, owner)) return false;
    // 现存 A 自己的屏障不妨碍真实 B 换号；保存 B 失败而仍留 A 状态时则必须保护 B。
    return !reference.state || reference.barrier.owner !== reference.state.owner || reference.barrier.owner === CW_OFFICIAL_CONFLICT_OWNER;
}

function cwOfficialWrite(ctx, reference, value, now) {
    cwOfficialGuard(ctx, reference, now);
    const state = cwOfficialState(value, now);
    if (!state) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    try { ctx.storage.setJSON(CW_OFFICIAL_STORE, state); } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
    const saved = cwOfficialAccess(ctx, now);
    if (saved.barrierSignature !== reference.barrierSignature) throw cwOfficialFail("SUPERSEDED");
    if (!saved.state || JSON.stringify(saved.state) !== JSON.stringify(state)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return saved;
}

function cwOfficialIsolate(ctx, reference, owner, now) {
    cwOfficialGuard(ctx, reference, now);
    const barrier = {version: CW_VERSION, owner, source: "capture", blocked: true, cookie: "", snapshot: null};
    try { ctx.storage.setJSON(CW_STORE, barrier); } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
    const saved = cwOfficialAccess(ctx, now);
    if (saved.signature !== reference.signature) throw cwOfficialFail("SUPERSEDED");
    if (!cwObject(saved.barrier) || saved.barrier.owner !== owner || saved.barrier.blocked !== true || saved.barrier.source !== "capture"
        || saved.barrier.cookie !== "" || saved.barrier.snapshot !== null) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return saved;
}

function cwOfficialObserveIdentity(ctx, reference, identity, route, now) {
    let state = reference.state;
    if (identity.conflict) {
        const owner = CW_OFFICIAL_CONFLICT_OWNER;
        reference = cwOfficialIsolate(ctx, reference, owner, now);
        state = {...cwOfficialInitial(owner, now, "invalid", state?.tokenHash || ""), failure: "ACCOUNT_BLOCKED", captureResult: "conflict"};
        return cwOfficialWrite(ctx, reference, state, now);
    }
    if (route.apiKind === "logout") {
        if (!state) return reference;
        const owner = identity.owner || state.owner;
        // 退出不得用旧 A 的流量撤销已经存在的 B 屏障。
        if (cwOfficialCaptureBlocked(reference, owner)) return reference;
        reference = cwOfficialIsolate(ctx, reference, owner, now);
        state = {...cwOfficialInitial(owner, now, "signed_out", state.tokenHash), failure: "SIGNED_OUT", captureResult: "signed_out"};
        return cwOfficialWrite(ctx, reference, state, now);
    }
    if (!identity.owner) return reference;
    if (route.kind === "token" && cwObject(reference.barrier) && reference.barrier.blocked === true && reference.barrier.owner === CW_OFFICIAL_CONFLICT_OWNER) {
        // 冲突占位不代表某个确定账号；仅新的同次一致签发请求可以重新绑定。
        reference = cwOfficialIsolate(ctx, reference, identity.owner, now);
        state = {...cwOfficialInitial(identity.owner, now, "waiting_token", state?.tokenHash || ""), captureResult: "anonymous"};
        return cwOfficialWrite(ctx, reference, state, now);
    }
    if (!state || identity.owner === state.owner) return reference;
    if (cwOfficialCaptureBlocked(reference, identity.owner)) throw cwOfficialFail("ACCOUNT_BLOCKED");
    reference = cwOfficialIsolate(ctx, reference, identity.owner, now);
    const publicOnly = route.apiKind === "public_time";
    // 公共请求不能为 B 建候选；明确换号只清掉 A，并保留 B 屏障等待真正签发。
    state = {...cwOfficialInitial(publicOnly ? state.owner : identity.owner, now, publicOnly ? "invalid" : "waiting_token", state.tokenHash),
        failure: publicOnly ? "ACCOUNT_BLOCKED" : "NONE", captureResult: "anonymous"};
    return cwOfficialWrite(ctx, reference, state, now);
}

function cwOfficialLogFailure(error) {
    if (error?.officialCode === "STORAGE_UNCONFIRMED") console.log("[菜鸟官方] 本机状态保存未确认，未发送个人查询或输出敏感内容。");
}

export async function captureCainiaoOfficialRequest(ctx, clock = () => Date.now()) {
    if (!cwOfficialAuto(ctx) || !ctx.request || ctx.response) return;
    const request = ctx.request;
    let route, now, reference;
    try {
        route = cwOfficialRoute(request.url, request.headers);
        const observed = route || cwAppRoute(request.url, request.headers);
        if (!observed || cwOfficialSelf(request)) return;
        now = clock(); if (!cwOfficialTime(now)) return;
        reference = cwOfficialAccess(ctx, now);
        reference = cwOfficialObserveIdentity(ctx, reference, cwOfficialIdentity(request.headers), observed, now);
        if (!route || reference.state?.status === "invalid" && reference.state.captureResult === "conflict") return;
        if (route.kind === "token") {
            const identity = cwOfficialIdentity(request.headers);
            if (!identity.owner || cwOfficialBlocked(reference, identity.owner)) return;
            let state = reference.state;
            if (!state) state = cwOfficialInitial(identity.owner, now);
            if (state.owner !== identity.owner) return;
            const hash = cwOfficialTicketHash(request);
            if (hash === state.lastIssueHash || state.issueTicket?.requestHash === hash) return;
            state = {...state, revision: cwOfficialNonce(now), runId: "", issueTicket: {requestHash: hash, owner: state.owner, generation: state.generation, at: now, host: route.host, channel: route.channel}, captureResult: "ticket", at: now};
            cwOfficialWrite(ctx, reference, state, now);
            return;
        }
        if (String(request.method || "").toUpperCase() !== "POST" || cwOfficialDeclaredBody(request.headers) > CW_OFFICIAL_BODY_LIMIT) return;
    } catch (error) { cwOfficialLogFailure(error); return; }
    let bytes;
    try {
        bytes = cwOfficialBytes(await request.arrayBuffer());
        const after = clock();
        if (ctx.request !== request || ctx.response || after < now) throw cwOfficialFail("SUPERSEDED");
        cwOfficialGuard(ctx, reference, after);
        const body = cwOfficialParseBytes(bytes, request.headers), state = reference.state;
        if (!state || !state.token || cwOfficialBlocked(reference, state.owner) || cwOfficialObservedTemplateToken(body) !== state.token) return {body: bytes};
        let parsed;
        try {
            parsed = cwOfficialTemplate(body);
            const rpc = cwAppHeaderValues(request.headers, "http-rpc-type");
            if (rpc.some(value => value.trim() !== "JsonContent")) throw cwOfficialFail();
        } catch {
            // 同 token 的未知实际合同停止旧模板；不同 token、歧义或迟到正文没有此权限。
            cwOfficialWrite(ctx, reference, {...state, template: null, templateHash: "", templateCapturedAt: null, status: "waiting_template",
                revision: cwOfficialNonce(after), runId: "", failure: "SCHEMA_INVALID", captureResult: "invalid", at: after}, after);
            return {body: bytes};
        }
        const templateHash = md5(JSON.stringify(parsed.template));
        if (state.templateHash === templateHash && ["pending", "ready"].includes(state.status)) return {body: bytes};
        cwOfficialWrite(ctx, reference, {...state, template: parsed.template, templateHash, templateCapturedAt: after,
            status: "pending", revision: cwOfficialNonce(after), runId: "", failure: "NONE", captureResult: "template", at: after}, after);
    } catch (error) { cwOfficialLogFailure(error); }
    return bytes ? {body: bytes} : undefined;
}

export async function captureCainiaoOfficialResponse(ctx, clock = () => Date.now()) {
    if (!cwOfficialAuto(ctx) || !ctx.request || !ctx.response) return;
    const request = ctx.request, response = ctx.response;
    let route, now, reference;
    try {
        route = cwOfficialRoute(request.url, request.headers);
        if (!route || route.kind !== "token" || cwOfficialSelf(request, response)) return;
        now = clock(); if (!cwOfficialTime(now)) return;
        reference = cwOfficialAccess(ctx, now);
        if (cwOfficialDeclaredBody(response.headers) > CW_OFFICIAL_BODY_LIMIT) return;
    } catch (error) { cwOfficialLogFailure(error); return; }
    let bytes;
    try {
        bytes = cwOfficialBytes(await response.arrayBuffer());
        const after = clock();
        if (ctx.request !== request || ctx.response !== response || after < now) throw cwOfficialFail("SUPERSEDED");
        cwOfficialGuard(ctx, reference, after);
        const identity = cwOfficialIdentity(request.headers), state = reference.state, ticket = state?.issueTicket;
        if (!state || !ticket || identity.conflict || !identity.owner || identity.owner !== state.owner || cwOfficialBlocked(reference, state.owner)
            || ticket.requestHash !== cwOfficialTicketHash(request) || ticket.host !== route.host || ticket.channel !== route.channel
            || ticket.owner !== state.owner || ticket.generation !== state.generation || after - ticket.at >= CW_OFFICIAL_TICKET_WINDOW || response.status !== 200) return {body: bytes};
        const body = cwOfficialParseBytes(bytes, response.headers);
        if (Object.hasOwn(body, "api") && (typeof body.api !== "string" || body.api.toLowerCase() !== CW_OFFICIAL_TOKEN_API)) throw cwOfficialFail();
        if (Object.hasOwn(body, "v") && body.v !== "1.0") throw cwOfficialFail();
        if (!Array.isArray(body.ret) || body.ret.length < 1 || body.ret.length > 16
            || body.ret.some(value => typeof value !== "string" || value.length > 512 || value.split("::", 1)[0] !== "SUCCESS")
            || !cwObject(body.data) || !cwOfficialOpaque(body.data.result)) throw cwOfficialFail();
        const token = body.data.result, tokenHash = md5(token);
        let next;
        if (state.tokenHash === tokenHash) {
            // 同值拒绝凭据只消费票据，不复活代次，也不刷新快照时间或借回旧模板。
            next = {...state, issueTicket: null, lastIssueHash: ticket.requestHash, revision: cwOfficialNonce(after), runId: "", captureResult: "unchanged", at: after};
        } else {
            next = {...cwOfficialInitial(state.owner, after, "waiting_template"), token, tokenHash, tokenCapturedAt: after,
                snapshot: state.snapshot, lastIssueHash: ticket.requestHash, captureResult: "issued"};
        }
        cwOfficialWrite(ctx, reference, next, after);
    } catch (error) { cwOfficialLogFailure(error); }
    return bytes ? {body: bytes} : undefined;
}

function cwOfficialModel(base, snapshot, status, message, extra = {}) {
    return {...base, items: snapshot?.items || [], total: snapshot?.total || 0, updatedAt: snapshot?.updatedAt || null,
        status, message, coverage: "official_summary", complete: false, pickupCodesConfirmed: false, ...extra};
}

function cwOfficialStop(base, code) {
    return cwOfficialModel(base, null, "setup", code === "STORAGE_UNCONFIRMED" ? "本机专用会话或账号屏障无法确认，请检查 Egern"
        : code === "ACCOUNT_BLOCKED" ? "账号已变化，旧专用会话和摘要已隔离" : "专用会话已更新，本轮旧查询未被采纳",
    {setupTitle: code === "STORAGE_UNCONFIRMED" ? "检查 Egern 存储" : "重新连接 App"});
}

export async function loadCainiaoOfficialModel(ctx, clock, base, bounded) {
    if (!cwOfficialAuto(ctx)) return null;
    const now = clock();
    let reference;
    try { reference = cwOfficialAccess(ctx, now); }
    catch { return cwOfficialStop(base, "STORAGE_UNCONFIRMED"); }
    if (reference.raw === null || reference.raw === undefined) return null;
    const original = reference.state;
    if (!original) return cwOfficialStop(base, "STORAGE_UNCONFIRMED");
    if (cwOfficialBlocked(reference, original.owner)) return cwOfficialStop(base, "ACCOUNT_BLOCKED");
    if (["invalid", "signed_out"].includes(original.status)) return cwOfficialStop(base, "ACCOUNT_BLOCKED");
    if (original.status === "expired") return cwOfficialModel(base, original.snapshot, "expired", "官方专用 token 已失效，请在 App 重新签发" + (original.snapshot ? " · 上次官方摘要" : ""));
    if (!original.token) return cwOfficialModel(base, null, "setup", "已观察到 App 身份，尚未取得本人专用 widget token", {setupTitle: "等待 App 专用会话"});
    if (!original.template) return cwOfficialModel(base, null, "setup", "已取得专用 token，尚未观察到匹配的实际查询参数；未猜测平台字段", {setupTitle: "等待 App 官方查询"});
    if (!cwOfficialTime(now) || typeof bounded !== "function") return cwOfficialStop(base, "STORAGE_UNCONFIRMED");
    const deadline = now + 18000;
    const timestamp = Math.max(now, (original.lastRequestAt || 0) + 1);
    let state = {...original, revision: cwOfficialNonce(now), runId: cwOfficialNonce(now), status: "pending", at: now,
        requestCount: Math.min(original.requestCount + 1, 999999), lastRequestAt: timestamp, failure: "NONE"};
    try { reference = cwOfficialWrite(ctx, reference, state, now); state = reference.state; }
    catch (error) { return cwOfficialStop(base, error?.officialCode); }
    const guard = () => {
        const current = cwOfficialGuard(ctx, reference, clock());
        if (!current.state || current.state.runId !== state.runId || current.state.generation !== state.generation || current.state.owner !== state.owner
            || current.state.tokenHash !== state.tokenHash || current.state.templateHash !== state.templateHash || cwOfficialBlocked(current, state.owner)) throw cwOfficialFail("SUPERSEDED");
        if (clock() >= deadline) throw cwOfficialFail("DEADLINE");
    };
    try {
        const requestBody = JSON.stringify({argsTypes: [CW_OFFICIAL_ARGS_TYPE], argsObjs: [{...state.template, token: state.token, timestamp}]});
        let response;
        try {
            response = await bounded(() => {
                guard();
                return ctx.http.post(CW_OFFICIAL_QUERY_URL, {body: requestBody,
                    headers: {"Http-Rpc-Type": "JsonContent", "Content-Type": "application/json", [CW_SELF_HEADER]: "1"},
                    timeout: Math.max(1, Math.min(7000, deadline - clock() - 500)), credentials: "omit", redirect: "manual", insecureTls: false});
            }, deadline, clock);
        } catch (error) { throw error?.officialCode ? error : cwOfficialFail(error?.failure === "DEADLINE" ? "DEADLINE" : "OFFLINE"); }
        guard();
        if (!response || response.status !== 200) throw cwOfficialFail("HTTP_REJECTED");
        if (cwOfficialDeclaredBody(response.headers) > CW_OFFICIAL_BODY_LIMIT) throw cwOfficialFail();
        let text;
        try { text = await bounded(() => { guard(); return response.text(); }, deadline, clock); }
        catch (error) { throw error?.officialCode ? error : cwOfficialFail(error?.failure === "DEADLINE" ? "DEADLINE" : "OFFLINE"); }
        guard();
        const snapshot = cwOfficialReadSummary(cwOfficialParseText(text, response.headers), clock());
        guard();
        const after = clock();
        state = {...state, snapshot, status: "ready", successCount: Math.min(state.successCount + 1, 999999), lastSuccessAt: after, failure: "NONE", at: after};
        reference = cwOfficialWrite(ctx, reference, state, after); state = reference.state;
        guard();
        return cwOfficialModel(base, snapshot, "ready", snapshot.total > 0 && !snapshot.items.length
            ? "官方摘要独立查询成功 · 有待取包裹，摘要未提供" : "官方摘要独立查询成功", {officialRequestCount: state.requestCount, officialSuccessCount: state.successCount});
    } catch (error) {
        const code = error?.officialCode || "SCHEMA_INVALID";
        if (["SUPERSEDED", "STORAGE_UNCONFIRMED"].includes(code)) return cwOfficialStop(base, code);
        try {
            // 超时可以保存固定失败，但仍须先复核归属；不能因 deadline 跳过账号守卫。
            cwOfficialGuard(ctx, reference, clock());
            const after = clock();
            state = {...state, snapshot: cwOfficialSnapshot(original.snapshot, after), successCount: original.successCount, lastSuccessAt: original.lastSuccessAt,
                at: after, failure: CW_OFFICIAL_FAILURES.includes(code) ? code : "SCHEMA_INVALID", status: code === "INVALID_TOKEN" ? "expired" : "pending"};
            if (code === "INVALID_TOKEN") state = {...state, token: "", tokenCapturedAt: null, template: null, templateHash: "", templateCapturedAt: null, issueTicket: null};
            reference = cwOfficialWrite(ctx, reference, state, after); state = reference.state;
        } catch (failure) { return cwOfficialStop(base, failure?.officialCode); }
        const snapshot = state.snapshot, labels = {INVALID_TOKEN: "官方专用 token 已失效，请在 App 重新签发", QUERY_ERROR: "官方摘要查询未成功", BUSINESS_FAILURE: "官方摘要业务请求未成功",
            HTTP_REJECTED: "官方摘要请求被服务器拒绝", SCHEMA_INVALID: "官方摘要结构未确认，未伪造空包裹", OFFLINE: "暂时无法取得新的官方摘要", DEADLINE: "本次官方摘要查询超时"};
        return cwOfficialModel(base, snapshot, code === "INVALID_TOKEN" ? "expired" : code === "OFFLINE" ? "offline" : "error",
            (labels[code] || labels.SCHEMA_INVALID) + (snapshot ? " · 上次官方摘要" : ""), {officialRequestCount: state.requestCount, officialSuccessCount: state.successCount});
    }
}

export function cwOfficialLines(ctx, now = Date.now()) {
    let reference;
    try { reference = cwOfficialAccess(ctx, now); }
    catch { return ["官方专用会话：本机存储或账号屏障无法读取。未显示异常原文。"]; }
    if (reference.raw === null || reference.raw === undefined) return ["官方专用会话：尚未捕获本人专用 token 与实际 RPC 参数。"];
    const state = reference.state;
    if (!state) return ["官方专用会话：本机状态格式未确认，未继承凭据或成功证明。"];
    if (cwOfficialBlocked(reference, state.owner)) return ["官方专用会话：账号屏障生效，旧 token 与摘要已阻断。"];
    const statuses = {waiting_token: "等待专用 token", waiting_template: "已捕获 token，等待同值实际 RPC 参数", pending: "参数已绑定，等待新的摘要查询", ready: "已有独立官方摘要成功记录",
        expired: "专用 token 已拒绝，停止重试", invalid: "账号冲突或已变化，旧摘要已隔离", signed_out: "已观察到退出请求，专用会话停止"};
    const captures = {NONE: "尚无采集", ticket: "已记录本次签发请求票据", issued: "已捕获本次专用 token", template: "已绑定实际 RPC 参数", unchanged: "同值记录保留原状态", anonymous: "身份变化，等待新签发",
        invalid: "格式未确认", token_mismatch: "请求 token 未匹配本次签发", conflict: "同次身份冲突", signed_out: "已观察到退出"};
    const lines = ["官方专用会话：" + statuses[state.status], "最近采集：" + captures[state.captureResult],
        "独立查询尝试：" + state.requestCount + " 次；官方摘要成功：" + state.successCount + " 次。",
        "最近查询分类：" + state.failure, "覆盖范围：官方摘要；完整列表和结构化取件码均未确认。"];
    if (state.lastRequestAt !== null) lines.push("最近生成请求时间戳：" + state.lastRequestAt);
    if (state.lastSuccessAt !== null) lines.push("最近独立摘要成功：" + new Date(state.lastSuccessAt).toISOString());
    return lines;
}
