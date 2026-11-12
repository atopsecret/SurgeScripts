// Egern 原生菜鸟取件小组件 1.4.0 · 自动构建，请编辑本目录源文件。
// 构建：node cainiao-widget/build.mjs；来源与许可见 THIRD_PARTY_NOTICES.md。
// 来源：core.mjs
// 引擎：Egern JavaScript | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用；离线验证 node --test cainiao-widget/tests/core.test.cjs
// 依赖：无；协议来源见 THIRD_PARTY_NOTICES.md

const CW_VERSION = "1.4.0";
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
const CW_RESPONSE_STORE = "cainiao-widget.response.v1";
const CW_TRANSPORT_STORE = "cainiao-widget.transport.v1";
const CW_OFFICIAL_STORE = "cainiao-widget.official.v1";
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
    return ["1.1.0", "1.2.0", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(value);
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
    // 官方 MTOP 2.7.4 在 Cookie 缺失时拼接 undefined，不使用空串或补造 token。
    const rawToken = cookies.get("_m_h5_tk");
    const token = rawToken ? rawToken.split("_")[0] : undefined;
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
// 引擎：Egern 原生请求头 API | 版本：1.3.0 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由同一小组件的请求入口调用；离线 node --test cainiao-widget/tests/app-entry.test.cjs
// 依赖：core.mjs；不读 App 正文、不改流量、不发网络请求

const CW_APP_HOSTS = ["h5api.m.taobao.com", "acs.m.taobao.com", "cn-acs.m.cainiao.com", "e2e-mtop.cainiao.com"];
const CW_APP_ROUTE = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com|cn-acs\.m\.cainiao\.com|e2e-mtop\.cainiao\.com)(?::443)?\/(h5|gw)\/(mtop(?:\.[A-Za-z0-9_-]+)+|com\.taobao\.mtop\.mLoginUnitService\.(?:login|autoLogin|logout))(?:\/([0-9]+(?:\.[0-9]+)*|\*))?\/?(?:\?[^#\s]*)?$/i;
const CW_APP_COOKIES = ["unb", "cookie2", "sgcookie", "munb", "_m_h5_tk", "_m_h5_tk_enc", "_tb_token_"];
const CW_APP_NATIVE_HEADERS = ["x-sid", "x-uid", "x-t", "x-sign", "x-mini-wua", "x-umt", "x-sgext"];
const CW_APP_API_KINDS = ["personal_list", "personal_count", "public_time", "login", "session_refresh", "logout", "other"];
const CW_APP_WINDOW = 7 * 86400000;

function cwAppHeaderValues(headers, name) {
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
    if (!cwObject(value) || !["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(value.version) || !Array.isArray(value.rows)
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
    return !!state && ["native_session_candidate", "request_cookie_candidate", "response_cookie_candidate"].includes(state.captureKind);
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
    if (!["request_cookie", "native_session_candidate", "request_cookie_candidate", "response_cookie_candidate"].includes(captureKind)
        || captureKind === "response_cookie_candidate" && !["1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(value.version)
        || value.version === "1.2.0" && captureKind === "request_cookie_candidate" || !["h5", "gw"].includes(sourceChannel)
        || !(accountCheckedAt === null || Number.isFinite(accountCheckedAt) && accountCheckedAt > 0 && accountCheckedAt <= now + 60000)
        || typeof accountSessionHash !== "string" || accountSessionHash !== "" && !/^[0-9a-f]{32}$/.test(accountSessionHash)
        || (accountCheckedAt === null) !== (accountSessionHash === "")
        || restricted && (captureKind !== "response_cookie_candidate" && sourceChannel !== "gw" || value.status === "connected"
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
    return checked && cwObject(cached) && ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(cached.version) && cached.source === "auto" && cached.blocked !== true
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
    // 永久撤销键只增不删；先确认旧热项与当前凭据指纹归档，失败不清掉最后的隔离证据。
    preserveCainiaoOfficialRevocations(ctx);
    const keys = [CW_AUTH_STORE, CW_STORE, CW_CAPTURE_STORE, CW_APP_STORE, CW_RESPONSE_STORE, CW_TRANSPORT_STORE, CW_OFFICIAL_STORE];
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

function cwOfficialOwnsCapture(ctx) {
    // 新路径存在即独占会话写入；损坏或终止的状态也不能借旧 H5 撤回账号屏障。
    const state = ctx.storage.getJSON(CW_OFFICIAL_STORE);
    if (state !== null && state !== undefined) return true;
    const barrier = ctx.storage.getJSON(CW_STORE);
    return cwObject(barrier) && barrier.blocked === true && barrier.officialBinding === "bearer";
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
    try {
        if (cwOfficialOwnsCapture(ctx)) { observe(); cwCaptureResult(ctx, "unchanged", now); return; }
    } catch { cwCaptureResult(ctx, "storage", now); return; }
    if (observedCookies.get("unb") && native.uid && observedCookies.get("unb") !== native.uid) {
        try { cwIsolateAccount(ctx, md5("capture-conflicting-identities")); }
        catch { cwCaptureResult(ctx, "storage", now); return; }
        observe(); cwCaptureResult(ctx, "conflict", now); return;
    }
    // 公共时间不是新的接入来源；完整 Cookie 也不能替换候选或撤销另一账号屏障。
    // 明确同次身份冲突仍由上方隔离，正常非公共采集沿用原流程。
    if (["public_time", "logout"].includes(route.apiKind)) { observe(); cwCaptureResult(ctx, "anonymous", now); return; }
    const fromCookie = cwLoginCandidate(observedCookies);
    const hasSessionCookie = observedCookies.has("cookie2") || observedCookies.has("sgcookie");
    const candidateRoute = route.channel === "gw";
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
    if (previous && previous.owner === owner && (fromNative && ["request_cookie", "request_cookie_candidate", "response_cookie_candidate"].includes(previous.captureKind)
        || !fromCookie && previous.captureKind === "response_cookie_candidate"
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

// 仅消费同次实际响应的已过滤 Cookie；来源和身份仍在这里二次核对。
function captureCainiaoResponseCandidate(ctx, candidate, clock = () => Date.now()) {
    const now = clock();
    const finish = code => { cwCaptureResult(ctx, code, now); return code; };
    if (cwConnectionMode(ctx.env) !== "auto" || !ctx.request || !ctx.response
        || !Number.isSafeInteger(now) || now <= 0) return "invalid";
    const route = cwAppRoute(ctx.request.url, ctx.request.headers);
    if (!route || !cwObject(candidate) || !cwObject(candidate.route)
        || ["host", "channel", "apiKind"].some(key => candidate.route[key] !== route[key])
        || ctx.response.status !== 200 || ["public_time", "logout"].includes(route.apiKind)) return "invalid";
    try {
        if (cwOfficialOwnsCapture(ctx)) return finish("unchanged");
    } catch { return finish("storage"); }
    let cookies, requestCookies, requestUids;
    try {
        if (cwHeaderValues(ctx.request.headers, CW_SELF_HEADER).length) return "invalid";
        if (!(candidate.cookies instanceof Map) || candidate.cookies.size > CW_AUTH_NAMES.size
            || [...candidate.cookies].some(([name, value]) => !CW_AUTH_NAMES.has(name) || typeof value !== "string" || !value)) return finish("invalid");
        cookies = cwCookieMap(cwCookieHeader(candidate.cookies));
        if (!/^[1-9][0-9]{0,19}$/.test(cookies.get("unb") || "") || !cwLoginCandidate(cookies)) return finish("anonymous");
        requestCookies = cwCapturedCookies(ctx.request.headers);
        requestUids = cwHeaderValues(ctx.request.headers, "x-uid").map(value => value.trim()).filter(Boolean);
        if (requestUids.some(value => !/^[1-9][0-9]{0,19}$/.test(value))) return finish("invalid");
        if (requestCookies.get("unb") && !/^[1-9][0-9]{0,19}$/.test(requestCookies.get("unb"))) return finish("invalid");
    } catch { return finish("invalid"); }
    const identities = [cookies.get("unb"), requestCookies.get("unb"), ...requestUids].filter(Boolean);
    if (identities.some(value => value !== identities[0])) {
        try { cwIsolateAccount(ctx, md5("capture-conflicting-identities")); }
        catch { return finish("storage"); }
        return finish("conflict");
    }
    const owner = cwOwner(cookies), cookie = cwCookieHeader(cookies), inputHash = md5(cookie), sessionHash = cwSessionHash(cookies);
    let previous, cached, cachedTerminal;
    try {
        previous = cwAuthState(ctx.storage.getJSON(CW_AUTH_STORE), now);
        cached = ctx.storage.getJSON(CW_STORE);
        cachedTerminal = cwCachedAuthStatus(cached, previous);
    } catch { return finish("storage"); }
    const active = previous && !cachedTerminal && ["pending", "connected"].includes(previous.status);
    const sameResponseSession = previous && previous.captureKind === "response_cookie_candidate" && previous.sessionHash === sessionHash;
    // 新账号保存失败后，旧响应的 token 更新不是账号切换证据，不能撤销屏障。
    if (sameResponseSession && cwObject(cached) && cached.blocked === true && cached.owner !== owner) return finish("unchanged");
    // 终止记录绑定稳定响应会话；短期 token 和重复响应不能解除停止状态。
    if (sameResponseSession && (!active || previous.inputHash === inputHash)
        || previous && previous.owner === owner && previous.captureKind === "request_cookie" && active) return finish("unchanged");
    const sameSession = active && sameResponseSession;
    try {
        if (!sameSession || cwObject(cached) && cached.owner !== owner) cwIsolateAccount(ctx, owner);
    } catch { return finish("storage"); }
    const state = {version: CW_VERSION, owner, sessionHash, inputHash, cookie,
        generation: sameSession ? previous.generation : md5(now + ":" + Math.random() + ":" + Math.random()),
        status: sameSession ? previous.status : "pending", capturedAt: now,
        confirmedAt: sameSession ? previous.confirmedAt : null, sourceHost: route.host, sourceChannel: route.channel,
        captureKind: "response_cookie_candidate", accountCheckedAt: sameSession ? previous.accountCheckedAt : null,
        accountSessionHash: sameSession ? previous.accountSessionHash : ""};
    try {
        if (!cwWriteAuth(ctx, state, now)) {
            const latest = cwReadAuth(ctx, now);
            return finish(latest && latest.capturedAt >= now && !cwSameAuth(latest, previous) ? "superseded" : "storage");
        }
    } catch { return finish("storage"); }
    return finish("saved");
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
        const firstFailure = !!auth && auth.confirmedAt === null && recordedStatus === "expired";
        const status = firstFailure ? "unsupported" : recordedStatus;
        const label = status === "unsupported" && auth?.confirmedAt !== null ? "本次独立查询未确认，已停止重试" : labels[status];
        lines.push("自动登录态：" + (blocked ? "新账号尚未保存，旧登录态已阻断" : (auth ? label : "尚未捕获")));
        if (cachedStatus && auth.status !== cachedStatus) lines.push("登录标志写入未确认；缓存已记录停止状态，新的 App 采集才会重试。");
        if (auth && !blocked) {
            const source = auth.captureKind === "native_session_candidate" ? "App native 候选，兼容性须由个人查询确认"
                : auth.captureKind === "request_cookie_candidate" ? "同次 App 实际 Cookie＋native UID，须验证个人身份"
                : auth.captureKind === "response_cookie_candidate" ? "同次 App 服务端 Cookie 候选，须验证个人身份" : "App 请求 Cookie";
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
    lines.push("连接信息不显示凭据、不发送个人查询；发送对照只使用固定测试字段。关闭 App 后的新查询仍需手机验收。");
    return {type: "widget", padding: 12, children: [{type: "text", text: lines.join("\n")}]};
}

// 来源：transport.mjs
// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：原模块连接状态入口显式启用 CW_TRANSPORT_CHECK=true
// 依赖：core.mjs；只发送固定合成 Cookie，不读取个人登录存储

const CW_TRANSPORT_ECHO_URL = "https://postman-echo.com/headers";
const CW_TRANSPORT_TEST_COOKIE = "CW_TEST=123";
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
function cwTransportState(value, now = Date.now()) {
    try {
        if (!cwTransportObject(value) || !cwTransportExactKeys(value, ["schema", "version", "runId", "kind", "startedAt", "leaseUntil", "at", "expiresAt", "omit", "include"])
            || value.schema !== 1 || !["1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(value.version) || !["RUNNING", "COMPLETE"].includes(value.kind)
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
function cwTransportEcho(raw) {
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
async function runCainiaoTransportCheck(ctx, clock = () => Date.now()) {
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
function cwTransportResultLines(result, now = Date.now()) {
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
function cwTransportLines(ctx, now = Date.now()) {
    try {
        const raw = ctx.storage.getJSON(CW_TRANSPORT_STORE);
        if (raw === null || raw === undefined) return ["发送对照：尚无已确认的本机记录。"];
        const state = cwTransportState(raw, now);
        return cwTransportResultLines(state ? cwTransportPublicState(state, now) : cwTransportOutcome("STATE_UNKNOWN"), now);
    } catch { return [CW_TRANSPORT_ROOT_LABELS.STORAGE_UNKNOWN]; }
}

// 来源：response.mjs
// 引擎：Egern 原生响应 API | 版本：1.3.0 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：同模块响应入口；node --experimental-vm-modules --test cainiao-widget/tests/response.test.cjs
// 依赖：core.mjs、app.mjs、auth.mjs；不发网络请求，不保存正文或凭据到取证键

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
function cwResponseCookies(headers, route, pathname, now = Date.now()) {
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

function cwResponseSchema(raw, headers = {}) {
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
    if (!cwResponseTime(now) || !cwObject(value) || !["1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6", CW_VERSION].includes(value.version)
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

async function captureCainiaoResponse(ctx, clock = () => Date.now()) {
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

function cwResponseLines(ctx, now = Date.now()) {
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

// 来源：official.mjs
// 引擎：Egern JavaScript | 版本：1.4.0 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：同一模块捕获实际 RPC bearer 或本人签发 token，再由 generic 独立查询
// 依赖：core.mjs、app.mjs；不执行 APK、不调用原生签名、不在 hook 发送个人查询

const CW_OFFICIAL_TOKEN_API = "mtop.cainiao.guoguo.widget.token.get.cn";
const CW_OFFICIAL_QUERY_URL = "https://guoguouser.cainiao.com/com.cainiao.guoguo.guoguouser.widget.WidgetLogisticsService/1.0.0/queryWidgetDetailsV2";
const CW_OFFICIAL_ARGS_TYPE = "com.cainiao.guoguo.guoguouser.widget.domain.WidgetRequest";
const CW_OFFICIAL_BODY_LIMIT = 256 * 1024;
const CW_OFFICIAL_TICKET_WINDOW = 120000;
const CW_OFFICIAL_SNAPSHOT_WINDOW = 7 * 86400000;
const CW_OFFICIAL_TOKEN_ROUTE = /^https:\/\/(h5api\.m\.taobao\.com|acs\.m\.taobao\.com|cn-acs\.m\.cainiao\.com|e2e-mtop\.cainiao\.com)(?::443)?\/(h5|gw)\/mtop\.cainiao\.guoguo\.widget\.token\.get\.cn(?:\/(1\.0|\*))?\/?(?:\?[^#\s]*)?$/i;
const CW_OFFICIAL_QUERY_ROUTE = /^https:\/\/guoguouser\.cainiao\.com(?::443)?(\/[^?#]*)$/i;
const CW_OFFICIAL_QUERY_PATH = CW_OFFICIAL_QUERY_URL.slice("https://guoguouser.cainiao.com".length);
const CW_OFFICIAL_CONFLICT_OWNER = md5("capture-conflicting-identities");
const CW_OFFICIAL_UNBOUND_OWNER = md5("official-rpc-unbound");
const CW_OFFICIAL_RETIRED_LIMIT = 32;
// 旧指纹按键只增不删；32 项仅保留兼容/转换屏障，不再代表永久集合容量。
const CW_OFFICIAL_REVOKED_PREFIX = "cainiao-widget.official.revoked.v1.";
const CW_OFFICIAL_REVOKED_MARK = "REVOKED_V1";
const CW_OFFICIAL_INSTALL_KEYS = ["isLargeInstall", "isMediumInstall", "isSmallInstall", "isNewSmallInstall", "isLargeV2Install"];
const CW_OFFICIAL_RPC_KEYS = ["appName", "source", "channel", "brand", "installStatus", "version", "ext", "token", "timestamp", "lbs"];
const CW_OFFICIAL_TYPES = ["missing", "null", "object", "array", "string", "number", "boolean", "invalid", "unread"];
const CW_OFFICIAL_REJECT_REASONS = ["WRAPPER", "APP_NAME", "SOURCE", "CHANNEL", "BRAND", "INSTALL_STATUS", "VERSION", "EXT", "TOKEN", "TIMESTAMP", "LBS", "RPC_HEADER", "BODY"];
const CW_OFFICIAL_STATUSES = ["waiting_token", "waiting_template", "pending", "ready", "expired", "invalid", "signed_out"];
const CW_OFFICIAL_FAILURES = ["NONE", "INVALID_TOKEN", "QUERY_ERROR", "BUSINESS_FAILURE", "HTTP_REJECTED", "SCHEMA_INVALID", "OFFLINE", "DEADLINE", "STORAGE_UNCONFIRMED", "ACCOUNT_BLOCKED", "SIGNED_OUT"];
const CW_OFFICIAL_CAPTURES = ["NONE", "ticket", "issued", "template", "unchanged", "anonymous", "invalid", "token_mismatch", "conflict", "signed_out", "rpc_bearer", "rpc_unrecognized", "revocation_full"];

class CwOfficialFailure extends Error {
    constructor(code) { super(code); this.officialCode = code; }
}

function cwOfficialFail(code = "SCHEMA_INVALID") { return new CwOfficialFailure(code); }
function cwOfficialTemplateFail(reason) { const error = cwOfficialFail(); error.rejectReason = reason; return error; }
function cwOfficialTime(value) { return Number.isSafeInteger(value) && value > 0; }
function cwOfficialObservedTime(value) { return Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER; }
function cwOfficialHash(value) { return typeof value === "string" && /^[0-9a-f]{32}$/.test(value); }
function cwOfficialNonce(now) { return md5("official:" + now + ":" + Math.random() + ":" + Math.random()); }
function cwOfficialAuto(ctx) { return (ctx.env?.CONNECTION_MODE || "auto") === "auto"; }
function cwOfficialOpaque(value) { return typeof value === "string" && value.length > 0 && value.length <= 8192 && value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value); }
function cwOfficialString(value, max, empty = true) { return typeof value === "string" && value.length <= max && (empty || value.length > 0) && !/[\x00-\x1f\x7f]/.test(value); }
function cwOfficialSameKeys(value, keys) { return cwObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function cwOfficialBearerOwner(tokenHash) { return md5("official-bearer:" + tokenHash); }
function cwOfficialHashes(value) {
    return Array.isArray(value) && value.length <= CW_OFFICIAL_RETIRED_LIMIT && value.every(cwOfficialHash) && new Set(value).size === value.length;
}

function cwOfficialShapeType(value, present = true) {
    return !present ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
}

// 只保留固定路径的类型、已知键缺失和计数。未知键名、字段值、token 和原文均不进入形状。
function cwOfficialRPCShape(body, now) {
    const object = cwObject(body), argsTypes = object ? body.argsTypes : undefined, argsObjs = object ? body.argsObjs : undefined;
    const item = Array.isArray(argsObjs) && argsObjs.length === 1 && cwObject(argsObjs[0]) ? argsObjs[0] : null;
    const nested = value => {
        if (typeof value !== "string") return {value: null, type: "unread"};
        try {const parsed = cwOfficialJSON(value); return {value: parsed, type: cwOfficialShapeType(parsed)};}
        catch {return {value: null, type: "invalid"};}
    };
    const install = nested(item?.installStatus), ext = nested(item?.ext), installObject = cwObject(install.value), extObject = cwObject(ext.value);
    return {at: now, body: body === undefined ? "invalid" : cwOfficialShapeType(body),
        argsTypes: cwOfficialShapeType(argsTypes, object && Object.hasOwn(body, "argsTypes")),
        argsTypesCount: Array.isArray(argsTypes) ? argsTypes.length : null,
        argsTypeKnown: Array.isArray(argsTypes) && argsTypes.length === 1 && argsTypes[0] === CW_OFFICIAL_ARGS_TYPE,
        argsObjs: cwOfficialShapeType(argsObjs, object && Object.hasOwn(body, "argsObjs")),
        argsObjsCount: Array.isArray(argsObjs) ? argsObjs.length : null,
        rootExtraCount: object ? Object.keys(body).filter(key => !["argsTypes", "argsObjs"].includes(key)).length : 0,
        objectExtraCount: item ? Object.keys(item).filter(key => !CW_OFFICIAL_RPC_KEYS.includes(key)).length : 0,
        fieldTypes: CW_OFFICIAL_RPC_KEYS.map(key => cwOfficialShapeType(item?.[key], !!item && Object.hasOwn(item, key))),
        appNameKnown: item?.appName === "GUOGUO_APP", versionKnown: item?.version === 1 || item?.version === 2,
        installJSON: install.type,
        installMissing: installObject ? CW_OFFICIAL_INSTALL_KEYS.filter(key => !Object.hasOwn(install.value, key)) : [...CW_OFFICIAL_INSTALL_KEYS],
        installWrongTypes: installObject ? CW_OFFICIAL_INSTALL_KEYS.filter(key => Object.hasOwn(install.value, key) && typeof install.value[key] !== "boolean") : [],
        installExtraCount: installObject ? Object.keys(install.value).filter(key => !CW_OFFICIAL_INSTALL_KEYS.includes(key)).length : 0,
        extJSON: ext.type, extAPI: cwOfficialShapeType(ext.value?.apiVersion, extObject && Object.hasOwn(ext.value, "apiVersion")),
        extV3: extObject && ext.value.apiVersion === "V3", extExtraCount: extObject ? Object.keys(ext.value).filter(key => key !== "apiVersion").length : 0};
}

function cwOfficialShapeState(value, now) {
    if (value === null || value === undefined) return null;
    const hasReason = cwObject(value) && Object.hasOwn(value, "rejectReason");
    const keys = ["at", "body", "argsTypes", "argsTypesCount", "argsTypeKnown", "argsObjs", "argsObjsCount", "rootExtraCount", "objectExtraCount", "fieldTypes",
        "appNameKnown", "versionKnown", "installJSON", "installMissing", "installWrongTypes", "installExtraCount", "extJSON", "extAPI", "extV3", "extExtraCount",
        ...(hasReason ? ["rejectReason"] : [])];
    const count = number => Number.isSafeInteger(number) && number >= 0 && number <= 50000;
    const knownKeys = list => Array.isArray(list) && list.length <= CW_OFFICIAL_INSTALL_KEYS.length
        && list.every(key => CW_OFFICIAL_INSTALL_KEYS.includes(key)) && new Set(list).size === list.length;
    if (!cwOfficialSameKeys(value, keys) || hasReason && !CW_OFFICIAL_REJECT_REASONS.includes(value.rejectReason) || !cwOfficialTime(value.at) || value.at > now
        || ["body", "argsTypes", "argsObjs", "installJSON", "extJSON", "extAPI"].some(key => !CW_OFFICIAL_TYPES.includes(value[key]))
        || ["argsTypesCount", "argsObjsCount"].some(key => value[key] !== null && !count(value[key]))
        || ["rootExtraCount", "objectExtraCount", "installExtraCount", "extExtraCount"].some(key => !count(value[key]))
        || ["argsTypeKnown", "appNameKnown", "versionKnown", "extV3"].some(key => typeof value[key] !== "boolean")
        || !Array.isArray(value.fieldTypes) || value.fieldTypes.length !== CW_OFFICIAL_RPC_KEYS.length || value.fieldTypes.some(type => !CW_OFFICIAL_TYPES.includes(type))
        || !knownKeys(value.installMissing) || !knownKeys(value.installWrongTypes)) throw cwOfficialFail();
    return Object.fromEntries(keys.map(key => [key, Array.isArray(value[key]) ? [...value[key]] : value[key]]));
}

function cwOfficialRoute(url, headers) {
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
    if (encoding.some(value => value !== "identity")) throw cwOfficialTemplateFail("RPC_HEADER");
    const types = cwAppHeaderValues(headers, "content-type").map(value => value.split(";", 1)[0].trim().toLowerCase());
    if (types.some(value => !["application/json", "text/json"].includes(value))) throw cwOfficialTemplateFail("RPC_HEADER");
}

function cwOfficialParseBytes(raw, headers) {
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
    if (!cwObject(value)) throw cwOfficialTemplateFail("WRAPPER");
    const hasBrand = cwObject(value) && Object.hasOwn(value, "brand");
    const keys = ["appName", "source", "channel", ...(hasBrand ? ["brand"] : []), "installStatus", "version", "ext"];
    if (Object.keys(value).some(key => !keys.includes(key))) throw cwOfficialTemplateFail("WRAPPER");
    const checks = [["appName", "APP_NAME", value.appName === "GUOGUO_APP"], ["source", "SOURCE", cwOfficialString(value.source, 128, false)],
        ["channel", "CHANNEL", cwOfficialString(value.channel, 256)], ...(hasBrand ? [["brand", "BRAND", cwOfficialString(value.brand, 256)]] : []),
        ["installStatus", "INSTALL_STATUS", cwOfficialString(value.installStatus, 4096, false)], ["version", "VERSION", [1, 2].includes(value.version)],
        ["ext", "EXT", cwOfficialString(value.ext, 4096, false)]];
    for (const [key, reason, valid] of checks) if (!Object.hasOwn(value, key) || !valid) throw cwOfficialTemplateFail(reason);
    let install, ext;
    try {install = cwOfficialJSON(value.installStatus);} catch {throw cwOfficialTemplateFail("INSTALL_STATUS");}
    if (!cwOfficialSameKeys(install, CW_OFFICIAL_INSTALL_KEYS) || CW_OFFICIAL_INSTALL_KEYS.some(key => typeof install[key] !== "boolean")) throw cwOfficialTemplateFail("INSTALL_STATUS");
    try {ext = cwOfficialJSON(value.ext);} catch {throw cwOfficialTemplateFail("EXT");}
    if (!cwOfficialSameKeys(ext, ["apiVersion"]) || ext.apiVersion !== "V3") throw cwOfficialTemplateFail("EXT");
    return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function cwOfficialTemplate(body) {
    if (!cwOfficialSameKeys(body, ["argsTypes", "argsObjs"]) || !Array.isArray(body.argsTypes) || body.argsTypes.length !== 1
        || body.argsTypes[0] !== CW_OFFICIAL_ARGS_TYPE || !Array.isArray(body.argsObjs) || body.argsObjs.length !== 1) throw cwOfficialTemplateFail("WRAPPER");
    const object = body.argsObjs[0], keys = ["appName", "source", "channel", "brand", "installStatus", "version", "ext", "token", "timestamp"];
    if (!cwObject(object) || Object.keys(object).some(key => ![...keys, "lbs"].includes(key))) throw cwOfficialTemplateFail("WRAPPER");
    if (!Object.hasOwn(object, "token") || !cwOfficialOpaque(object.token)) throw cwOfficialTemplateFail("TOKEN");
    if (!Object.hasOwn(object, "timestamp") || !cwOfficialObservedTime(object.timestamp)) throw cwOfficialTemplateFail("TIMESTAMP");
    if (Object.hasOwn(object, "lbs") && !cwOfficialString(object.lbs, 1024)) throw cwOfficialTemplateFail("LBS");
    const fields = Object.fromEntries(keys.slice(0, 7).filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
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

function cwOfficialReadSummary(body, now) {
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

function cwOfficialState(value, now = Date.now()) {
    try {
        const legacy = value?.version === "1.3.0", binding = value?.binding === undefined ? "uid" : value.binding;
        const retiredTokenHashes = value?.retiredTokenHashes === undefined ? [] : value.retiredTokenHashes;
        if (!cwOfficialTime(now) || !cwObject(value) || ![CW_VERSION, "1.3.0", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.3.6"].includes(value.version) || !cwOfficialHash(value.owner)
            || !["uid", "bearer", "unbound"].includes(binding) || legacy && binding !== "uid" || !cwOfficialHashes(retiredTokenHashes)
            || !cwOfficialHash(value.generation) || !cwOfficialHash(value.revision) || !CW_OFFICIAL_STATUSES.includes(value.status)
            || !cwOfficialTime(value.at) || value.at > now || !CW_OFFICIAL_FAILURES.includes(value.failure) || !CW_OFFICIAL_CAPTURES.includes(value.captureResult)
            || typeof value.token !== "string" || value.token && !cwOfficialOpaque(value.token)
            || value.tokenHash !== "" && !cwOfficialHash(value.tokenHash) || value.token && value.tokenHash !== md5(value.token)
            || value.runId !== "" && !cwOfficialHash(value.runId) || value.lastIssueHash !== "" && !cwOfficialHash(value.lastIssueHash)
            || ["requestCount", "successCount"].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 999999)
            || value.successCount > value.requestCount
            || ["tokenCapturedAt", "templateCapturedAt", "lastRequestAt", "lastSuccessAt"].some(key => value[key] !== null
                && (!cwOfficialTime(value[key]) || value[key] > now + (key === "lastRequestAt" ? 60000 : 0)))) return null;
        const template = value.template === null ? null : cwOfficialTemplateFields(value.template), rpcShape = cwOfficialShapeState(value.rpcShape, now);
        if (template ? !value.token || value.templateHash !== md5(JSON.stringify(template)) || value.templateCapturedAt === null : value.templateHash !== "" || value.templateCapturedAt !== null) return null;
        if (value.token ? value.tokenCapturedAt === null : value.tokenCapturedAt !== null) return null;
        if (["pending", "ready"].includes(value.status) && (!value.token || !template)
            || value.status === "waiting_template" && (!value.token || template)
            || ["waiting_token", "invalid", "signed_out", "expired"].includes(value.status) && (value.token || template)) return null;
        if (binding === "bearer" && (!value.tokenHash || value.owner !== cwOfficialBearerOwner(value.tokenHash) || value.issueTicket !== null
            || retiredTokenHashes.includes(value.tokenHash) && !["invalid", "signed_out", "expired"].includes(value.status))) return null;
        if (binding === "unbound" && (value.owner !== CW_OFFICIAL_UNBOUND_OWNER || value.tokenHash !== "" || value.token || template || value.issueTicket !== null
            || value.status !== "waiting_token" || value.snapshot !== null || value.requestCount !== 0 || value.successCount !== 0 || retiredTokenHashes.length)) return null;
        let issueTicket = null;
        if (value.issueTicket !== null) {
            const ticket = value.issueTicket;
            if (!cwObject(ticket) || !cwOfficialHash(ticket.requestHash) || ticket.owner !== value.owner || ticket.generation !== value.generation
                || !cwOfficialTime(ticket.at) || ticket.at > now || !CW_APP_HOSTS.includes(ticket.host) || !["h5", "gw"].includes(ticket.channel)) return null;
            issueTicket = {requestHash: ticket.requestHash, owner: ticket.owner, generation: ticket.generation, at: ticket.at, host: ticket.host, channel: ticket.channel};
        }
        return {version: CW_VERSION, binding, retiredTokenHashes: [...retiredTokenHashes], rpcShape, owner: value.owner, generation: value.generation, revision: value.revision, status: value.status,
            token: value.token, tokenHash: value.tokenHash, tokenCapturedAt: value.tokenCapturedAt, template, templateHash: value.templateHash,
            templateCapturedAt: value.templateCapturedAt, issueTicket, lastIssueHash: value.lastIssueHash, runId: value.runId,
            snapshot: cwOfficialSnapshot(value.snapshot, now), requestCount: value.requestCount, successCount: value.successCount,
            lastRequestAt: value.lastRequestAt, lastSuccessAt: value.lastSuccessAt, failure: value.failure, captureResult: value.captureResult, at: value.at};
    } catch { return null; }
}

function cwOfficialInitial(owner, now, status = "waiting_token", tokenHash = "", binding = "uid", retiredTokenHashes = []) {
    return {version: CW_VERSION, binding, retiredTokenHashes: [...retiredTokenHashes], rpcShape: null, owner, generation: cwOfficialNonce(now), revision: cwOfficialNonce(now), status, token: "", tokenHash,
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
        const reference = {raw, state: cwOfficialState(raw, now), signature: cwOfficialSignature(raw), barrier, barrierSignature: cwOfficialSignature(barrier)};
        cwOfficialBearerBarrier(reference);
        reference.revokedCurrent = !!reference.state?.tokenHash && cwOfficialRevoked(ctx, reference.state.tokenHash);
        return reference;
    } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
}

function cwOfficialGuard(ctx, reference, now, clearing = false) {
    if (!clearing && !cwOfficialAuto(ctx) || !cwOfficialTime(now)) throw cwOfficialFail("SUPERSEDED");
    const current = cwOfficialAccess(ctx, now);
    if (current.signature !== reference.signature || current.barrierSignature !== reference.barrierSignature
        || current.revokedCurrent !== reference.revokedCurrent) throw cwOfficialFail("SUPERSEDED");
    return current;
}

function cwOfficialBlocked(reference, owner) {
    const bearer = cwOfficialBearerBarrier(reference);
    return reference.revokedCurrent === true || bearer?.stopped === true || reference.state?.binding === "bearer" && bearer?.retiredTokenHashes.includes(reference.state.tokenHash)
        || cwObject(reference.barrier) && reference.barrier.blocked === true && reference.barrier.owner !== owner;
}

function cwOfficialBearerBarrier(reference) {
    const barrier = reference.barrier;
    if (!cwObject(barrier) || !Object.hasOwn(barrier, "officialBinding")) return null;
    if (barrier.officialBinding !== "bearer" || barrier.blocked !== true || barrier.source !== "capture" || barrier.cookie !== "" || barrier.snapshot !== null
        || !cwOfficialHash(barrier.owner) || !cwOfficialHashes(barrier.retiredTokenHashes) || typeof barrier.stopped !== "boolean") throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return barrier;
}

function cwOfficialLegacyHandoff(reference) {
    // 只为尚无官方凭据的首次迁移识别旧 capture 屏障，不能重置已绑定、损坏或已撤销的官方状态。
    if (reference.raw !== null && reference.raw !== undefined && reference.state?.binding !== "unbound") return false;
    const barrier = reference.barrier;
    return cwOfficialSameKeys(barrier, ["version", "owner", "source", "blocked", "cookie", "snapshot"])
        && cwKnownVersion(barrier.version) && cwOfficialHash(barrier.owner) && barrier.owner !== CW_OFFICIAL_CONFLICT_OWNER
        && barrier.source === "capture" && barrier.blocked === true && barrier.cookie === "" && barrier.snapshot === null;
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
    // UID 签发路径也不能重新接纳已永久撤销的 bearer；不因 off 或新票据绕过撤销。
    if (state.token && cwOfficialRevoked(ctx, state.tokenHash)) throw cwOfficialFail("ACCOUNT_BLOCKED");
    try { ctx.storage.setJSON(CW_OFFICIAL_STORE, state); } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
    const saved = cwOfficialAccess(ctx, now);
    if (saved.barrierSignature !== reference.barrierSignature) throw cwOfficialFail("SUPERSEDED");
    if (!saved.state || JSON.stringify(saved.state) !== JSON.stringify(state)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return saved;
}

function cwOfficialIsolate(ctx, reference, owner, now, bearer = null) {
    cwOfficialGuard(ctx, reference, now);
    const barrier = {version: CW_VERSION, owner, source: "capture", blocked: true, cookie: "", snapshot: null,
        ...(bearer ? {officialBinding: "bearer", retiredTokenHashes: [...bearer.retiredTokenHashes], stopped: bearer.stopped === true} : {})};
    try { ctx.storage.setJSON(CW_STORE, barrier); } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
    const saved = cwOfficialAccess(ctx, now);
    if (saved.signature !== reference.signature) throw cwOfficialFail("SUPERSEDED");
    if (!cwObject(saved.barrier) || saved.barrier.owner !== owner || saved.barrier.blocked !== true || saved.barrier.source !== "capture"
        || saved.barrier.cookie !== "" || saved.barrier.snapshot !== null) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    if (bearer && JSON.stringify(cwOfficialBearerBarrier(saved)) !== JSON.stringify(barrier)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    return saved;
}

function cwOfficialRetired(reference) {
    return [...new Set([...(reference.state?.retiredTokenHashes || []), ...(cwOfficialBearerBarrier(reference)?.retiredTokenHashes || [])])];
}

function cwOfficialRevoked(ctx, hash) {
    if (!cwOfficialHash(hash)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    try {
        const value = ctx.storage.getJSON(CW_OFFICIAL_REVOKED_PREFIX + hash);
        if (value === null || value === undefined) return false;
        if (value !== CW_OFFICIAL_REVOKED_MARK) throw cwOfficialFail("STORAGE_UNCONFIRMED");
        return true;
    } catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
}

function cwOfficialArchiveRetired(ctx, reference, hashes, now, clearing = false) {
    for (const hash of new Set(hashes)) {
        cwOfficialGuard(ctx, reference, now, clearing);
        if (!cwOfficialRevoked(ctx, hash)) {
            try { ctx.storage.setJSON(CW_OFFICIAL_REVOKED_PREFIX + hash, CW_OFFICIAL_REVOKED_MARK); }
            catch { throw cwOfficialFail("STORAGE_UNCONFIRMED"); }
            if (!cwOfficialRevoked(ctx, hash)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
        }
        const saved = cwOfficialAccess(ctx, now);
        if (saved.signature !== reference.signature || saved.barrierSignature !== reference.barrierSignature
            || saved.revokedCurrent !== reference.revokedCurrent && hash !== reference.state?.tokenHash) throw cwOfficialFail("SUPERSEDED");
        reference = saved;
    }
    return reference;
}

function cwOfficialCapacityRecovery(reference) {
    const state = reference.state, fence = cwOfficialBearerBarrier(reference);
    return state?.binding === "bearer" && state.status === "invalid" && state.failure === "ACCOUNT_BLOCKED" && state.captureResult === "revocation_full"
        && state.token === "" && state.template === null && state.issueTicket === null && reference.raw.snapshot === null
        && state.lastIssueHash === "" && state.runId === ""
        && state.requestCount === 0 && state.successCount === 0 && state.lastRequestAt === null && state.lastSuccessAt === null
        && fence?.stopped === true && fence.owner === state.owner && cwKnownVersion(fence.version)
        && cwOfficialSameKeys(fence, ["version", "owner", "source", "blocked", "cookie", "snapshot", "officialBinding", "retiredTokenHashes", "stopped"])
        && state.retiredTokenHashes.length === CW_OFFICIAL_RETIRED_LIMIT && fence.retiredTokenHashes.length === CW_OFFICIAL_RETIRED_LIMIT
        && state.retiredTokenHashes.includes(state.tokenHash) && state.retiredTokenHashes.every(hash => fence.retiredTokenHashes.includes(hash));
}

function preserveCainiaoOfficialRevocations(ctx, now = Date.now()) {
    if (!cwOfficialTime(now)) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    const reference = cwOfficialAccess(ctx, now);
    if (reference.raw !== null && reference.raw !== undefined && !reference.state) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    const hashes = cwOfficialRetired(reference);
    if (reference.state?.tokenHash) hashes.push(reference.state.tokenHash);
    cwOfficialArchiveRetired(ctx, reference, hashes, now, true);
}

function cwOfficialStopBearer(ctx, reference, now, failure, captureResult, status, full = false) {
    const state = reference.state;
    if (!state || state.binding !== "bearer") return reference;
    const legacy = cwOfficialRetired(reference);
    if (legacy.length > CW_OFFICIAL_RETIRED_LIMIT) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    // 同 owner 的终止也先保存阻断，再归档；归档失败不能继续使用旧 ready。
    // 完整旧集合仍在尚未改写的 state；单当前指纹使新终止失败不同于旧容量停止。
    reference = cwOfficialIsolate(ctx, reference, state.owner, now, {retiredTokenHashes: [state.tokenHash], stopped: true});
    reference = cwOfficialArchiveRetired(ctx, reference, [...legacy, state.tokenHash], now);
    const retired = [state.tokenHash];
    reference = cwOfficialIsolate(ctx, reference, state.owner, now, {retiredTokenHashes: retired, stopped: full});
    return cwOfficialWrite(ctx, reference, {...cwOfficialInitial(state.owner, now, status, state.tokenHash, "bearer", retired),
        failure, captureResult, rpcShape: state.rpcShape}, now);
}

function cwOfficialRecordRPC(ctx, reference, now, shape) {
    if (reference.raw !== null && reference.raw !== undefined && !reference.state) return reference;
    if (reference.state && reference.state.binding !== "unbound") return reference;
    if (cwObject(reference.barrier) && reference.barrier.blocked === true && !cwOfficialLegacyHandoff(reference)) return reference;
    const state = {...cwOfficialInitial(CW_OFFICIAL_UNBOUND_OWNER, now, "waiting_token", "", "unbound"),
        rpcShape: shape, captureResult: "rpc_unrecognized", failure: "SCHEMA_INVALID"};
    return cwOfficialWrite(ctx, reference, state, now);
}

function cwOfficialCaptureBearer(ctx, reference, parsed, now, shape) {
    const state = reference.state, fence = cwOfficialBearerBarrier(reference), tokenHash = md5(parsed.token), owner = cwOfficialBearerOwner(tokenHash);
    // 已有官方 UID 与未知账号屏障不由 RPC 撤销；严格识别的旧 H5 屏障只允许全新 bearer 接管。
    if (reference.raw !== null && reference.raw !== undefined && !state || state?.binding === "uid"
        || cwObject(reference.barrier) && reference.barrier.blocked === true && !fence && !cwOfficialLegacyHandoff(reference)) return reference;
    const retired = cwOfficialRetired(reference);
    if (retired.length > CW_OFFICIAL_RETIRED_LIMIT) throw cwOfficialFail("STORAGE_UNCONFIRMED");
    if (fence?.stopped && !cwOfficialCapacityRecovery(reference) || retired.includes(tokenHash) || cwOfficialRevoked(ctx, tokenHash)) return reference;
    // B 已经留下屏障而状态仍是 A，只有 B 本身可完成保存，旧 A 或第三个候选不能撤回 B。
    if (fence && fence.owner !== state?.owner && fence.owner !== owner) return reference;
    if (state?.binding === "bearer" && state.tokenHash === tokenHash) {
        if (["expired", "invalid", "signed_out"].includes(state.status) || cwOfficialBlocked(reference, owner)) return reference;
        const templateHash = md5(JSON.stringify(parsed.template));
        if (state.templateHash === templateHash && ["pending", "ready"].includes(state.status)) return reference;
        return cwOfficialWrite(ctx, reference, {...state, template: parsed.template, templateHash, templateCapturedAt: now,
            status: "pending", revision: cwOfficialNonce(now), runId: "", failure: "NONE", captureResult: "template", rpcShape: shape, at: now}, now);
    }
    // 先保留完整旧热集合的新候选屏障，归档失败仍只允许该候选重试，不允许 A 或 C 撤回屏障。
    reference = cwOfficialIsolate(ctx, reference, owner, now, {retiredTokenHashes: retired, stopped: false});
    const previous = state?.binding === "bearer" && state.tokenHash ? [state.tokenHash] : [];
    reference = cwOfficialArchiveRetired(ctx, reference, [...retired, ...previous], now);
    // 所有旧项均确认永久归档后才替代热列表；不是丢弃撤销记录。
    reference = cwOfficialIsolate(ctx, reference, owner, now, {retiredTokenHashes: previous, stopped: false});
    return cwOfficialWrite(ctx, reference, {...cwOfficialInitial(owner, now, "pending", tokenHash, "bearer", previous),
        token: parsed.token, tokenCapturedAt: now, template: parsed.template, templateHash: md5(JSON.stringify(parsed.template)), templateCapturedAt: now,
        rpcShape: shape, captureResult: "rpc_bearer"}, now);
}

function cwOfficialObserveIdentity(ctx, reference, identity, route, now) {
    let state = reference.state;
    if (state?.binding === "bearer") {
        if (identity.conflict || route.apiKind === "logout") return cwOfficialStopBearer(ctx, reference, now,
            identity.conflict ? "ACCOUNT_BLOCKED" : "SIGNED_OUT", identity.conflict ? "conflict" : "signed_out", identity.conflict ? "invalid" : "signed_out");
        // 无同次 UID 绑定时不将普通流量的 UID 与 token 隔离摘要比较，也不推断两者同账号。
        return reference;
    }
    if (state?.binding === "unbound" && !identity.conflict && route.apiKind !== "logout") {
        if (route.kind !== "token" || !identity.owner) return reference;
        state = cwOfficialInitial(identity.owner, now);
        return cwOfficialWrite(ctx, reference, state, now);
    }
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

async function captureCainiaoOfficialRequest(ctx, clock = () => Date.now()) {
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
        if (!route || reference.state?.binding === "uid" && reference.state.status === "invalid" && reference.state.captureResult === "conflict") return;
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
        let body;
        try {body = cwOfficialParseBytes(bytes, request.headers);}
        catch (error) {
            cwOfficialRecordRPC(ctx, reference, after, {...cwOfficialRPCShape(undefined, after),
                rejectReason: CW_OFFICIAL_REJECT_REASONS.includes(error?.rejectReason) ? error.rejectReason : "BODY"});
            return {body: bytes};
        }
        const state = reference.state, shape = cwOfficialRPCShape(body, after);
        if (state?.binding === "uid" && (!state.token || cwOfficialBlocked(reference, state.owner) || cwOfficialObservedTemplateToken(body) !== state.token)) return {body: bytes};
        let parsed;
        try {
            parsed = cwOfficialTemplate(body);
            try {
                const rpc = cwAppHeaderValues(request.headers, "http-rpc-type");
                if (rpc.some(value => value.trim() !== "JsonContent")) throw cwOfficialTemplateFail("RPC_HEADER");
            } catch {throw cwOfficialTemplateFail("RPC_HEADER");}
        } catch (error) {
            shape.rejectReason = CW_OFFICIAL_REJECT_REASONS.includes(error?.rejectReason) ? error.rejectReason : "WRAPPER";
            // 同 token 的未知实际合同停止旧模板；不同 token、歧义或迟到正文没有此权限。
            if (state?.token && cwOfficialObservedTemplateToken(body) === state.token && !cwOfficialBlocked(reference, state.owner)) {
                cwOfficialWrite(ctx, reference, {...state, template: null, templateHash: "", templateCapturedAt: null, status: "waiting_template",
                    revision: cwOfficialNonce(after), runId: "", failure: "SCHEMA_INVALID", captureResult: "invalid", rpcShape: shape, at: after}, after);
            } else cwOfficialRecordRPC(ctx, reference, after, shape);
            return {body: bytes};
        }
        if (!state || state.binding !== "uid") {
            cwOfficialCaptureBearer(ctx, reference, parsed, after, shape);
            return {body: bytes};
        }
        const templateHash = md5(JSON.stringify(parsed.template));
        if (state.templateHash === templateHash && ["pending", "ready"].includes(state.status)) return {body: bytes};
        cwOfficialWrite(ctx, reference, {...state, template: parsed.template, templateHash, templateCapturedAt: after,
            status: "pending", revision: cwOfficialNonce(after), runId: "", failure: "NONE", captureResult: "template", rpcShape: shape, at: after}, after);
    } catch (error) { cwOfficialLogFailure(error); }
    return bytes ? {body: bytes} : undefined;
}

async function captureCainiaoOfficialResponse(ctx, clock = () => Date.now()) {
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
    return cwOfficialModel(base, null, "setup", code === "STORAGE_UNCONFIRMED" ? "无法读取本机连接状态"
        : code === "ACCOUNT_BLOCKED" ? "连接已停止，请打开菜鸟" : "连接已更新，请重试",
    {setupTitle: code === "STORAGE_UNCONFIRMED" ? "检查 Egern 存储" : "重新连接菜鸟"});
}

async function loadCainiaoOfficialModel(ctx, clock, base, bounded) {
    if (!cwOfficialAuto(ctx)) return null;
    const now = clock();
    let reference;
    try { reference = cwOfficialAccess(ctx, now); }
    catch { return cwOfficialStop(base, "STORAGE_UNCONFIRMED"); }
    if (reference.raw === null || reference.raw === undefined) return cwOfficialBearerBarrier(reference) ? cwOfficialStop(base, "STORAGE_UNCONFIRMED") : null;
    const original = reference.state;
    if (!original) return cwOfficialStop(base, "STORAGE_UNCONFIRMED");
    if (cwOfficialBlocked(reference, original.owner) && !(original.binding === "unbound" && cwOfficialLegacyHandoff(reference))) return cwOfficialStop(base, "ACCOUNT_BLOCKED");
    if (["invalid", "signed_out"].includes(original.status)) return cwOfficialStop(base, "ACCOUNT_BLOCKED");
    if (original.binding !== "unbound" && original.status === "expired") return cwOfficialModel(base, original.snapshot, "expired", "请打开菜鸟后再刷新");
    if (original.binding === "unbound" || !original.token || !original.template) {
        return cwOfficialModel(base, null, "setup", "打开菜鸟，等菜鸟自带小组件刷新", {setupTitle: "等待菜鸟刷新"});
    }
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
        return cwOfficialModel(base, snapshot, "ready", "", {officialRequestCount: state.requestCount, officialSuccessCount: state.successCount});
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
        const snapshot = state.snapshot, labels = {INVALID_TOKEN: "请打开菜鸟后再刷新", OFFLINE: "请检查网络后重试", DEADLINE: "查询超时，请稍后重试"};
        return cwOfficialModel(base, snapshot, code === "INVALID_TOKEN" ? "expired" : code === "OFFLINE" ? "offline" : "error",
            labels[code] || "暂时查不到包裹", {officialRequestCount: state.requestCount, officialSuccessCount: state.successCount});
    }
}

function cwOfficialLines(ctx, now = Date.now()) {
    let reference;
    try { reference = cwOfficialAccess(ctx, now); }
    catch { return ["官方专用会话：本机存储或账号屏障无法读取。未显示异常原文。"]; }
    if (reference.raw === null || reference.raw === undefined) return ["官方专用会话：尚未捕获本人专用 token 与实际 RPC 参数。"];
    const state = reference.state;
    if (!state) return ["官方专用会话：本机状态格式未确认，未继承凭据或成功证明。"];
    if (cwOfficialBlocked(reference, state.owner)) return ["官方专用会话：账号屏障生效，旧 token 与摘要已阻断。",
        ...(state.binding === "unbound" && state.rpcShape && cwOfficialLegacyHandoff(reference) ? cwOfficialShapeLines(state.rpcShape) : [])];
    const statuses = {waiting_token: "等待专用 token", waiting_template: "已捕获 token，等待同值实际 RPC 参数", pending: "参数已绑定，等待新的摘要查询", ready: "已有独立官方摘要成功记录",
        expired: "专用 token 已拒绝，停止重试", invalid: "账号冲突或已变化，旧摘要已隔离", signed_out: "已观察到退出请求，专用会话停止"};
    const captures = {NONE: "尚无采集", ticket: "已记录本次签发请求票据", issued: "已捕获本次专用 token", template: "已绑定实际 RPC 参数", unchanged: "同值记录保留原状态", anonymous: "身份变化，等待新签发",
        invalid: "格式未确认", token_mismatch: "请求 token 未匹配本次签发", conflict: "同次身份冲突", signed_out: "已观察到退出",
        rpc_bearer: "已捕获真实 RPC 凭据会话，等待独立查询", rpc_unrecognized: "RPC 已观察，正文合同未接受", revocation_full: "撤销记录已满，专用会话停止"};
    const lines = ["官方专用会话：" + (state.binding === "unbound" ? "RPC 已观察，等待可接受的正文合同" : statuses[state.status]), "最近采集：" + captures[state.captureResult],
        "归属边界：" + (state.binding === "bearer" ? "专用凭据会话；UID 账号未确认" : state.binding === "unbound" ? "未绑定凭据或 UID" : "同次签发 UID 绑定"),
        "独立查询尝试：" + state.requestCount + " 次；官方摘要成功：" + state.successCount + " 次。",
        "最近查询分类：" + state.failure, "覆盖范围：官方摘要；完整列表和结构化取件码均未确认。"];
    if (state.rpcShape) lines.push(...cwOfficialShapeLines(state.rpcShape));
    if (state.lastRequestAt !== null) lines.push("最近生成请求时间戳：" + state.lastRequestAt);
    if (state.lastSuccessAt !== null) lines.push("最近独立摘要成功：" + new Date(state.lastSuccessAt).toISOString());
    return lines;
}

function cwOfficialShapeLines(shape) {
    const missing = CW_OFFICIAL_RPC_KEYS.slice(0, 9).filter((_, index) => shape.fieldTypes[index] === "missing");
    const yes = value => value ? "是" : "否", names = values => values.length ? values.join("、") : "无";
    const types = (start, end) => CW_OFFICIAL_RPC_KEYS.slice(start, end).map((key, index) => key + "=" + shape.fieldTypes[start + index]).join("；");
    return ["RPC 固定形状：正文=" + shape.body + "；argsTypes=" + shape.argsTypes + "；已知唯一类型=" + yes(shape.argsTypeKnown)
        + "；argsObjs=" + shape.argsObjs + "；对象数量=" + (shape.argsObjsCount === null ? "未知" : shape.argsObjsCount),
    "RPC 合同拒绝字段：" + (shape.rejectReason || "未记录"),
    "RPC 已知字段缺失：" + names(missing) + "；根额外字段=" + shape.rootExtraCount + "；对象额外字段=" + shape.objectExtraCount,
    "RPC version 类型=" + shape.fieldTypes[5] + "；是否数值 1/2=" + yes(shape.versionKnown) + "；appName 是否已知=" + yes(shape.appNameKnown),
    "RPC installStatus 类型=" + shape.fieldTypes[4] + "；JSON=" + shape.installJSON + "；缺失=" + names(shape.installMissing)
        + "；多余=" + shape.installExtraCount + "；非布尔已知键=" + names(shape.installWrongTypes),
    "RPC ext 类型=" + shape.fieldTypes[6] + "；JSON=" + shape.extJSON + "；apiVersion 类型=" + shape.extAPI + "；是否 V3=" + yes(shape.extV3) + "；多余=" + shape.extExtraCount,
    "RPC 形状观察时间：" + new Date(shape.at).toISOString(),
    "RPC 字段类型：" + types(0, 4) + "（brand 可省略）",
    "RPC 字段类型：" + types(4, 7),
    "RPC 字段类型：" + types(7, 10)];
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
  ready: { label: '待取包裹', title: '暂无待取' },
  setup: { label: '尚未连接', title: '先打开淘宝或菜鸟', detail: '刷新 App 快递列表后回到组件' },
  expired: { label: '会话失效', title: '重开 App 快递列表', detail: '重新接入后回到 Egern 刷新' },
  offline: { label: '连接失败', title: '暂时无法连接', detail: '稍后会自动重试' },
  verify: { label: '需安全验证', title: '请先完成验证', detail: '在淘宝或菜鸟完成验证后重试' },
  partial: { label: '数据未取全', title: '暂未取得完整列表', detail: '仅显示已确认的待取件' },
  error: { label: '更新失败', title: '更新没有完成', detail: '稍后会自动重试' },
};
const CNW_MISSING_DETAILS = '暂无包裹详情';

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
  const officialSummary = input.coverage === 'official_summary';
  const warning = status !== 'ready' || partial || stale;
  const state = partial && status === 'ready' ? CNW_STATES.partial : CNW_STATES[status];
  const label = stale ? '数据较旧' : state.label;
  const lock = family.startsWith('accessory');
  const hideCode = input.privacy === true || (lock && input.privacy !== false);
  return {
    status, items, total, updatedAt, refreshMinutes, time, stale, partial, officialSummary, warning, state, label,
    hideCode, message: cnwString(input.message), setupTitle: cnwString(input.setupTitle).slice(0, 32),
    cached: warning && (items.length > 0 || officialSummary && updatedAt !== null),
    count: `${partial ? '至少' : ''}${total}`,
    refreshAfter: new Date(time + refreshMinutes * 60000).toISOString(),
  };
}

function cnwCode(item, hideCode, officialSummary = false) {
  // 官方返回的是描述，不从数字猜码；锁屏默认连描述一起隐藏。
  if (officialSummary) return {
    text: hideCode ? '取件信息已隐藏' : (cnwString(item.summary) || '暂无取件信息'),
    usable: false, summary: true, private: hideCode,
  };
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
  const code = cnwCode(item, context.hideCode, context.officialSummary);
  if (code.summary) return cnwText(code.text, compact ? 13 : 15, code.private ? CNW_COLORS.secondary : CNW_COLORS.primary, {
    font: { size: compact ? 13 : 15, weight: 'medium' }, maxLines: compact ? 2 : 3, minScale: 0.8,
  });
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
  const count = context.warning && context.items.length === 0 && !context.cached ? '待更新' : `${context.count}${small ? '件' : '件待取'}`;
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
  const hasCount = context.total > 0;
  const title = ready ? (hasCount ? `${context.total}件待取` : (context.stale ? '上次无待取' : CNW_STATES.ready.title))
    : (context.status === 'setup' && context.setupTitle ? context.setupTitle : context.state.title);
  const detail = ready ? (hasCount ? CNW_MISSING_DETAILS : '') : (context.message || context.state.detail);
  return cnwStack('column', [
    { type: 'spacer' },
    cnwIcon(ready ? (hasCount ? 'shippingbox.fill' : 'checkmark.circle')
      : (context.status === 'setup' ? 'lock.fill' : 'exclamationmark.triangle.fill'), compact ? 18 : (small ? 23 : 28),
      ready || context.status === 'setup' ? CNW_COLORS.accent : CNW_COLORS.warning),
    cnwText(title, compact ? 14 : (small ? 15 : 18), CNW_COLORS.primary, { font: { size: compact ? 14 : (small ? 15 : 18), weight: 'semibold' }, minScale: 0.8 }),
    ...(detail ? [cnwText(detail, compact ? 9 : (small ? 10 : 12), CNW_COLORS.secondary, { maxLines: compact ? 1 : 2, minScale: 0.85 })] : []),
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
  const first = hasItems ? cnwCode(context.items[0], context.hideCode, context.officialSummary) : null;
  const count = context.warning && !hasItems && !context.cached ? '—' : context.count;
  const status = cnwLockStatus(context);
  const ready = context.status === 'ready' && !context.partial;
  const empty = ready ? (context.total > 0 ? CNW_MISSING_DETAILS : (context.stale ? '上次无待取' : CNW_STATES.ready.title)) : '待更新';
  const hidden = context.officialSummary ? '信息已隐藏' : '码已隐藏';
  let children;
  if (family === 'accessoryInline') {
    const code = first ? (context.hideCode ? hidden : first.text) : empty;
    children = [cnwText(`${context.warning || context.message ? status : '菜鸟'} · ${count}件 · ${code} · ${cnwLockTimestamp(context, true)}`,
      12, CNW_COLORS.primary, { minScale: 0.45, font: { size: 12, weight: 'medium', ...(first?.usable && !context.hideCode ? { family: 'Menlo' } : {}) } })];
  } else if (family === 'accessoryCircular') {
    const codeText = first ? (context.hideCode ? hidden : (first.usable ? cnwWrapCode(first.text) : first.text)) : empty;
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
      ...(first ? [cnwText(context.hideCode ? (context.officialSummary ? '取件信息已隐藏' : '取件码已隐藏') : first.text, context.hideCode || !first.usable ? 12 : 18, CNW_COLORS.primary, {
        font: { size: context.hideCode || !first.usable ? 12 : 18, weight: first.usable && !context.hideCode ? 'bold' : 'medium', ...(first.usable && !context.hideCode ? { family: 'Menlo' } : {}) }, minScale: 0.45,
        ...(context.officialSummary ? { maxLines: 2 } : {}),
      })] : [cnwText(ready ? empty : (context.setupTitle || context.state.title), 12, CNW_COLORS.primary, { minScale: 0.8 })]),
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

// 来源：count-render.mjs
// 引擎：Egern 原生小组件 DSL | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：模块主脚本设置 CW_COUNT_ONLY=true；离线 node --test cainiao-widget/tests/count-render.test.cjs
// 依赖：无；只读已校验总数、状态和更新时间，不读取包裹明细。

const CWC_COLORS = {
  background: {light: '#FFF9F1', dark: '#201A15'},
  end: {light: '#FFF1E0', dark: '#2B2119'},
  text: {light: '#34271D', dark: '#FFF4E8'},
  muted: {light: '#957E69', dark: '#C4AC96'},
  accent: {light: '#D66C25', dark: '#FFB575'},
  tile: {light: '#FFE8D0', dark: '#47301E'},
  warning: {light: '#A56425', dark: '#F2C18A'},
  warningTile: {light: '#F6E7D3', dark: '#423426'},
};
const CWC_DESKTOP = {
  systemSmall: {padding: 14, size: 65, icon: 25},
  systemMedium: {padding: 13, size: 52, icon: 30},
  systemLarge: {padding: 21, size: 106, icon: 49},
  systemExtraLarge: {padding: 23, size: 112, icon: 58},
};
const CWC_LABELS = {
  setup: '尚未连接', expired: '连接已过期', offline: '暂时离线',
  verify: '需要验证', partial: '数量未取全', error: '更新失败',
};

function cwcText(text, size, color = CWC_COLORS.text, extra = {}) {
  return {type: 'text', text: String(text), font: {size, weight: 'regular'}, textColor: color,
    maxLines: 1, minScale: 0.8, ...extra};
}
function cwcStack(direction, children, extra = {}) {
  return {type: 'stack', direction, alignItems: 'start', children, ...extra};
}
function cwcIcon(symbol, size, color = CWC_COLORS.accent) {
  return {type: 'image', src: 'sf-symbol:' + symbol, width: size, height: size, color};
}
function cwcTime(value) {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : null;
}
function cwcClock(time, now, forceDate = false) {
  if (time === null) return '尚未更新';
  const date = new Date(time), today = new Date(now), pad = value => String(value).padStart(2, '0');
  const clock = pad(date.getHours()) + ':' + pad(date.getMinutes());
  return forceDate || date.toDateString() !== today.toDateString()
    ? pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + clock : clock;
}
function cwcContext(model, now) {
  const input = model && typeof model === 'object' ? model : {};
  const current = Number.isFinite(now) ? now : Date.now();
  const status = input.status === 'ready' || Object.hasOwn(CWC_LABELS, input.status) ? input.status : 'error';
  const refresh = Number(input.refreshMinutes);
  const minutes = Number.isFinite(refresh) && refresh >= 5 ? Math.min(120, refresh) : 15;
  const suppliedTime = cwcTime(input.updatedAt);
  const updatedAt = suppliedTime !== null && suppliedTime <= current + 60000 ? suppliedTime : null;
  const total = Number.isSafeInteger(input.total) && input.total >= 0 && input.total <= 1000000 ? input.total : null;
  const partial = status === 'partial' || input.partial === true;
  const known = status !== 'setup' && updatedAt !== null && total !== null;
  const stale = status === 'ready' && updatedAt !== null && current - updatedAt > Math.max(60, minutes * 3) * 60000;
  const warning = status !== 'ready' || partial || stale || !known;
  const cached = known && (status !== 'ready' && !partial || stale);
  const label = stale ? '数据较旧' : partial ? CWC_LABELS.partial : status === 'ready' && !known ? '等待更新' : CWC_LABELS[status] || '';
  const number = known ? (partial ? '≥' : '') + total : '—';
  const empty = known && total === 0 && !partial;
  const caption = !known ? (status === 'setup' ? '等待首次连接' : '等待更新')
    : empty ? (cached ? '上次无待取' : '暂无待取') : cached ? '上次待取' : partial ? '至少待取' : '待取包裹';
  return {now: current, status, updatedAt, total, known, partial, stale, warning, cached, label, number, empty, caption,
    stamp: updatedAt === null ? '尚未更新' : (cached ? '上次 ' : '更新 ') + cwcClock(updatedAt, current, cached),
    refreshAfter: new Date(current + minutes * 60000).toISOString()};
}
function cwcHeader(context, small) {
  return cwcStack('row', [
    cwcIcon('shippingbox.fill', small ? 13 : 15),
    cwcText('菜鸟取件', small ? 10 : 12, CWC_COLORS.text, {font: {size: small ? 10 : 12, weight: 'semibold'}}),
    {type: 'spacer'},
    ...(context.warning ? [cwcText(context.label, small ? 9 : 10, CWC_COLORS.warning,
      {font: {size: small ? 9 : 10, weight: 'medium'}, minScale: 0.65})] : []),
  ], {alignItems: 'center', gap: 5});
}
function cwcFooter(context, small) {
  return cwcStack('row', [
    cwcIcon('clock', small ? 8 : 9, CWC_COLORS.muted),
    cwcText(context.stamp, small ? 8 : 9, CWC_COLORS.muted, {minScale: 0.75}),
  ], {alignItems: 'center', gap: 4});
}
function cwcEmpty(context, options, small, medium) {
  if (medium) return cwcStack('column', [
    {type: 'spacer'},
    cwcStack('row', [
      cwcStack('row', [cwcIcon(context.cached ? 'shippingbox' : 'checkmark', 26)], {
        padding: 10, borderRadius: 17, backgroundColor: CWC_COLORS.tile,
      }),
      cwcText(context.caption, 21, CWC_COLORS.text, {font: {size: 21, weight: 'semibold'}}),
    ], {gap: 13, alignItems: 'center'}),
    {type: 'spacer'},
  ], {flex: 1});
  return cwcStack('column', [
    {type: 'spacer'},
    cwcStack('row', [cwcIcon(context.cached ? 'shippingbox' : 'checkmark', options.icon)], {
      padding: small ? 8 : 12, borderRadius: small ? 14 : 20, backgroundColor: CWC_COLORS.tile,
    }),
    cwcText(context.caption, small ? 16 : 22, CWC_COLORS.text, {
      font: {size: small ? 16 : 22, weight: 'semibold'}, minScale: 0.8,
    }),
    {type: 'spacer'},
  ], {flex: 1, gap: small ? 8 : 12});
}
function cwcNumber(context, options, small, medium) {
  const color = context.warning ? CWC_COLORS.warning : CWC_COLORS.accent;
  const size = context.number.length > 4 ? Math.floor(options.size * 0.75) : options.size;
  const number = cwcText(context.number, size, color, {font: {size, weight: 'bold'}, minScale: 0.42});
  if (small) return cwcStack('column', [
    {type: 'spacer'}, number,
    cwcText(context.caption, 10, CWC_COLORS.muted, {font: {size: 10, weight: 'medium'}}),
    {type: 'spacer'},
  ], {flex: 1, gap: 1});
  const labelSize = medium ? 12 : 16;
  const count = cwcStack('column', [number, cwcText(context.caption, labelSize, CWC_COLORS.muted,
    {font: {size: labelSize, weight: 'medium'}})], {flex: 1, gap: medium ? 0 : 4});
  const tile = cwcStack('column', [cwcIcon(context.known ? 'shippingbox.fill' : 'arrow.clockwise', options.icon, color)], {
    padding: medium ? 14 : 22, borderRadius: medium ? 20 : 29,
    backgroundColor: context.warning ? CWC_COLORS.warningTile : CWC_COLORS.tile,
  });
  return cwcStack('column', [{type: 'spacer'}, cwcStack('row', [count, tile], {
    alignItems: 'center', gap: medium ? 16 : 24,
  }), {type: 'spacer'}], {flex: 1});
}
function cwcDesktop(context, family) {
  const options = CWC_DESKTOP[family], small = family === 'systemSmall', medium = family === 'systemMedium';
  return {type: 'widget', refreshAfter: context.refreshAfter, backgroundColor: CWC_COLORS.background,
    backgroundGradient: {type: 'linear', colors: [CWC_COLORS.background, CWC_COLORS.end],
      startPoint: {x: 0, y: 0}, endPoint: {x: 1, y: 1}},
    padding: options.padding, gap: small ? 5 : medium ? 6 : 8,
    children: [cwcHeader(context, small),
      context.empty ? cwcEmpty(context, options, small, medium) : cwcNumber(context, options, small, medium),
      cwcFooter(context, small)]};
}
function cwcLock(context, family) {
  const color = context.warning ? CWC_COLORS.warning : CWC_COLORS.accent;
  if (family === 'accessoryInline') {
    const value = context.empty ? context.caption : context.known ? context.number + '件待取' : '待更新';
    const warning = context.warning ? ' · ' + context.label : '';
    return {type: 'widget', refreshAfter: context.refreshAfter, padding: 0, children: [
      cwcText('菜鸟 · ' + value + warning + ' · ' + context.stamp, 11, color, {minScale: 0.5}),
    ]};
  }
  if (family === 'accessoryCircular') {
    return {type: 'widget', refreshAfter: context.refreshAfter, padding: 3, gap: 1, children: [
      cwcText(context.warning ? context.label : '菜鸟待取', 8, color, {textAlign: 'center', minScale: 0.6}),
      cwcText(context.empty ? context.caption : context.number, context.empty ? 11 : 23, color, {
        textAlign: 'center', font: {size: context.empty ? 11 : 23, weight: 'bold'}, minScale: 0.4,
      }),
      cwcText(context.stamp, 6.5, CWC_COLORS.muted, {textAlign: 'center', minScale: 0.4}),
    ]};
  }
  return {type: 'widget', refreshAfter: context.refreshAfter, padding: 3, gap: 2, children: [
    cwcStack('row', [cwcIcon('shippingbox.fill', 10, color),
      cwcText(context.warning ? context.label : '菜鸟取件', 10, color, {font: {size: 10, weight: 'semibold'}})], {gap: 4, alignItems: 'center'}),
    cwcText(context.empty ? context.caption : context.known ? context.number + ' 件待取' : '等待更新', 20, color,
      {font: {size: 20, weight: 'bold'}, minScale: 0.6}),
    cwcText(context.stamp, 8, CWC_COLORS.muted, {minScale: 0.7}),
  ]};
}

function renderCountWidget(model, family = 'systemSmall', now = Date.now()) {
  const chosen = Object.hasOwn(CWC_DESKTOP, family) || ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'].includes(family)
    ? family : 'systemSmall';
  const context = cwcContext(model, now);
  return chosen.startsWith('accessory') ? cwcLock(context, chosen) : cwcDesktop(context, chosen);
}

// 来源：runtime.mjs
// 引擎：Egern 原生 generic 脚本 | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：导入模块，打开本人淘宝／菜鸟 App 快递列表，再运行组件
// 依赖：core.mjs、app.mjs、auth.mjs、response.mjs、transport.mjs、official.mjs、render.mjs；发布文件内联

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
    if (mode === "auto") {
        // 官方专用 token 使用独立合同，成功只确认摘要，不冒充旧 H5 完整 PDS。
        // 新状态存在但未就绪、失效或换号时不能退回旧 Cookie 显示另一账号。
        try {
            const official = await loadCainiaoOfficialModel(ctx, clock, base, cwBounded);
            if (official !== null) return official;
        } catch {
            return {...base, status: "setup", setupTitle: "检查 Egern 存储", message: "无法读取本机连接状态"};
        }
    }
    if (env.CW_COUNT_ONLY === "true") return {...base, status: "setup", setupTitle: "等待首次连接", message: "打开菜鸟，等菜鸟自带小组件刷新后即可独立查询"};
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
        try {
            const official = ctx.storage.getJSON(CW_OFFICIAL_STORE);
            if (official !== null && official !== undefined) throw new CwFailure("superseded");
            current = cwReadAuth(ctx, clock());
        }
        catch (error) {
            if (error instanceof CwFailure) throw error;
            throw new CwFailure("local");
        }
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
    const initialCandidate = !!automatic && automatic.confirmedAt === null;
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
        // 首次完整 Cookie 仅纠正显示；保留合法 expired 终止，不写不支持的来源／状态组合。
        const storedKind = initialCandidate && !restricted && originalKind === "expired" ? "expired" : kind;
        if (["superseded", "local"].includes(kind)) return stopped(kind);
        try {
            if (state.queryDiagnostic) updateQuery({failure: error instanceof CwFailure ? error.failure : "UNKNOWN"});
            if (["expired", "verify", "account", "unsupported"].includes(storedKind)) markAuth(storedKind === "account" ? "invalid" : storedKind);
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
    if (ctx.response) {
        if (cwOfficialRoute(ctx.request?.url, ctx.request?.headers)?.kind === "token") return captureCainiaoOfficialResponse(ctx);
        return captureCainiaoResponse(ctx);
    }
    if (ctx.request) {
        let originalBody;
        try { originalBody = await captureCainiaoOfficialRequest(ctx); }
        catch { console.log("[菜鸟连接] 官方会话采集未完成，原请求继续透传。"); }
        try { captureCainiaoCredentials(ctx); }
        catch { console.log("[菜鸟连接] 捕获未完成，原请求继续透传。"); }
        return originalBody;
    }
    if (ctx.env?.CAINIAO_DIAGNOSTIC === "true") {
        let result;
        if (ctx.env.CW_TRANSPORT_CHECK === "true") result = await runCainiaoTransportCheck(ctx);
        const now = Date.now(), widget = diagnoseCainiaoConnection(ctx, () => now);
        const transportLines = result ? cwTransportResultLines(result, now) : cwTransportLines(ctx, now);
        const currentLines = widget.children[0].text.split("\n");
        widget.children[0].text = [currentLines.shift(), ...cwOfficialLines(ctx, now),
            "以下为旧 H5 备用状态，不代表官方专用查询结果：", ...currentLines,
            ...transportLines, ...cwResponseLines(ctx, now)].join("\n");
        return widget;
    }
    const model = await loadCainiaoModel(ctx);
    if (ctx.env?.CW_COUNT_ONLY === "true") return renderCountWidget(model, ctx.widgetFamily, Date.now());
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
