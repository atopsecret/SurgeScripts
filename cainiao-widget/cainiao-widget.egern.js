// Egern 原生菜鸟取件小组件 1.2.1 · 自动构建，请编辑本目录源文件。
// 构建：node cainiao-widget/build.mjs；来源与许可见 THIRD_PARTY_NOTICES.md。
// 来源：core.mjs
// 引擎：Egern JavaScript | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用；离线验证 node --test cainiao-widget/tests/core.test.cjs
// 依赖：无；协议来源见 THIRD_PARTY_NOTICES.md

const CW_VERSION = "1.2.1";
const CW_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const CW_COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
const CW_IDENTITY_API = "mtop.user.getUserSimple";
const CW_HOST = "https://h5api.m.taobao.com";
const CW_PATH = "/h5/" + CW_API.toLowerCase() + "/1.0/";
const CW_COUNT_PATH = "/h5/" + CW_COUNT_API.toLowerCase() + "/1.0/";
const CW_IDENTITY_PATH = "/h5/" + CW_IDENTITY_API.toLowerCase() + "/1.0/";
const CW_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const CW_STORE = "cainiao-widget.local.v1";
const CW_AUTH_STORE = "cainiao-widget.auth.v1";
const CW_CAPTURE_STORE = "cainiao-widget.capture.v1";
const CW_APP_STORE = "cainiao-widget.app.v1";
const CW_SELF_HEADER = "X-Cainiao-Widget-Request";

// MD5 只用于 MTOP 协议签名与本地身份摘要，不用于加密存储。
function md5(value) {
    const bytes = [];
    for (const ch of String(value)) {
        let cp = ch.codePointAt(0);
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
        if (cp < 0x80) bytes.push(cp);
        else if (cp < 0x800) bytes.push(0xc0 | cp >> 6, 0x80 | cp & 63);
        else if (cp < 0x10000) bytes.push(0xe0 | cp >> 12, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
        else bytes.push(0xf0 | cp >> 18, 0x80 | cp >> 12 & 63, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
    }
    const bitLength = bytes.length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLength / 2 ** (i * 8)) & 255);
    const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let offset = 0; offset < bytes.length; offset += 64) {
        const words = Array.from({length: 16}, (_, i) => bytes[offset + i * 4] | bytes[offset + i * 4 + 1] << 8 | bytes[offset + i * 4 + 2] << 16 | bytes[offset + i * 4 + 3] << 24);
        let a = a0, b = b0, c = c0, d = d0;
        for (let i = 0; i < 64; i++) {
            let f, g;
            if (i < 16) { f = b & c | ~b & d; g = i; }
            else if (i < 32) { f = d & b | ~d & c; g = (5 * i + 1) % 16; }
            else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
            else { f = c ^ (b | ~d); g = 7 * i % 16; }
            const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) + words[g]) | 0;
            const s = shifts[Math.floor(i / 16) * 4 + i % 4];
            const next = (b + (sum << s | sum >>> (32 - s))) | 0;
            a = d; d = c; c = b; b = next;
        }
        a0 = a0 + a | 0; b0 = b0 + b | 0; c0 = c0 + c | 0; d0 = d0 + d | 0;
    }
    return [a0, b0, c0, d0].flatMap(n => [0, 8, 16, 24].map(s => (n >>> s & 255).toString(16).padStart(2, "0"))).join("");
}

function cwObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cwKnownVersion(value) {
    return ["1.1.0", "1.2.0", CW_VERSION].includes(value);
}

function cwText(value, limit = 160) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    if (typeof value === "number" && !Number.isFinite(value)) return "";
    const text = String(value).replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
    return /^(?:null|none|undefined|true|false)$/i.test(text) ? "" : text.slice(0, limit);
}

function cwFirst(object, keys, limit = 160) {
    if (!cwObject(object)) return "";
    for (const key of keys) {
        const text = cwText(object[key], limit);
        if (text) return text;
    }
    return "";
}

function cwFirstObject(object, keys) {
    for (const key of keys) if (cwObject(object[key])) return object[key];
    return {};
}

function cwCookieMap(header, includeEmpty = false) {
    if (typeof header !== "string" || header.length > 32768 || /[\r\n\x00]/.test(header)) throw new Error("cookie-format");
    const cookies = new Map();
    for (const part of header.replace(/^cookie:\s*/i, "").split(";")) {
        if (!part.trim()) continue;
        const at = part.indexOf("=");
        const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
        if (at < 1 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || !/^[\x21-\x3a\x3c-\x7e]*$/.test(value) || value.length > 8192) throw new Error("cookie-format");
        if (/^(?:path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name)) throw new Error("cookie-format");
        if (cookies.has(name) && cookies.get(name) !== value) throw new Error("cookie-duplicate");
        cookies.set(name, value);
    }
    return includeEmpty ? cookies : new Map([...cookies].filter(([, value]) => value));
}

function cwCookieHeader(cookies) {
    return [...cookies].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("; ");
}

function cwOwner(cookies) {
    const unb = cookies.get("unb");
    if (unb) return md5("account:" + unb);
    const session = ["cookie2", "sgcookie", "munb"].map(k => k + "=" + (cookies.get(k) || "")).join(";");
    return md5("session:" + (cookies.has("cookie2") || cookies.has("sgcookie") ? session : cwCookieHeader(cookies)));
}

// 只接受当前固定业务 URL 可用的 Set-Cookie，不把其他域或路径的值摊进请求头。
function cwUpdateCookies(cookies, headers, now = Date.now(), requestPath = CW_PATH) {
    let lines = [];
    if (headers && typeof headers.getAll === "function") lines = headers.getAll("set-cookie");
    else if (headers) {
        const value = headers["set-cookie"] ?? headers["Set-Cookie"];
        lines = Array.isArray(value) ? value : value ? [value] : [];
    }
    if (!Array.isArray(lines) || lines.length > 64 || lines.some(line => typeof line !== "string")
        || lines.reduce((size, line) => size + line.length, 0) > 65536) return;
    for (const line of lines) {
        if (typeof line !== "string" || /[\r\n\x00]/.test(line)) continue;
        // 合并头只在下一个 cookie 名称前分割，保留 Expires 的逗号。
        for (const entry of line.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)) {
            const parts = entry.split(";"), pair = parts.shift().trim(), at = pair.indexOf("=");
            if (at < 1) continue;
            let parsed;
            try { parsed = cwCookieMap(pair); } catch { continue; }
            const name = pair.slice(0, at), value = pair.slice(at + 1);
            const attrs = {};
            for (const attr of parts) {
                const index = attr.indexOf("=");
                attrs[(index < 0 ? attr : attr.slice(0, index)).trim().toLowerCase()] = index < 0 ? "" : attr.slice(index + 1).trim();
            }
            if (attrs.domain !== undefined) {
                const domain = attrs.domain.replace(/^\./, "").toLowerCase();
                if (!["taobao.com", "m.taobao.com", "h5api.m.taobao.com"].includes(domain)) continue;
            }
            const path = attrs.path || requestPath.slice(0, requestPath.lastIndexOf("/")) || "/";
            const matches = target => target === path || target.startsWith(path.endsWith("/") ? path : path + "/");
            // 新的账号检查同样只收可用于个人列表的 Cookie，不能摊平不相交的路径。
            if (!matches(CW_PATH) || !matches(requestPath)) continue;
            const age = attrs["max-age"];
            const expired = age !== undefined && /^-?\d+$/.test(age) ? Number(age) <= 0 : attrs.expires !== undefined && Date.parse(attrs.expires) <= now;
            if (!value || expired) cookies.delete(name);
            else if (parsed.has(name)) cookies.set(name, parsed.get(name));
        }
    }
}

function cwRequestData(page) {
    return JSON.stringify({pageSize: 50, currentPage: page, needTemporality: false, needDynInfo: "{'needFindTemporality':true,'needAppointment':true}"});
}

function cwMtopRequestURL(cookies, api, data, now) {
    const t = String(Math.floor(now));
    const token = (cookies.get("_m_h5_tk") || "").split("_")[0];
    const sign = md5(token + "&" + t + "&12574478&" + data);
    const query = {jsv: "2.7.4", appKey: "12574478", t, sign, api, v: "1.0", type: "originaljson", dataType: "json", data};
    return CW_HOST + "/h5/" + api.toLowerCase() + "/1.0/?" + Object.entries(query).map(([key, value]) => key + "=" + encodeURIComponent(value)).join("&");
}

function cwRequestURL(cookies, page, now) {
    return cwMtopRequestURL(cookies, CW_API, cwRequestData(page), now);
}

function cwAccountRequestURL(cookies, now) {
    return cwMtopRequestURL(cookies, CW_COUNT_API, JSON.stringify({appName: "GUOGUO"}), now);
}

function cwIdentityRequestURL(cookies, now) {
    // 直接请求 H5，不运行 WindVane、SDK 自动登录或网页交互。
    return cwMtopRequestURL(cookies, CW_IDENTITY_API, "{}", now);
}

function cwResponseAPI(body, api) {
    return cwObject(body) && typeof body.api === "string" && body.api.toLowerCase() === api.toLowerCase()
        && (body.v === undefined || body.v === "1.0");
}

function cwIdentityMatch(body, expectedUid) {
    // 官方页面消费的是顶层 userNumId；未知别名或昵称不能补判身份。
    if (!cwResponseAPI(body, CW_IDENTITY_API) || cwReturnKind(body) !== "success"
        || typeof expectedUid !== "string" || !/^[1-9][0-9]{0,19}$/.test(expectedUid)) return "unverified";
    const value = body.userNumId;
    const uid = typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value
        : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "";
    return !uid ? "unverified" : uid === expectedUid ? "match" : "mismatch";
}

function cwReturnKind(body) {
    if (!cwObject(body) || !Array.isArray(body.ret) || !body.ret.length || body.ret.some(v => typeof v !== "string")) return "schema";
    const codes = body.ret.map(value => value.split("::")[0].toUpperCase());
    if (codes.every(code => code === "SUCCESS")) return "success";
    if (codes.some(code => /SESSION|LOGIN|AUTH_REJECT|USER_NOT_LOGIN/.test(code))) return "expired";
    if (codes.some(code => /RGV|VALIDATE|CAPTCHA|TRAFFIC|FLOOD|USER_VALIDATE|ACCESS_DENIED/.test(code))) return "verify";
    if (codes.some(code => /TOKEN_EMPTY|TOKEN_EXPIRED|TOKEN_EXOIRED|ILLEGAL_ACCESS/.test(code))) return "token";
    return "error";
}

