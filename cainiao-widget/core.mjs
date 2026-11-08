// 引擎：Egern JavaScript | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用；离线验证 node --test cainiao-widget/tests/core.test.cjs
// 依赖：无；协议来源见 THIRD_PARTY_NOTICES.md

export const CW_VERSION = "1.2.1";
export const CW_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
export const CW_COUNT_API = "mtop.cainiao.lpc.packageservice.user.package.count.query";
export const CW_IDENTITY_API = "mtop.user.getUserSimple";
export const CW_HOST = "https://h5api.m.taobao.com";
export const CW_PATH = "/h5/" + CW_API.toLowerCase() + "/1.0/";
export const CW_COUNT_PATH = "/h5/" + CW_COUNT_API.toLowerCase() + "/1.0/";
export const CW_IDENTITY_PATH = "/h5/" + CW_IDENTITY_API.toLowerCase() + "/1.0/";
export const CW_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
export const CW_STORE = "cainiao-widget.local.v1";
export const CW_AUTH_STORE = "cainiao-widget.auth.v1";
export const CW_CAPTURE_STORE = "cainiao-widget.capture.v1";
export const CW_APP_STORE = "cainiao-widget.app.v1";
export const CW_SELF_HEADER = "X-Cainiao-Widget-Request";

// MD5 只用于 MTOP 协议签名与本地身份摘要，不用于加密存储。
export function md5(value) {
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

export function cwObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cwKnownVersion(value) {
    return ["1.1.0", "1.2.0", CW_VERSION].includes(value);
}

export function cwText(value, limit = 160) {
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

export function cwCookieMap(header, includeEmpty = false) {
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

export function cwCookieHeader(cookies) {
    return [...cookies].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("; ");
}

export function cwOwner(cookies) {
    const unb = cookies.get("unb");
    if (unb) return md5("account:" + unb);
    const session = ["cookie2", "sgcookie", "munb"].map(k => k + "=" + (cookies.get(k) || "")).join(";");
    return md5("session:" + (cookies.has("cookie2") || cookies.has("sgcookie") ? session : cwCookieHeader(cookies)));
}

// 只接受当前固定业务 URL 可用的 Set-Cookie，不把其他域或路径的值摊进请求头。
export function cwUpdateCookies(cookies, headers, now = Date.now(), requestPath = CW_PATH) {
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

export function cwRequestData(page) {
    return JSON.stringify({pageSize: 50, currentPage: page, needTemporality: false, needDynInfo: "{'needFindTemporality':true,'needAppointment':true}"});
}

function cwMtopRequestURL(cookies, api, data, now) {
    const t = String(Math.floor(now));
    const token = (cookies.get("_m_h5_tk") || "").split("_")[0];
    const sign = md5(token + "&" + t + "&12574478&" + data);
    const query = {jsv: "2.7.4", appKey: "12574478", t, sign, api, v: "1.0", type: "originaljson", dataType: "json", data};
    return CW_HOST + "/h5/" + api.toLowerCase() + "/1.0/?" + Object.entries(query).map(([key, value]) => key + "=" + encodeURIComponent(value)).join("&");
}

export function cwRequestURL(cookies, page, now) {
    return cwMtopRequestURL(cookies, CW_API, cwRequestData(page), now);
}

export function cwAccountRequestURL(cookies, now) {
    return cwMtopRequestURL(cookies, CW_COUNT_API, JSON.stringify({appName: "GUOGUO"}), now);
}

export function cwIdentityRequestURL(cookies, now) {
    // 直接请求 H5，不运行 WindVane、SDK 自动登录或网页交互。
    return cwMtopRequestURL(cookies, CW_IDENTITY_API, "{}", now);
}

export function cwResponseAPI(body, api) {
    return cwObject(body) && typeof body.api === "string" && body.api.toLowerCase() === api.toLowerCase()
        && (body.v === undefined || body.v === "1.0");
}

export function cwIdentityMatch(body, expectedUid) {
    // 官方页面消费的是顶层 userNumId；未知别名或昵称不能补判身份。
    if (!cwResponseAPI(body, CW_IDENTITY_API) || cwReturnKind(body) !== "success"
        || typeof expectedUid !== "string" || !/^[1-9][0-9]{0,19}$/.test(expectedUid)) return "unverified";
    const value = body.userNumId;
    const uid = typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) ? value
        : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "";
    return !uid ? "unverified" : uid === expectedUid ? "match" : "mismatch";
}

export function cwReturnKind(body) {
    if (!cwObject(body) || !Array.isArray(body.ret) || !body.ret.length || body.ret.some(v => typeof v !== "string")) return "schema";
    const codes = body.ret.map(value => value.split("::")[0].toUpperCase());
    if (codes.every(code => code === "SUCCESS")) return "success";
    if (codes.some(code => /SESSION|LOGIN|AUTH_REJECT|USER_NOT_LOGIN/.test(code))) return "expired";
    if (codes.some(code => /RGV|VALIDATE|CAPTCHA|TRAFFIC|FLOOD|USER_VALIDATE|ACCESS_DENIED/.test(code))) return "verify";
    if (codes.some(code => /TOKEN_EMPTY|TOKEN_EXPIRED|TOKEN_EXOIRED|ILLEGAL_ACCESS/.test(code))) return "token";
    return "error";
}

export function cwReadPage(body, requestedPage) {
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

export function cwNormalizePackage(raw) {
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

export function cwItems(packages) {
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