function cwReadPage(body, requestedPage) {
    let data = body.data;
    if (cwObject(data) && cwObject(data.data)) data = data.data;
    if (!cwObject(data) || !Array.isArray(data.packages) || data.packages.length > 50 || data.packages.some(p => !cwObject(p))) throw new Error("schema");
    const number = value => typeof value === "number" || typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    const current = data.currentPage === undefined ? requestedPage : number(data.currentPage);
    const last = data.totalPage === undefined ? null : number(data.totalPage);
    if (!Number.isInteger(current) || current !== requestedPage || last !== null && (!Number.isInteger(last) || last < 0 || last > 10000 || last < current && !(last === 0 && current === 1 && data.packages.length === 0))) throw new Error("schema");
    if (!data.packages.length && last !== null && last > current) throw new Error("schema");
    return {packages: data.packages, complete: !data.packages.length || last !== null && current >= last};
}

function cwNormalizePackage(raw) {
    if (!cwObject(raw)) throw new Error("schema");
    const known = ["mailNo", "mail_no", "packageId", "package_id", "logisticsStatus", "logistics_status", "packageStation", "package_station", "station", "pkgStation"];
    if (!known.some(k => Object.hasOwn(raw, k))) throw new Error("schema");
    const station = cwFirstObject(raw, ["packageStation", "package_station", "station", "pkgStation"]);
    const feature = cwFirstObject(raw, ["feature"]);
    const candidates = [station.authCode, station.auth_code, station.showPickupCode, station.show_pickup_code, station.pickUpCode, station.pickupCode, feature.stationOrderPickUpCode, feature.station_order_pick_up_code].map(value => cwText(value, 96));
    const usable = text => text && !/^(?:needsms|need_sms|-1|0|null|none|undefined|true|false)$/i.test(text);
    const code = candidates.find(usable) || "";
    const requiresVerification = !code && candidates.some(text => /^(?:needsms|need_sms)$/i.test(text));
    const status = cwFirst(raw, ["logisticsStatus", "logistics_status"]).toUpperCase();
    const stationId = cwFirst(station, ["stationId", "station_id"]);
    if (/^(?:CANCEL|REJECT|RETURN|LOST|PICKED_UP|PICKEDUP)$/.test(status)) return null;
    const waiting = !!code || requiresVerification || !!stationId && !/^(?:SIGN|已签收|已领取|已取件)$/.test(status);
    if (!waiting) return null;
    const mail = cwFirst(raw, ["mailNo", "mail_no"], 100);
    const packageId = cwFirst(raw, ["packageId", "package_id", "id"], 100);
    // 站名和缺码无法证明包裹唯一；缺少标识时停止更新，不能把同站多件合成一件。
    if (!mail && !packageId) throw new Error("schema");
    const stationName = cwFirst(station, ["stationName", "station_name"]);
    const company = cwFirst(raw, ["partnerName", "partner_name"], 36) || "快递";
    return {
        id: md5(mail ? "mail:" + mail.toUpperCase() : "package:" + packageId),
        code, station: stationName || "驿站信息待更新", company,
        tail: mail ? mail.slice(-4) : "", requiresVerification,
    };
}

function cwItems(packages) {
    const result = new Map();
    for (const raw of packages) {
        const item = cwNormalizePackage(raw);
        if (!item) continue;
        const old = result.get(item.id);
        if (!old || !old.code && item.code) result.set(item.id, item);
    }
    // 有真实码的条目靠前，同一驿站相邻；原始运单号只参与摘要，不进入缓存。
    return [...result.values()].sort((a, b) => Number(!a.code) - Number(!b.code) || a.station.localeCompare(b.station) || a.id.localeCompare(b.id));
}

// 来源：app.mjs
// 引擎：Egern 原生请求头 API | 版本：1.2.1 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由同一小组件的请求入口调用；离线 node --test cainiao-widget/tests/app-entry.test.cjs
// 依赖：core.mjs；不读 App 正文、不改流量、不发网络请求

const CW_APP_HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const CW_APP_ROUTE = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com|cn-acs\.m\.cainiao\.com|e2e-mtop\.cainiao\.com)(?::443)?\/(h5|gw)\/(mtop(?:\.[A-Za-z0-9_-]+)+)(?:\/([0-9]+(?:\.[0-9]+)*|\*))?\/?(?:\?[^#\s]*)?$/i;
const CW_APP_COOKIES = ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"];
const CW_APP_NATIVE_HEADERS = ["x-sid", "x-uid", "x-t", "x-sign", "x-mini-wua", "x-umt", "x-sgext"];
const CW_APP_API_KINDS = ["personal_list", "personal_count", "public_time", "other"];
const CW_APP_WINDOW = 7 * 86400000;

function cwAppHeaderValues(headers, name) {
    if (!headers) return [];
    const values = typeof headers.getAll === "function" ? headers.getAll(name)
        : typeof headers.get === "function" ? [headers.get(name)].filter(value => value !== null && value !== undefined) : [];
    if (!Array.isArray(values) || values.length > 16 || values.some(value => typeof value !== "string")
        || values.reduce((size, value) => size + value.length, 0) > 65536
        || values.some(value => /[\r\n\x00]/.test(value))) throw new Error("header-format");
    return values;
}

function cwAppRoute(value, headers) {
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
        : api === "mtop.common.gettimestamp" ? "public_time" : "other";
    return {host, channel, apiKind};
}

function cwAppSingleHeader(headers, name) {
    const values = cwAppHeaderValues(headers, name).map(value => value.trim());
    if (values.some(value => value !== values[0])) throw new Error("native-duplicate");
    return values[0] || "";
}

// 这是待验证的 native 会话，不是官方承诺的 H5 Cookie 别名。
function cwAppNativeFields(headers) {
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
    if (!cwObject(value) || value.version !== CW_VERSION || !Array.isArray(value.rows)
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

function cwObserveApp(ctx, route, cookies, native, now) {
    const nativeHeaders = CW_APP_NATIVE_HEADERS.filter(name => cwAppHeaderValues(ctx.request.headers, name).some(value => value.trim()));
    const presentCookies = CW_APP_COOKIES.filter(name => cookies.has(name));
    const sameRequestLoginFields = !!cookies.get("unb") && (cookies.has("cookie2") || cookies.has("sgcookie"));
    const sameRequestNativeSession = route.channel === "gw" && !!native.uid && !!native.sid;
    const state = cwAppState(ctx.storage.getJSON(CW_APP_STORE), now);
    let row = state.rows.find(item => item.host === route.host && item.channel === route.channel && item.apiKind === route.apiKind);
    if (!row) {
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

function cwAppSummary(ctx, now = Date.now()) {
    const state = cwAppState(ctx.storage.getJSON(CW_APP_STORE), now), rows = state.rows;
    return {observed: rows.length > 0, lastAt: rows.length ? Math.max(...rows.map(row => row.at)) : null,
        sameRequestLoginFields: rows.some(row => row.sameRequestLoginFields), sameRequestNativeSession: rows.some(row => row.sameRequestNativeSession), rows};
}

// 来源：auth.mjs
// 引擎：Egern 原生请求捕获 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：模块自动捕获；离线 node --test cainiao-widget/tests/auth.test.cjs
// 依赖：core.mjs；只读请求头，原样放行，不发送网络请求

const CW_AUTH_NAMES = new Set(["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"]);
const CW_AUTH_STATUSES = new Set(["pending", "connected", "expired", "verify", "invalid", "unsupported"]);
const CW_AUTH_TERMINAL_STATUSES = new Set(["expired", "verify", "invalid", "unsupported"]);
const CW_QUERY_FAILURES = new Set(["TOKEN_NOT_ISSUED", "TOKEN_RETRY_EXHAUSTED", "AUTH_REJECTED", "ILLEGAL_ACCESS", "SESSION_MISSING",
    "SESSION_UNSTABLE", "IDENTITY_UNVERIFIED", "ACCOUNT_MISMATCH", "API_MISMATCH", "SCHEMA_INVALID", "VERIFY_REQUIRED", "OFFLINE",
    "DEADLINE", "PARTIAL", "STORAGE_UNCONFIRMED", "NONE", "UNKNOWN"]);
const CW_QUERY_RET_CODES = new Set(["SUCCESS", "FAIL_SYS_TOKEN_EMPTY", "FAIL_SYS_TOKEN_EXPIRED", "FAIL_SYS_TOKEN_EXOIRED",
    "FAIL_SYS_SESSION_EXPIRED", "FAIL_SYS_SESSION_MISSING", "FAIL_SYS_LOGIN_REQUIRED", "FAIL_SYS_USER_NOT_LOGIN", "FAIL_SYS_AUTH_REJECT",
    "FAIL_SYS_ILLEGAL_ACCESS", "FAIL_SYS_USER_VALIDATE", "FAIL_SYS_ACCESS_DENIED", "FAIL_SYS_TRAFFIC_LIMIT", "FAIL_SYS_FLOW_LIMIT",
    "FAIL_SYS_RGV587_ERROR", "FAIL_SYS_API_NOT_FOUND", "FAIL_SYS_SERVICE_NOT_EXIST", "FAIL_SYS_PARAM_MISSING", "NONE", "OTHER"]);
const CW_QUERY_HTTP_CLASSES = new Set(["HTTP_200", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_3XX", "HTTP_5XX", "HTTP_OTHER", "NONE"]);
const CW_QUERY_WINDOW = 7 * 86400000;
const CW_CAPTURE_RESULTS = {
    saved: "已保存 App 会话候选，等待个人列表查询确认",
    unchanged: "登录态未变化，保留当前状态",
    anonymous: "已看到 App 请求，但本次没有完整可复用会话",
    invalid: "本次请求头无效，未保存凭据",
    conflict: "App 账号字段冲突，旧登录态与快照已隔离",
    storage: "本机存储未确认保存，请检查 Egern 后重开 App 快递列表",
    superseded: "已有更新的捕获结果，未回写旧凭据",
};

function cwConnectionMode(env = {}) {
    const mode = env.CONNECTION_MODE || "auto";
    return ["auto", "manual", "off"].includes(mode) ? mode : "invalid";
}

function cwCaptureURL(value) {
    return cwAppRoute(value)?.host || "";
}

function cwHeaderValues(headers, name) {
    return cwAppHeaderValues(headers, name);
}

function cwCapturedCookies(headers) {
    const values = cwHeaderValues(headers, "cookie");
    if (values.length > 8 || values.reduce((size, value) => size + value.length + 2, 0) > 32768) throw new Error("cookie-format");
    // 分开解析和检测多头重名，不能使用 Headers.get() 的逗号合并结果。
    const cookies = new Map();
    for (const value of values) {
        for (const [name, item] of cwCookieMap(value, true)) {
            if (cookies.has(name) && cookies.get(name) !== item) throw new Error("cookie-duplicate");
            cookies.set(name, item);
        }
    }
    return cwAuthCookies(new Map([...cookies].filter(([, value]) => value)));
}

function cwAuthCookies(cookies) {
    return new Map([...cookies].filter(([name]) => CW_AUTH_NAMES.has(name)));
}

function cwLoginCandidate(cookies) {
    return /^[A-Za-z0-9_-]{1,128}$/.test(cookies.get("unb") || "") && (cookies.has("cookie2") || cookies.has("sgcookie"));
}

function cwSessionHash(cookies) {
    return md5("capture-session:" + ["unb", "cookie2", "sgcookie", "munb"].map(name => name + "=" + (cookies.get(name) || "")).join(";"));
}

function cwRequiresIdentity(state) {
    return !!state && ["native_session_candidate", "request_cookie_candidate"].includes(state.captureKind);
}

function cwAuthState(value, now = Date.now()) {
    const legacy = cwObject(value) && value.version === "1.1.0";
    if (!cwObject(value) || !cwKnownVersion(value.version) || !CW_AUTH_STATUSES.has(value.status)
        || typeof value.generation !== "string" || !/^[0-9a-f]{32}$/.test(value.generation)
        || !Number.isFinite(value.capturedAt) || value.capturedAt <= 0 || value.capturedAt > now + 60000
        || !(value.confirmedAt === null || Number.isFinite(value.confirmedAt) && value.confirmedAt > 0 && value.confirmedAt <= now + 60000)
        || value.status === "connected" && value.confirmedAt === null
        || !(legacy ? ["h5api.m.taobao.com", "acs.m.taobao.com"] : CW_APP_HOSTS).includes(value.sourceHost)
        || legacy && value.status === "unsupported") return null;
    const captureKind = legacy ? "request_cookie" : value.captureKind;
    const sourceChannel = legacy ? "h5" : value.sourceChannel;
    const accountCheckedAt = legacy ? null : value.accountCheckedAt;
    const accountSessionHash = legacy ? "" : value.accountSessionHash;
    const restricted = cwRequiresIdentity({captureKind});
    if (!["request_cookie", "native_session_candidate", "request_cookie_candidate"].includes(captureKind)
        || value.version === "1.2.0" && captureKind === "request_cookie_candidate" || !["h5", "gw"].includes(sourceChannel)
        || !(accountCheckedAt === null || Number.isFinite(accountCheckedAt) && accountCheckedAt > 0 && accountCheckedAt <= now + 60000)
        || typeof accountSessionHash !== "string" || accountSessionHash !== "" && !/^[0-9a-f]{32}$/.test(accountSessionHash)
        || (accountCheckedAt === null) !== (accountSessionHash === "")
        || restricted && (sourceChannel !== "gw" || value.status === "connected"
            && (accountCheckedAt === null || accountCheckedAt > value.confirmedAt))
        || captureKind === "request_cookie" && (accountCheckedAt !== null || value.status === "unsupported")) return null;
    let cookies;
    try { cookies = cwCookieMap(value.cookie); } catch { return null; }
    if (!cwLoginCandidate(cookies) || [...cookies.keys()].some(name => !CW_AUTH_NAMES.has(name))
        || value.cookie !== cwCookieHeader(cookies) || value.owner !== cwOwner(cookies)
        || value.sessionHash !== cwSessionHash(cookies) || value.inputHash !== md5(value.cookie)
        || restricted && !/^[1-9][0-9]{0,19}$/.test(cookies.get("unb") || "")
        || captureKind === "native_session_candidate" && (!/^[A-Za-z0-9._~%+/=-]{8,8192}$/.test(cookies.get("cookie2") || "")
            || [...cookies.keys()].some(name => !["unb", "cookie2"].includes(name)))) return null;
    return {version: CW_VERSION, owner: value.owner, sessionHash: value.sessionHash, generation: value.generation,
        inputHash: value.inputHash, cookie: value.cookie, status: value.status,
        capturedAt: value.capturedAt, confirmedAt: value.confirmedAt, sourceHost: value.sourceHost,
        captureKind, sourceChannel, accountCheckedAt, accountSessionHash};
}

function cwCachedAuthStatus(cached, auth) {
    return cwObject(cached) && auth && cwKnownVersion(cached.version) && cached.source === "auto"
        && cached.owner === auth.owner && cached.generation === auth.generation && cached.inputHash === auth.inputHash
        && CW_AUTH_TERMINAL_STATUSES.has(cached.terminalStatus) ? cached.terminalStatus : "";
}

function cwQueryRetCode(body) {
    if (!cwObject(body) || !Array.isArray(body.ret) || !body.ret.length) return "NONE";
    // 只输出固定前缀；未知值和 :: 后的服务端文本均不进入报告。
    const codes = body.ret.map(value => typeof value === "string" ? value.split("::", 1)[0].toUpperCase() : "OTHER");
    const code = codes.find(value => value !== "SUCCESS") || "SUCCESS";
    return CW_QUERY_RET_CODES.has(code) && !["NONE", "OTHER"].includes(code) ? code : "OTHER";
}

function cwQueryFields(record, now = Date.now()) {
    if (!cwObject(record) || record.schema !== 1 || !["initial", "refresh", "revalidate"].includes(record.phase)
        || !["identity", "count", "pds"].includes(record.stage) || !CW_QUERY_FAILURES.has(record.failure)
        || !CW_QUERY_RET_CODES.has(record.retCode) || !CW_QUERY_HTTP_CLASSES.has(record.httpClass)
        || typeof record.tokenPresentBefore !== "boolean" || typeof record.tokenUpdated !== "boolean"
        || !Number.isInteger(record.sessionAttempt) || record.sessionAttempt < 1 || record.sessionAttempt > 3
        || !Number.isInteger(record.tokenAttempt) || record.tokenAttempt < 1 || record.tokenAttempt > 3
        || !(record.stage === "pds" ? Number.isInteger(record.page) && record.page >= 1 && record.page <= 20 : record.page === null)
        || !Number.isSafeInteger(now) || !Number.isSafeInteger(record.at) || record.at <= 0 || record.at > now + 60000
        || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.at || record.expiresAt - record.at > CW_QUERY_WINDOW
        || now >= record.expiresAt) return null;
    const {schema, phase, stage, failure, retCode, httpClass, tokenPresentBefore, tokenUpdated, sessionAttempt, tokenAttempt, page, at, expiresAt} = record;
    return {schema, phase, stage, failure, retCode, httpClass, tokenPresentBefore, tokenUpdated, sessionAttempt, tokenAttempt, page, at, expiresAt};
}

function cwQueryDiagnostic(cached, auth, now = Date.now()) {
    const checked = cwAuthState(auth, now);
    return checked && cwObject(cached) && cached.version === CW_VERSION && cached.source === "auto" && cached.blocked !== true
        && cached.owner === checked.owner && cached.inputHash === checked.inputHash && cached.generation === checked.generation
        && typeof cached.runId === "string" && /^[0-9a-f]{32}$/.test(cached.runId) ? cwQueryFields(cached.queryDiagnostic, now) : null;
}

function cwReadAuth(ctx, now = Date.now()) {
    const value = ctx.storage.getJSON(CW_AUTH_STORE);
    if (value === null || value === undefined) return null;
    const state = cwAuthState(value, now);
    if (!state) throw new Error("auth-format");
    return state;
}

function cwSameAuth(a, b) {
    return !!a && !!b && a.owner === b.owner && a.generation === b.generation && a.inputHash === b.inputHash && a.captureKind === b.captureKind;
}

function cwWriteAuth(ctx, state, now = Date.now()) {
    if (!cwAuthState(state, now) || state.version !== CW_VERSION) return false;
    ctx.storage.setJSON(CW_AUTH_STORE, state);
    if (ctx.storage.getJSON(CW_AUTH_STORE)?.version !== CW_VERSION) return false;
    const saved = cwReadAuth(ctx, now);
    return cwSameAuth(saved, state) && saved.cookie === state.cookie && saved.status === state.status
        && saved.capturedAt === state.capturedAt && saved.confirmedAt === state.confirmedAt
        && saved.sourceHost === state.sourceHost && saved.sourceChannel === state.sourceChannel && saved.accountCheckedAt === state.accountCheckedAt
        && saved.accountSessionHash === state.accountSessionHash;
}

function cwClearLocal(ctx) {
    // off 模式只清本组件键，不改系统代理、CA 或其他模块。
    const keys = [CW_AUTH_STORE, CW_STORE, CW_CAPTURE_STORE, CW_APP_STORE];
    for (const key of keys) ctx.storage.setJSON(key, null);
    if (keys.some(key => ctx.storage.getJSON(key) !== null)) throw new Error("storage-not-confirmed");
}

function cwCaptureResult(ctx, code, now) {
    if (!Object.hasOwn(CW_CAPTURE_RESULTS, code)) return;
    try {
        const previous = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(previous) && previous.version === CW_VERSION && previous.code === code && Number.isFinite(previous.at)
            && now >= previous.at && now - previous.at < 30000) return;
        ctx.storage.setJSON(CW_CAPTURE_STORE, {version: CW_VERSION, code, at: now});
    } catch {
        // 完全无法写入时仍有不含 Cookie、账号、URL 或异常原文的固定提示。
        console.log("[菜鸟连接] 本机捕获状态无法保存，请检查 Egern 存储。");
    }
}

function cwIsolateAccount(ctx, owner) {
    const barrier = {version: CW_VERSION, owner, source: "capture", blocked: true, cookie: "", snapshot: null};
    ctx.storage.setJSON(CW_STORE, barrier);
    const saved = ctx.storage.getJSON(CW_STORE);
    if (!cwObject(saved) || saved.owner !== owner || saved.blocked !== true
        || saved.source !== "capture" || saved.snapshot !== null || saved.cookie !== "") throw new Error("cache-not-isolated");
}

function captureCainiaoCredentials(ctx, clock = () => Date.now()) {
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request || ctx.response) return;
    const route = cwAppRoute(ctx.request.url, ctx.request.headers);
    if (!route) return;
    const now = clock();
    if (!Number.isSafeInteger(now) || now <= 0) return;
    let observedCookies, native;
    try {
        if (cwHeaderValues(ctx.request.headers, CW_SELF_HEADER).length) return;
        observedCookies = cwCapturedCookies(ctx.request.headers);
        native = cwAppNativeFields(ctx.request.headers);
    } catch { cwCaptureResult(ctx, "invalid", now); return; }
    const observe = () => {
        try { cwObserveApp(ctx, route, observedCookies, native, now); }
        catch { console.log("[菜鸟连接] App 请求状态无法保存，未记录敏感内容。"); }
    };
    if (observedCookies.get("unb") && native.uid && observedCookies.get("unb") !== native.uid) {
        try { cwIsolateAccount(ctx, md5("capture-conflicting-identities")); }
        catch { cwCaptureResult(ctx, "storage", now); return; }
        observe(); cwCaptureResult(ctx, "conflict", now); return;
    }
    const fromCookie = cwLoginCandidate(observedCookies);
    const hasSessionCookie = observedCookies.has("cookie2") || observedCookies.has("sgcookie");
    const candidateRoute = route.channel === "gw" && route.apiKind !== "public_time";
    const fromCookieCandidate = !fromCookie && !observedCookies.has("unb") && hasSessionCookie && candidateRoute && native.uid;
    const fromNative = !fromCookie && !hasSessionCookie && candidateRoute && native.uid && native.sid;
    if (!fromCookie && !fromCookieCandidate && !fromNative) { observe(); cwCaptureResult(ctx, "anonymous", now); return; }
    const captureKind = fromCookie ? "request_cookie" : fromCookieCandidate ? "request_cookie_candidate" : "native_session_candidate";
    // 真实会话只补同次 UID，不以 SID 替换 cookie2，也不借其它请求或旧缓存。
    const cookies = fromCookie ? observedCookies : fromCookieCandidate ? new Map([...observedCookies, ["unb", native.uid]])
        : new Map([["unb", native.uid], ["cookie2", native.sid]]);
    const owner = cwOwner(cookies), cookie = cwCookieHeader(cookies), inputHash = md5(cookie), sessionHash = cwSessionHash(cookies);
    let previous, cached, cachedTerminal = "";
    try {
        const raw = ctx.storage.getJSON(CW_AUTH_STORE);
        // 有效新请求可修复损坏的 JSON；读取 API 抛错则停止，不猜旧状态。
        previous = cwAuthState(raw, now);
        cached = ctx.storage.getJSON(CW_STORE);
        cachedTerminal = cwCachedAuthStatus(cached, previous);
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    const active = previous && !cachedTerminal && ["pending", "connected"].includes(previous.status);
    const sameSession = active && previous.sessionHash === sessionHash && previous.captureKind === captureKind;
    if (previous && previous.owner === owner && (fromNative && ["request_cookie", "request_cookie_candidate"].includes(previous.captureKind)
        || active && (fromNative && previous.status === "connected" || !fromCookie && previous.captureKind === "request_cookie"))) {
        observe(); cwCaptureResult(ctx, "unchanged", now); return;
    }
    // 弱流量已在上方拒绝，不能用它改回另一个账号保存失败时留下的屏障。
    try {
        if (previous && previous.owner !== owner || cwObject(cached) && cached.owner !== owner) cwIsolateAccount(ctx, owner);
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    if (sameSession && previous.inputHash === inputHash && previous.captureKind === captureKind) {
        observe(); cwCaptureResult(ctx, "unchanged", now); return;
    }
    if (!fromCookie && !sameSession) {
        // 新受限候选即便账号相同也须隔离旧 token 与旧码；同类型 token 更新保留代次。
        try { cwIsolateAccount(ctx, owner); }
        catch { cwCaptureResult(ctx, "storage", now); return; }
    }
    const state = {version: CW_VERSION, owner, sessionHash, inputHash, cookie,
        generation: sameSession ? previous.generation : md5(now + ":" + Math.random() + ":" + Math.random()),
        status: sameSession ? previous.status : "pending", capturedAt: now,
        confirmedAt: sameSession ? previous.confirmedAt : null, sourceHost: route.host, sourceChannel: route.channel,
        captureKind, accountCheckedAt: cwRequiresIdentity({captureKind}) && sameSession ? previous.accountCheckedAt : null,
        accountSessionHash: cwRequiresIdentity({captureKind}) && sameSession ? previous.accountSessionHash : ""};
    try {
        if (!cwWriteAuth(ctx, state, now)) {
            const latest = cwReadAuth(ctx, now);
            cwCaptureResult(ctx, latest && latest.capturedAt >= now && !cwSameAuth(latest, previous) ? "superseded" : "storage", now);
            return;
        }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    observe();
    cwCaptureResult(ctx, "saved", now);
}

function diagnoseCainiaoConnection(ctx, clock = () => Date.now()) {
    const now = clock(), lines = ["菜鸟 App 连接状态 " + CW_VERSION, "连接模式：" + cwConnectionMode(ctx.env)];
    const labels = {pending: "已捕获，尚未通过个人列表验证", connected: "个人列表查询已确认", expired: "小组件会话失效，请重开 App 快递列表",
        verify: "需在淘宝或菜鸟 App 完成验证", invalid: "身份失效，请重开 App 快递列表", unsupported: "App 接入未确认，尚未通过完整个人查询"};
    try {
        const auth = cwReadAuth(ctx, now);
        const cached = ctx.storage.getJSON(CW_STORE);
        const blocked = cwObject(cached) && cached.blocked === true && (!auth || cached.owner !== auth.owner);
        const cachedStatus = cwCachedAuthStatus(cached, auth), recordedStatus = cachedStatus || auth?.status;
        const firstFailure = cwRequiresIdentity(auth) && auth.confirmedAt === null && recordedStatus === "expired";
        const status = firstFailure ? "unsupported" : recordedStatus;
        const label = status === "unsupported" && auth?.confirmedAt !== null ? "本次独立查询未确认，已停止重试" : labels[status];
        lines.push("自动登录态：" + (blocked ? "新账号尚未保存，旧登录态已阻断" : (auth ? label : "尚未捕获")));
        if (cachedStatus && auth.status !== cachedStatus) lines.push("登录标志写入未确认；缓存已记录停止状态，新的 App 采集才会重试。");
        if (auth && !blocked) {
            const source = auth.captureKind === "native_session_candidate" ? "App native 候选，兼容性须由个人查询确认"
                : auth.captureKind === "request_cookie_candidate" ? "同次 App 实际 Cookie＋native UID，须验证个人身份" : "App 请求 Cookie";
            lines.push("会话来源：" + source);
            lines.push("保存的 Cookie 字段名：" + [...cwCookieMap(auth.cookie).keys()].join("、"));
            lines.push("捕获时间：" + new Date(auth.capturedAt).toISOString());
            if (auth.accountCheckedAt) lines.push("账号检查时间：" + new Date(auth.accountCheckedAt).toISOString());
            const diagnostic = cwQueryDiagnostic(cached, auth, now);
            if (diagnostic) {
                lines.push("个人查询：" + diagnostic.phase + " · " + diagnostic.stage + " · " + diagnostic.failure);
                lines.push("返回分类：" + diagnostic.retCode + " · " + diagnostic.httpClass);
                lines.push("token：请求前" + (diagnostic.tokenPresentBefore ? "存在" : "缺失") + "，本次" + (diagnostic.tokenUpdated ? "已更新" : "未更新"));
                lines.push("验证轮次：" + diagnostic.sessionAttempt + "；token 轮次：" + diagnostic.tokenAttempt
                    + (diagnostic.page === null ? "" : "；页码：" + diagnostic.page));
                lines.push("记录时间：" + new Date(diagnostic.at).toISOString());
            } else if (firstFailure) lines.push("旧版本未记录原因；保持停止状态，未重新请求。");
        }
        const result = ctx.storage.getJSON(CW_CAPTURE_STORE);
        if (cwObject(result) && Object.hasOwn(CW_CAPTURE_RESULTS, result.code)) lines.push("最近捕获：" + CW_CAPTURE_RESULTS[result.code]);
    } catch { lines.push("本机存储无法读取，请检查 Egern 后重新打开 App 快递列表。"); }
    try {
        const app = cwAppSummary(ctx, now);
        lines.push("App 请求：" + (app.observed ? "已观察到" : "尚未观察到目标请求"));
        if (app.observed) lines.push("以下观察字段为窗口内多请求并集，不代表同次会话；实际保存字段见上方。");
        for (const row of app.rows) {
            lines.push(row.host + " · " + row.channel + " · " + row.count + " 次");
            lines.push("字段名：" + ([...row.cookies, ...row.nativeHeaders].join("、") || "未见必要会话字段"));
        }
    } catch { lines.push("App 请求状态无法读取，未显示异常原文。"); }
    lines.push("此入口属于小组件，只读本机状态，不发送个人查询，不显示凭据。关闭 App 后的新查询仍需手机验收。");
    return {type: "widget", padding: 12, children: [{type: "text", text: lines.join("\n")}]};
}

// 来源：render.mjs
// 引擎：Egern 原生小组件 DSL | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用 renderWidget；离线 node --test cainiao-widget/tests/render.test.cjs
// 依赖：无；不依赖浏览器或第三方运行库，不伪造 App 点击链接

const CNW_COLORS = {
  background: { light: '#F4F7FE', dark: '#0C1527' },
  backgroundEnd: { light: '#EAF1FF', dark: '#13233C' },
  card: { light: '#FFFFFF', dark: '#17253D' },
  border: { light: '#DDE7F8', dark: '#2A3C58' },
  primary: { light: '#162A46', dark: '#F0F6FF' },
  secondary: { light: '#64758D', dark: '#A6B7D0' },
  accent: { light: '#2364E6', dark: '#86B2FF' },
  accentBackground: { light: '#E2EDFF', dark: '#243D65' },
  warning: { light: '#92530A', dark: '#FFD191' },
  warningBackground: { light: '#FFF0D6', dark: '#3A2C1D' },
};
const CNW_FAMILIES = {
  systemSmall: { capacity: 1, columns: 1, padding: 14, codeSize: 33 },
  systemMedium: { capacity: 2, columns: 2, padding: 14, codeSize: 25 },
  systemLarge: { capacity: 4, columns: 2, padding: 16, codeSize: 29 },
  systemExtraLarge: { capacity: 8, columns: 4, padding: 16, codeSize: 30 },
};
const CNW_STATES = {
  ready: { label: '待取包裹', title: '没有待取包裹', detail: '包裹到站后会显示在这里' },
  setup: { label: '尚未连接', title: '先打开淘宝或菜鸟', detail: '刷新 App 快递列表后回到组件' },
  expired: { label: '会话失效', title: '重开 App 快递列表', detail: '重新接入后回到 Egern 刷新' },
  offline: { label: '连接失败', title: '暂时无法连接', detail: '稍后会自动重试' },
  verify: { label: '需安全验证', title: '请先完成验证', detail: '在淘宝或菜鸟完成验证后重试' },
  partial: { label: '数据未取全', title: '暂未取得完整列表', detail: '仅显示已确认的待取件' },
  error: { label: '更新失败', title: '更新没有完成', detail: '稍后会自动重试' },
};

function cnwString(value) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : '';
}

function cnwText(text, size, color = CNW_COLORS.primary, extra = {}) {
  return {
    type: 'text', text: String(text), font: { size, weight: 'regular' },
    textColor: color, maxLines: 1, minScale: 1, ...extra,
  };
}

function cnwStack(direction, children, extra = {}) {
  return { type: 'stack', direction, alignItems: 'start', children, ...extra };
}

function cnwIcon(name, size, color = CNW_COLORS.accent) {
  return { type: 'image', src: `sf-symbol:${name}`, width: size, height: size, color };
}

function cnwTimestamp(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cnwClock(timestamp, includeDate = true) {
  if (timestamp === null) return '尚未更新';
  const date = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return includeDate ? `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}` : time;
}

function cnwContext(model, family, now) {
  const input = model && typeof model === 'object' ? model : {};
  const status = Object.hasOwn(CNW_STATES, input.status) ? input.status : 'error';
  const items = Array.isArray(input.items) ? input.items.filter((item) => item && typeof item === 'object') : [];
  const requestedTotal = Number(input.total);
  const total = Math.max(items.length, Number.isFinite(requestedTotal) ? Math.max(0, Math.floor(requestedTotal)) : 0);
  const updatedAt = cnwTimestamp(input.updatedAt);
  const requestedRefresh = Number(input.refreshMinutes);
  const refreshMinutes = Number.isFinite(requestedRefresh) && requestedRefresh > 0
    ? Math.min(360, Math.max(5, requestedRefresh)) : 15;
  const time = Number.isFinite(now) ? now : Date.now();
  const stale = status === 'ready' && updatedAt !== null && time - updatedAt > Math.max(60, refreshMinutes * 3) * 60000;
  const partial = status === 'partial' || input.partial === true;
  const warning = status !== 'ready' || partial || stale;
  const state = partial && status === 'ready' ? CNW_STATES.partial : CNW_STATES[status];
  const label = stale ? '数据较旧' : state.label;
  const lock = family.startsWith('accessory');
  const hideCode = input.privacy === true || (lock && input.privacy !== false);
  return {
    status, items, total, updatedAt, refreshMinutes, time, stale, partial, warning, state, label,
    hideCode, message: cnwString(input.message), setupTitle: cnwString(input.setupTitle).slice(0, 32),
    cached: warning && items.length > 0,
    count: `${partial ? '至少' : ''}${total}`,
    refreshAfter: new Date(time + refreshMinutes * 60000).toISOString(),
  };
}

function cnwCode(item, hideCode) {
  if (hideCode) return { text: '取件码已隐藏', usable: false, private: true };
  const code = cnwString(item.code);
  const placeholder = /^(?:needsms|need_sms|-1|0|null|none|true|false)$/i.test(code);
  if (item.requiresVerification === true || placeholder) return { text: '需短信验证', usable: false, verification: true };
  return code ? { text: code, usable: true } : { text: '暂无取件码', usable: false };
}

// 超长码显式分两行，保留所有字符，不用省略号截掉凭据。
function cnwWrapCode(code) {
  if (code.length <= 18) return code;
  const middle = Math.ceil(code.length / 2);
  const cuts = [...code.matchAll(/-/g)].map((match) => match.index + 1);
  const nearby = cuts.filter((cut) => Math.abs(cut - middle) <= 3);
  const cut = nearby.length ? nearby.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0] : middle;
  return `${code.slice(0, cut)}\n${code.slice(cut)}`;
}

function cnwCodeNode(item, context, size, compact = false) {
  const code = cnwCode(item, context.hideCode);
  const wrapped = code.usable ? cnwWrapCode(code.text) : code.text;
  const long = wrapped.includes('\n');
  const longest = Math.max(...wrapped.split('\n').map((part) => part.length));
  const fontSize = code.usable
    ? (long ? Math.max(12, Math.min(compact ? (context.warning ? 16 : 18) : 22, 320 / longest)) : size)
    : Math.min(size, compact ? 14 : 17);
  return cnwText(wrapped, fontSize, code.verification ? CNW_COLORS.warning : (code.usable ? CNW_COLORS.accent : CNW_COLORS.secondary), {
    font: { size: fontSize, weight: code.usable ? 'bold' : 'medium', ...(code.usable ? { family: 'Menlo' } : {}) },
    maxLines: long ? 2 : 1, minScale: code.usable ? 0.45 : 0.85,
  });
}

function cnwHeader(context, small, inlineNotice = false) {
  const count = context.warning && context.items.length === 0 ? '待更新' : `${context.count}${small ? '件' : '件待取'}`;
  const notice = inlineNotice && (context.warning || context.message);
  const title = notice ? (context.warning ? `${context.label}${context.cached ? ' · 旧数据' : ''}` : context.message) : '菜鸟取件';
  return cnwStack('row', [
    cnwIcon(notice ? 'exclamationmark.triangle.fill' : 'shippingbox.fill', small ? 14 : 16, notice ? CNW_COLORS.warning : CNW_COLORS.accent),
    cnwText(title, small || notice ? 11 : 13, notice ? CNW_COLORS.warning : CNW_COLORS.primary, {
      font: { size: small || notice ? 11 : 13, weight: 'semibold' }, ...(notice ? { flex: 1, minScale: 0.85 } : {}),
    }),
    ...(!notice ? [{ type: 'spacer' }] : []),
    cnwStack('row', [cnwText(count, small ? 10 : 11, CNW_COLORS.accent, {
      font: { size: small ? 10 : 11, weight: 'bold' }, minScale: 0.75,
    })], { padding: [3, 7, 3, 7], borderRadius: 8, backgroundColor: CNW_COLORS.accentBackground }),
  ], { alignItems: 'center', gap: small ? 4 : 6 });
}

function cnwBanner(context, small) {
  const cached = context.cached && context.status !== 'partial' && !context.partial;
  let detail = context.message.replace(/\s*·\s*上次结果\s*$/, '');
  if (context.status === 'expired') detail = detail.replace(/^(?:登录(?:已)?过期|小组件会话失效)[，,：:\s]*/, '');
  const text = !context.warning ? context.message
    : `${context.label}${cached ? (small ? ' · 旧数据' : ' · 历史数据') : ''}${detail && !small ? ` · ${detail}` : ''}`;
  return cnwStack('row', [
    cnwIcon('exclamationmark.triangle.fill', small ? 9 : 11, CNW_COLORS.warning),
    cnwText(text, small ? 9 : 10, CNW_COLORS.warning, { flex: 1, minScale: 0.8, font: { size: small ? 9 : 10, weight: 'semibold' } }),
  ], { alignItems: 'center', gap: 4, padding: [4, 6, 4, 6], borderRadius: 7, backgroundColor: CNW_COLORS.warningBackground });
}

function cnwItemCard(item, context, options, small) {
  const company = cnwString(item.company) || '快递';
  const tail = cnwString(item.tail);
  const station = cnwString(item.station) || '驿站待确认';
  const compact = options.capacity === 2;
  const detailSize = compact ? 9 : 10;
  const stationSize = compact ? 10 : 11;
  const details = [
    cnwCodeNode(item, context, options.codeSize, small || compact),
    cnwText(`${company}${tail ? ` · 尾号 ${tail}` : ''}`, detailSize, CNW_COLORS.secondary, { minScale: 0.85 }),
    cnwText(station, stationSize, CNW_COLORS.primary),
  ];
  const children = small ? [{ type: 'spacer' }, cnwStack('column', details, { gap: 3 }), { type: 'spacer' }]
    : [...details, { type: 'spacer' }];
  return cnwStack('column', children, {
    flex: 1, gap: small ? 0 : (compact ? 2 : 4),
    ...(small ? {} : {
      padding: compact ? [6, 9, 6, 9] : [13, 12, 13, 12],
      borderRadius: 13, backgroundColor: CNW_COLORS.card, borderWidth: 0.7, borderColor: CNW_COLORS.border,
    }),
  });
}

function cnwEmpty(context, small, tight = false) {
  const ready = context.status === 'ready' && !context.partial;
  const compact = tight || (small && context.warning);
  const title = ready ? CNW_STATES.ready.title : (context.status === 'setup' && context.setupTitle ? context.setupTitle : context.state.title);
  const detail = context.message || context.state.detail;
  return cnwStack('column', [
    { type: 'spacer' },
    cnwIcon(ready ? 'checkmark.circle' : (context.status === 'setup' ? 'lock.fill' : 'exclamationmark.triangle.fill'), compact ? 18 : (small ? 23 : 28),
      ready || context.status === 'setup' ? CNW_COLORS.accent : CNW_COLORS.warning),
    cnwText(title, compact ? 14 : (small ? 15 : 18), CNW_COLORS.primary, { font: { size: compact ? 14 : (small ? 15 : 18), weight: 'semibold' }, minScale: 0.8 }),
    cnwText(detail, compact ? 9 : (small ? 10 : 12), CNW_COLORS.secondary, { maxLines: compact ? 1 : 2, minScale: 0.85 }),
    { type: 'spacer' },
  ], { flex: 1, gap: compact ? 4 : (small ? 5 : 7) });
}

function cnwFooter(context, visible, small) {
  const prefix = context.cached ? '缓存 ' : (context.warning && context.updatedAt !== null ? '上次 ' : '更新 ');
  const timestamp = context.updatedAt === null ? '尚未更新' : `${prefix}${cnwClock(context.updatedAt)}`;
  const remaining = Math.max(0, context.total - visible);
  return cnwStack('row', [
    cnwText(timestamp, small ? 8 : 9, context.cached ? CNW_COLORS.warning : CNW_COLORS.secondary, { flex: 1, minScale: 0.8 }),
    ...(remaining ? [cnwText(`还有${remaining}件`, small ? 8 : 9, CNW_COLORS.accent, {
      font: { size: small ? 8 : 9, weight: 'semibold' }, minScale: 0.75,
    })] : []),
  ], { gap: 4, alignItems: 'center' });
}

function cnwDesktop(context, family) {
  const options = CNW_FAMILIES[family];
  const small = family === 'systemSmall';
  const shown = context.items.slice(0, options.capacity);
  let body;
  if (!shown.length) body = cnwEmpty(context, small, family === 'systemMedium');
  else if (small) body = cnwItemCard(shown[0], context, options, true);
  else {
    const rows = [];
    for (let index = 0; index < shown.length; index += options.columns) {
      const cards = shown.slice(index, index + options.columns).map((item) => cnwItemCard(item, context, options, false));
      while (cards.length < options.columns) cards.push(cnwStack('column', [], { flex: 1 }));
      rows.push(cnwStack('row', cards, { flex: 1, gap: 8, alignItems: 'start' }));
    }
    body = cnwStack('column', rows, { flex: 1, gap: 8 });
  }
  return {
    type: 'widget', refreshAfter: context.refreshAfter,
    backgroundColor: CNW_COLORS.background,
    backgroundGradient: {
      type: 'linear', colors: [CNW_COLORS.background, CNW_COLORS.backgroundEnd],
      startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 },
    },
    padding: options.padding, gap: small ? 6 : 8,
    children: [
      cnwHeader(context, small, family === 'systemMedium'),
      ...((context.warning || context.message) && family !== 'systemMedium' ? [cnwBanner(context, small)] : []),
      body,
      cnwFooter(context, shown.length, small),
    ],
  };
}

function cnwLockStatus(context) {
  return context.warning ? context.label : (context.message || '菜鸟取件');
}

function cnwLockTimestamp(context, compact = false) {
  if (context.updatedAt === null) return '尚未更新';
  return `${context.cached ? '缓存' : '更新'}${cnwClock(context.updatedAt, !compact || context.cached)}`;
}

function cnwLock(context, family) {
  const hasItems = context.items.length > 0;
  const first = hasItems ? cnwCode(context.items[0], context.hideCode) : null;
  const count = context.warning && !hasItems ? '—' : context.count;
  const status = cnwLockStatus(context);
  let children;
  if (family === 'accessoryInline') {
    const code = first ? (context.hideCode ? '码已隐藏' : first.text) : (context.status === 'ready' ? '暂无待取' : '待更新');
    children = [cnwText(`${context.warning || context.message ? status : '菜鸟'} · ${count}件 · ${code} · ${cnwLockTimestamp(context, true)}`,
      12, CNW_COLORS.primary, { minScale: 0.45, font: { size: 12, weight: 'medium', ...(first?.usable && !context.hideCode ? { family: 'Menlo' } : {}) } })];
  } else if (family === 'accessoryCircular') {
    const codeText = first ? (context.hideCode ? '码已隐藏' : (first.usable ? cnwWrapCode(first.text) : first.text))
      : (context.status === 'ready' ? '暂无待取' : '待更新');
    children = [
      cnwText(status, 8, CNW_COLORS.primary, { textAlign: 'center', minScale: 0.7, font: { size: 8, weight: 'semibold' } }),
      cnwText(context.partial && hasItems ? `≥${context.total}` : count, first && !context.hideCode ? 18 : 22, CNW_COLORS.primary, {
        textAlign: 'center', minScale: 0.65, font: { size: first && !context.hideCode ? 18 : 22, weight: 'bold' },
      }),
      cnwText(codeText,
        8, CNW_COLORS.primary, { textAlign: 'center', maxLines: codeText.includes('\n') ? 2 : 1, minScale: 0.45,
          font: { size: 8, weight: 'medium', ...(first?.usable && !context.hideCode ? { family: 'Menlo' } : {}) } }),
      cnwText(cnwLockTimestamp(context, true), 7, CNW_COLORS.secondary, { textAlign: 'center', minScale: 0.7 }),
    ];
  } else {
    children = [
      cnwStack('row', [
        cnwText('菜鸟取件', 11, CNW_COLORS.primary, { font: { size: 11, weight: 'semibold' } }),
        { type: 'spacer' },
        cnwText(`${count}件待取`, 11, CNW_COLORS.primary, { font: { size: 11, weight: 'bold' }, minScale: 0.75 }),
      ], { alignItems: 'center', gap: 4 }),
      ...(context.warning || context.message ? [cnwText(status, 9, CNW_COLORS.primary, { minScale: 0.75, font: { size: 9, weight: 'semibold' } })] : []),
      ...(first ? [cnwText(context.hideCode ? '取件码已隐藏' : first.text, context.hideCode || !first.usable ? 12 : 18, CNW_COLORS.primary, {
        font: { size: context.hideCode || !first.usable ? 12 : 18, weight: first.usable && !context.hideCode ? 'bold' : 'medium', ...(first.usable && !context.hideCode ? { family: 'Menlo' } : {}) }, minScale: 0.45,
      })] : [cnwText(context.status === 'ready' ? '没有待取包裹' : (context.setupTitle || context.state.title), 12, CNW_COLORS.primary, { minScale: 0.8 })]),
      cnwText(cnwLockTimestamp(context), 8, CNW_COLORS.secondary, { minScale: 0.75 }),
    ];
  }
  return {
    type: 'widget', refreshAfter: context.refreshAfter,
    padding: family === 'accessoryCircular' ? 1 : 0, gap: family === 'accessoryCircular' ? 0 : 3,
    children,
  };
}

/** 将规范化的展示模型转换为 Egern 官方原生 DSL。 */
function renderWidget(model, family, now = Date.now()) {
  const requested = typeof family === 'string' ? family : 'systemSmall';
  const supported = Object.hasOwn(CNW_FAMILIES, requested)
    || ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'].includes(requested);
  const resolved = supported ? requested : 'systemSmall';
  const context = cnwContext(model, resolved, now);
  return resolved.startsWith('accessory') ? cnwLock(context, resolved) : cnwDesktop(context, resolved);
}

// 来源：runtime.mjs
// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：导入模块，打开本人淘宝／菜鸟 App 快递列表，再运行组件
// 依赖：core.mjs、app.mjs、auth.mjs、render.mjs；发布文件内联，不下载其他代码

class CwFailure extends Error {
    constructor(kind, failure) {
        super(kind); this.kind = kind;
        this.failure = failure || {expired: "AUTH_REJECTED", verify: "VERIFY_REQUIRED", offline: "OFFLINE", partial: "PARTIAL",
            schema: "SCHEMA_INVALID", account: "ACCOUNT_MISMATCH", unsupported: "IDENTITY_UNVERIFIED", session: "SESSION_UNSTABLE",
            local: "STORAGE_UNCONFIRMED"}[kind] || "UNKNOWN";
    }
}

function cwHttpClass(status) {
    if (!Number.isInteger(status)) return "NONE";
    if ([200, 401, 403, 429].includes(status)) return "HTTP_" + status;
    return status >= 300 && status < 400 ? "HTTP_3XX" : status >= 500 && status < 600 ? "HTTP_5XX" : "HTTP_OTHER";
}

// 原生文档未承诺浏览器计时器；检测到支持时为 HTTP 与读体增加 Promise 等待上限。
// 无计时器时依赖 ctx.http.timeout 和脚本时限，仍在接受结果前复核预算。
async function cwBounded(task, deadline, clock) {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new CwFailure("partial", "DEADLINE");
    let timer;
    try {
        const work = Promise.resolve().then(task);
        let result;
        if (typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function") {
            const limit = new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new CwFailure("partial", "DEADLINE")), remaining); });
            result = await Promise.race([work, limit]);
        } else result = await work;
        if (clock() >= deadline) throw new CwFailure("partial", "DEADLINE");
        return result;
    } finally {
        if (timer !== undefined) globalThis.clearTimeout(timer);
    }
}

function cwSnapshot(value, now) {
    if (!cwObject(value) || !Array.isArray(value.items) || value.items.length > 1000 || !Number.isFinite(Date.parse(value.updatedAt)) || Date.parse(value.updatedAt) > now + 60000) return null;
    if (value.items.some(item => !cwObject(item) || !/^[0-9a-f]{32}$/.test(item.id) || ["code", "station", "company", "tail"].some(k => typeof item[k] !== "string") || typeof item.requiresVerification !== "boolean")) return null;
    return {items: value.items.map(({id, code, station, company, tail, requiresVerification}) => ({id, code, station, company, tail, requiresVerification})), updatedAt: value.updatedAt};
}

function cwFailureMessage(kind, cached, automatic = false) {
    const messages = {
        expired: automatic ? "小组件会话失效，请重开 App 快递列表" : "登录已过期，请更新手动登录参数",
        verify: "请在淘宝或菜鸟完成验证",
        offline: "暂时连不上，稍后再试",
        partial: "本次未查全，稍后刷新",
        schema: "接口数据有变化，暂未更新",
        account: automatic ? "App 账号未匹配，请重开快递列表连接" : "账号发生变化，请重新导入登录参数",
        unsupported: "本次独立查询未确认；失败原因见菜鸟连接状态",
        error: "查询未成功，稍后再试",
    };
    return (messages[kind] || messages.error) + (cached ? " · 上次结果" : "");
}

async function loadCainiaoModel(ctx, clock = () => Date.now()) {
    const now = clock(), env = ctx.env || {};
    const requestedInterval = Number(env.REFRESH_MINUTES || 15);
    const refreshMinutes = Number.isFinite(requestedInterval) ? Math.max(5, Math.min(120, Math.floor(requestedInterval))) : 15;
    const base = {items: [], total: 0, updatedAt: null, refreshMinutes,
        privacy: String(ctx.widgetFamily || "").startsWith("accessory") ? env.LOCKSCREEN_SHOW_CODE !== "true" : false};
    const mode = cwConnectionMode(env);
    if (mode === "invalid") return {...base, status: "setup", setupTitle: "检查连接设置", message: "连接方式无效，请恢复自动连接"};
    if (mode === "off") {
        try { cwClearLocal(ctx); }
        catch { return {...base, status: "setup", setupTitle: "连接已关闭", message: "本机登录态清除未确认，请检查 Egern"}; }
        return {...base, status: "setup", setupTitle: "连接已关闭", message: "本机登录态已清除，切回 auto 可重新连接"};
    }
    let automatic = null;
    if (mode === "auto") {
        try { automatic = cwReadAuth(ctx, now); }
        catch { return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "本机登录态无法读取，请重开 App 快递列表"}; }
    }
    let imported;
    try { imported = cwCookieMap(automatic ? automatic.cookie : env.CAINIAO_COOKIE || ""); }
    catch { return {...base, status: "setup", setupTitle: "检查手动登录参数", message: "登录参数格式有误，请重新粘贴"}; }
    if (!imported.size) {
        try {
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.blocked !== true) ctx.storage.setJSON(CW_STORE, null);
        } catch {}
        if (mode === "manual") return {...base, status: "setup", setupTitle: "填写手动登录参数", message: "手动模式尚未填写登录参数"};
        let message = "打开淘宝或菜鸟 App 的快递列表";
        try {
            const app = cwAppSummary(ctx, now);
            if (app.observed) message = app.sameRequestNativeSession ? "已看到 App 原生会话，尚无可复用登录态" : "已看到 App 请求，尚无完整登录会话";
        } catch {}
        return {...base, status: "setup", message};
    }
    const owner = cwOwner(imported), inputHash = md5(cwCookieHeader(imported));
    let old, storageOK = true;
    try { old = ctx.storage.getJSON(CW_STORE); }
    catch {
        if (mode === "auto") return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "账号隔离状态无法读取，请检查 Egern 后重试"};
        storageOK = false;
    }
    if (cwObject(old) && old.blocked === true && old.owner !== owner) return {...base, status: "setup", setupTitle: "重开 App 快递列表",
        message: "新账号登录态尚未保存，请重开 App 快递列表"};
    // 未知版本只尊重上方账号屏障，不继承其 Cookie、快照或身份证明。
    const sameAccount = cwObject(old) && cwKnownVersion(old.version) && old.owner === owner;
    const sameInput = sameAccount && old.inputHash === inputHash && (automatic
        ? old.source === "auto" && old.generation === automatic.generation : old.source !== "auto");
    if (sameInput && old.invalidated === true) return {...base, status: "error", message: cwFailureMessage("account", false, !!automatic)};
    let snapshot = sameAccount ? cwSnapshot(old.snapshot, now) : null;
    let cookies = imported;
    if (sameInput) {
        try {
            const stored = cwCookieMap(old.cookie);
            if (stored.size && (!imported.get("unb") || !stored.get("unb") || imported.get("unb") === stored.get("unb"))) cookies = stored;
        } catch {}
    }
    if (automatic) cookies = cwAuthCookies(cookies);
    let initialCacheSignature;
    try { initialCacheSignature = JSON.stringify(old ?? null); }
    catch { return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "本机缓存格式无法确认，请重新连接"}; }
    // 最多保留七天旧结果；更久的数据只保留更新时间用于说明，不再展示码。
    if (snapshot && now - Date.parse(snapshot.updatedAt) > 7 * 86400000) snapshot = null;
    let terminalStatus = null, ownsState = false, state;
    const currentAuth = () => {
        if (mode !== "auto") return null;
        let current;
        try { current = cwReadAuth(ctx, clock()); }
        catch { throw new CwFailure("local"); }
        if (automatic ? !cwSameAuth(current, automatic) : current !== null) throw new CwFailure("superseded");
        return current;
    };
    const guardCache = () => {
        let saved;
        try {
            saved = ctx.storage.getJSON(CW_STORE);
            // 初始写入失败也不能越过之后成功写入的账号屏障或另一任务。
            if (!ownsState && JSON.stringify(saved ?? null) !== initialCacheSignature) throw new CwFailure("superseded");
        } catch (error) {
            if (error instanceof CwFailure) throw error;
            if (mode === "auto") throw new CwFailure("local");
            storageOK = false; return;
        }
        if (ownsState) {
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash
                || saved.source !== state.source || saved.generation !== state.generation || saved.runId !== state.runId) throw new CwFailure("superseded");
        }
    };
    const guard = () => {
        const current = currentAuth();
        if (current && (terminalStatus ? current.status !== terminalStatus : !["pending", "connected"].includes(current.status))) throw new CwFailure("superseded");
        guardCache();
    };
    const stopped = kind => ({...base, status: "setup", setupTitle: kind === "local" ? "检查 Egern 存储" : "刷新小组件", message: kind === "local"
        ? "本机登录态无法读取，请检查 Egern 后重开 App 快递列表" : "登录态已更新，请刷新小组件"});
    const restricted = cwRequiresIdentity(automatic);
    const initialCandidate = restricted && automatic.confirmedAt === null;
    const cachedTerminal = cwCachedAuthStatus(old, automatic), recordedStatus = cachedTerminal || automatic?.status;
    // 迁移旧首次失败时只纠正显示；保留原终止状态，不发请求或补造原因。
    const authStatus = initialCandidate && recordedStatus === "expired" ? "unsupported" : recordedStatus;
    if (automatic && !["pending", "connected"].includes(authStatus)) {
        try { currentAuth(); guardCache(); } catch (error) { return stopped(error.kind); }
        const storageMessage = cachedTerminal && recordedStatus !== automatic.status ? " · 登录标志写入未确认，已停止重试" : "";
        if (authStatus === "invalid") return {...base, status: "setup", message: cwFailureMessage("account", false, true) + storageMessage};
        if (authStatus === "unsupported" && initialCandidate) return {...base, status: "setup", setupTitle: "App 接入未确认", message: cwFailureMessage("unsupported", false, true) + storageMessage};
        return {...base, ...(snapshot || {}), total: snapshot?.items.length || 0, status: authStatus === "unsupported" ? "error" : authStatus,
            message: cwFailureMessage(authStatus, !!snapshot, true) + storageMessage};
    }
    const validAccountProof = restricted && sameInput && automatic.status === "connected" && old.accountCheckedAt === automatic.accountCheckedAt
        && old.accountSessionHash === automatic.accountSessionHash && old.accountSessionHash === cwSessionHash(cookies);
    let accountCheckedAt = validAccountProof ? automatic.accountCheckedAt : null;
    state = {version: CW_VERSION, owner, inputHash, source: automatic ? "auto" : "manual",
        generation: automatic?.generation || "", runId: md5(now + ":" + Math.random() + ":" + Math.random()), cookie: cwCookieHeader(cookies), snapshot,
        observedUnb: imported.get("unb") || cookies.get("unb") || (sameInput && typeof old.observedUnb === "string" ? old.observedUnb : ""),
        accountSessionHash: validAccountProof ? cwSessionHash(cookies) : "", accountCheckedAt, terminalStatus: "", queryDiagnostic: null};
    let queryPhase = automatic && automatic.confirmedAt === null ? "initial" : restricted && !validAccountProof ? "revalidate" : "refresh";
    const persist = () => {
        guard();
        state.cookie = cwCookieHeader(cookies);
        try {
            ctx.storage.setJSON(CW_STORE, state);
            const saved = ctx.storage.getJSON(CW_STORE);
            if (!cwObject(saved) || saved.owner !== owner || saved.inputHash !== inputHash || saved.source !== state.source
                || saved.generation !== state.generation || saved.runId !== state.runId || saved.cookie !== state.cookie || saved.invalidated !== state.invalidated
                || saved.accountSessionHash !== state.accountSessionHash || saved.accountCheckedAt !== state.accountCheckedAt || saved.terminalStatus !== state.terminalStatus
                || JSON.stringify(saved.queryDiagnostic ?? null) !== JSON.stringify(state.queryDiagnostic)
                || JSON.stringify(cwSnapshot(saved.snapshot, clock())) !== JSON.stringify(state.snapshot)) storageOK = false;
            else ownsState = true;
        } catch { storageOK = false; }
        guard();
    };
    const clearAccountProof = () => {
        accountCheckedAt = null; state.accountSessionHash = ""; state.accountCheckedAt = null;
        if (restricted) queryPhase = "revalidate";
    };
    const markAuth = status => {
        if (!automatic) return;
        guard();
        const current = currentAuth();
        if (restricted && status === "connected" && accountCheckedAt === null) throw new CwFailure("unsupported");
        const updated = {...current, status, confirmedAt: status === "connected" ? clock() : current.confirmedAt,
            accountCheckedAt: restricted && status === "connected" ? accountCheckedAt : current.accountCheckedAt,
            accountSessionHash: restricted && status === "connected" ? cwSessionHash(cookies) : current.accountSessionHash};
        if (!["pending", "connected"].includes(status)) state.terminalStatus = status;
        try {
            if (cwWriteAuth(ctx, updated, clock())) {
                if (!["pending", "connected"].includes(status)) terminalStatus = status;
            } else storageOK = false;
        } catch { storageOK = false; }
        guard();
    };
    const deadline = now + 18000;
    let requestTime = now - 1, sessionAttempt = 1;
    const updateQuery = fields => {
        const at = clock();
        state.queryDiagnostic = cwQueryFields({...state.queryDiagnostic, ...fields, at, expiresAt: at + 7 * 86400000}, at);
    };
    const getMtop = async (requestURL, requestPath, read, stage, page = null) => {
        for (let attempt = 0; attempt < 3; attempt++) {
            guard();
            const beforeToken = cookies.get("_m_h5_tk") || "";
            updateQuery({schema: 1, phase: queryPhase, stage, failure: "NONE", retCode: "NONE", httpClass: "NONE",
                tokenPresentBefore: !!beforeToken, tokenUpdated: false, sessionAttempt, tokenAttempt: attempt + 1, page});
            if (automatic && !cwLoginCandidate(cookies)) { clearAccountProof(); throw new CwFailure("expired", "SESSION_MISSING"); }
            const remaining = deadline - clock();
            if (remaining < 1200) throw new CwFailure("partial", "DEADLINE");
            let response;
            const beforeSession = restricted ? cwSessionHash(cookies) : "";
            try {
                response = await cwBounded(() => {
                    guard();
                    requestTime = Math.max(Math.floor(clock()), requestTime + 1);
                    return ctx.http.get(requestURL(cookies, requestTime), {
                        headers: {Cookie: cwCookieHeader(cookies), "User-Agent": CW_UA, Referer: "https://h5.m.taobao.com/", Accept: "application/json", [CW_SELF_HEADER]: "1"},
                        timeout: Math.max(1, Math.min(7000, remaining - 500)), redirect: "manual", credentials: "omit", insecureTls: false,
                    });
                }, deadline, clock);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("offline"); }
            guard();
            try { cwUpdateCookies(cookies, response.headers, clock(), requestPath); } catch {}
            if (automatic) cookies = cwAuthCookies(cookies);
            updateQuery({httpClass: cwHttpClass(response.status), tokenUpdated: (cookies.get("_m_h5_tk") || "") !== beforeToken});
            const nextUnb = cookies.get("unb") || "";
            if (state.observedUnb && state.observedUnb !== nextUnb) {
                state.snapshot = null; snapshot = null;
                state.invalidated = true;
                // 旧会话失效后等待新的手机捕获或手动导入，不回显旧码。
                cookies = new Map();
                clearAccountProof();
                throw new CwFailure("account");
            }
            if (nextUnb) state.observedUnb = nextUnb;
            if (automatic && !cwLoginCandidate(cookies)) {
                clearAccountProof(); persist(); throw new CwFailure("expired", "SESSION_MISSING");
            }
            if (restricted && cwSessionHash(cookies) !== beforeSession) {
                // 稳定会话变化时丢弃这次证明／列表；新会话重新验证，不沿用旧 UID 成功响应。
                clearAccountProof(); persist(); throw new CwFailure("session");
            }
            // 失败响应也可能下发新 token，须先持久化再分类。
            persist();
            if ([301, 302, 303, 307, 308, 403, 429].includes(response.status)) throw new CwFailure("verify");
            if (response.status === 401) throw new CwFailure("expired");
            if (response.status >= 500) throw new CwFailure("offline");
            if (response.status !== 200) throw new CwFailure("error");
            let body;
            try {
                const raw = await cwBounded(() => response.text(), deadline, clock);
                guard();
                if (raw.length > 3 * 1024 * 1024) throw new CwFailure("schema");
                if (/^\s*</.test(raw)) throw new CwFailure("verify");
                body = JSON.parse(raw);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("schema"); }
            const kind = cwReturnKind(body);
            updateQuery({retCode: cwQueryRetCode(body)});
            if (kind === "success") {
                try { return read(body); }
                catch (error) { throw error instanceof CwFailure ? error : new CwFailure(restricted ? "unsupported" : "schema", "SCHEMA_INVALID"); }
            }
            if (kind === "token") {
                const nextToken = cookies.get("_m_h5_tk") || "";
                if (attempt < 2 && nextToken && nextToken !== beforeToken) continue;
                const failure = state.queryDiagnostic?.retCode === "FAIL_SYS_ILLEGAL_ACCESS" ? "ILLEGAL_ACCESS"
                    : !beforeToken && !nextToken ? "TOKEN_NOT_ISSUED" : "TOKEN_RETRY_EXHAUSTED";
                throw new CwFailure("expired", failure);
            }
            throw new CwFailure(kind);
        }
        throw new CwFailure("error");
    };
    const getPage = page => getMtop((current, tick) => cwRequestURL(current, page, tick), CW_PATH, body => {
        if (restricted && !cwResponseAPI(body, CW_API)) throw new CwFailure("unsupported", "API_MISMATCH");
        return cwReadPage(body, page);
    }, "pds", page);
    let collected = [], partialItems = [];
    const pageSignatures = new Set();
    try {
        // 新账号先覆盖旧状态，失败也不能回显另一账号的包裹。
        persist();
        for (sessionAttempt = 1; sessionAttempt <= 3; sessionAttempt++) {
            try {
                collected = []; partialItems = []; pageSignatures.clear();
                if (restricted && (automatic.status === "pending" || accountCheckedAt === null)) {
                    await getMtop(cwIdentityRequestURL, CW_IDENTITY_PATH, body => {
                        if (!cwResponseAPI(body, CW_IDENTITY_API)) throw new CwFailure("unsupported", "API_MISMATCH");
                        const match = cwIdentityMatch(body, imported.get("unb"));
                        if (match === "unverified") throw new CwFailure("unsupported");
                        if (match === "mismatch") {
                            state.snapshot = null; snapshot = null; state.invalidated = true; cookies = new Map();
                            clearAccountProof(); throw new CwFailure("account");
                        }
                    }, "identity");
                    await getMtop(cwAccountRequestURL, CW_COUNT_PATH, body => {
                        if (!cwResponseAPI(body, CW_COUNT_API)) throw new CwFailure("unsupported", "API_MISMATCH");
                        if (!cwObject(body.data)) throw new CwFailure("unsupported", "SCHEMA_INVALID");
                    }, "count");
                    // 此证明只在完整 PDS 成功后写入；COUNT 单独成功不是连接成功。
                    accountCheckedAt = clock();
                }
                for (let page = 1; page <= 20; page++) {
                    const result = await getPage(page);
                    // 相同分页响应不能造成“已经取全”的假象。
                    const signature = md5(JSON.stringify(result.packages));
                    if (result.packages.length && pageSignatures.has(signature)) throw new CwFailure("partial");
                    pageSignatures.add(signature);
                    collected = collected.concat(result.packages);
                    try { partialItems = cwItems(collected); } catch { throw new CwFailure("schema"); }
                    if (result.complete) {
                        if (clock() >= deadline) throw new CwFailure("partial", "DEADLINE");
                        if (restricted && accountCheckedAt === null) throw new CwFailure("unsupported");
                        snapshot = {items: partialItems, updatedAt: new Date(clock()).toISOString()};
                        state.snapshot = snapshot;
                        state.accountSessionHash = restricted ? cwSessionHash(cookies) : "";
                        state.accountCheckedAt = restricted ? accountCheckedAt : null;
                        updateQuery({failure: "NONE"});
                        persist();
                        markAuth("connected");
                        guard();
                        return {...base, ...snapshot, total: snapshot.items.length, status: "ready", message: storageOK ? "" : "本机缓存写入失败，刷新时将重新查询"};
                    }
                }
                throw new CwFailure("partial");
            } catch (error) {
                if (error instanceof CwFailure && error.kind === "session") {
                    if (sessionAttempt < 3) continue;
                    throw new CwFailure("expired", "SESSION_UNSTABLE");
                }
                throw error;
            }
        }
        throw new CwFailure("partial");
    } catch (error) {
        const originalKind = error instanceof CwFailure ? error.kind : "error";
        const kind = initialCandidate && originalKind === "expired" ? "unsupported" : originalKind;
        if (["superseded", "local"].includes(kind)) return stopped(kind);
        try {
            if (state.queryDiagnostic) updateQuery({failure: error instanceof CwFailure ? error.failure : "UNKNOWN"});
            if (["expired", "verify", "account", "unsupported"].includes(kind)) markAuth(kind === "account" ? "invalid" : kind);
            persist();
            guard();
        } catch (failure) { return stopped(failure.kind); }
        const failureMessage = cached => cwFailureMessage(kind, cached, !!automatic) + (storageOK ? "" : " · 本机状态写入失败");
        if (kind === "unsupported" && initialCandidate) return {...base, status: "setup", setupTitle: "App 接入未确认", message: failureMessage(false)};
        if (snapshot) return {...base, ...snapshot, total: snapshot.items.length,
            status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: failureMessage(true)};
        // 无历史快照时可展示已成功查到的部分，但不能缓存为完整结果或声称完整数量。
        if (partialItems.length && !["account", "expired", "verify"].includes(kind)) return {...base, items: partialItems, total: partialItems.length,
            updatedAt: new Date(clock()).toISOString(), partial: true, status: "partial", message: "只查到部分包裹，数量未取全" + (storageOK ? "" : " · 本机状态写入失败")};
        return {...base, status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: failureMessage(false)};
    }
}

export default async function(ctx) {
    // 没有配置 response hook；误调用时也不消费正文或将其当作新的 App 捕获。
    if (ctx.response) return;
    if (ctx.request) {
        try { captureCainiaoCredentials(ctx); }
        catch { console.log("[菜鸟连接] 捕获未完成，原请求继续透传。"); }
        return;
    }
    if (ctx.env?.CAINIAO_DIAGNOSTIC === "true") return diagnoseCainiaoConnection(ctx);
    const model = await loadCainiaoModel(ctx);
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
