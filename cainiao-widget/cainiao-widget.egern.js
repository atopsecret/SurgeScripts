// Egern 原生菜鸟取件小组件 1.0.0 · 自动构建，请编辑本目录源文件。
// 构建：node cainiao-widget/build.mjs；来源与许可见 THIRD_PARTY_NOTICES.md。
// 来源：core.mjs
// 引擎：Egern JavaScript | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用；离线验证 node --test cainiao-widget/tests/core.test.cjs
// 依赖：无；协议来源见 THIRD_PARTY_NOTICES.md

const CW_VERSION = "1.0.0";
const CW_API = "mtop.cainiao.lpc.packageservice.queryPdsPackageDataList";
const CW_HOST = "https://h5api.m.taobao.com";
const CW_PATH = "/h5/" + CW_API.toLowerCase() + "/1.0/";
const CW_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const CW_STORE = "cainiao-widget.local.v1";

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

function cwCookieMap(header) {
    if (typeof header !== "string" || header.length > 32768 || /[\r\n\x00]/.test(header)) throw new Error("cookie-format");
    const cookies = new Map();
    for (const part of header.replace(/^cookie:\s*/i, "").split(";")) {
        if (!part.trim()) continue;
        const at = part.indexOf("=");
        const name = part.slice(0, at).trim(), value = part.slice(at + 1).trim();
        if (at < 1 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || !/^[\x21-\x3a\x3c-\x7e]*$/.test(value) || value.length > 8192) throw new Error("cookie-format");
        if (/^(?:path|domain|expires|max-age|secure|httponly|samesite)$/i.test(name)) throw new Error("cookie-format");
        if (cookies.has(name) && cookies.get(name) !== value) throw new Error("cookie-duplicate");
        if (value) cookies.set(name, value);
    }
    return cookies;
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
function cwUpdateCookies(cookies, headers, now = Date.now()) {
    let lines = [];
    if (headers && typeof headers.getAll === "function") lines = headers.getAll("set-cookie");
    else if (headers) {
        const value = headers["set-cookie"] ?? headers["Set-Cookie"];
        lines = Array.isArray(value) ? value : value ? [value] : [];
    }
    if (!Array.isArray(lines)) return;
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
            const path = attrs.path || "/h5/" + CW_API.toLowerCase() + "/1.0";
            if (!(CW_PATH === path || CW_PATH.startsWith(path.endsWith("/") ? path : path + "/"))) continue;
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

function cwRequestURL(cookies, page, now) {
    const data = cwRequestData(page), t = String(Math.floor(now));
    const token = (cookies.get("_m_h5_tk") || "").split("_")[0];
    const sign = md5(token + "&" + t + "&12574478&" + data);
    const query = {jsv: "2.7.4", appKey: "12574478", t, sign, api: CW_API, v: "1.0", type: "originaljson", dataType: "json", data};
    return CW_HOST + CW_PATH + "?" + Object.entries(query).map(([key, value]) => key + "=" + encodeURIComponent(value)).join("&");
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

// 来源：render.mjs
// 引擎：Egern 原生小组件 DSL | 语言：JavaScript ES module
// 构建：node cainiao-widget/build.mjs
// 运行：由 runtime.mjs 调用 renderWidget；离线 node --test cainiao-widget/tests/render.test.cjs
// 依赖：无；不依赖浏览器或第三方运行库

const CNW_URL = 'https://www.cainiao.com/';
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
  setup: { label: '尚未登录', title: '先连接菜鸟账号', detail: '完成登录后，待取包裹会显示在这里' },
  expired: { label: '登录过期', title: '需要重新登录', detail: '更新登录凭据后重试' },
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
    hideCode, message: cnwString(input.message),
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
  if (context.status === 'expired') detail = detail.replace(/^登录(?:已)?过期[，,：:\s]*/, '');
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
  const title = ready ? CNW_STATES.ready.title : context.state.title;
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
    type: 'widget', url: CNW_URL, refreshAfter: context.refreshAfter,
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
      })] : [cnwText(context.status === 'ready' ? '没有待取包裹' : context.state.title, 12, CNW_COLORS.primary, { minScale: 0.8 })]),
      cnwText(cnwLockTimestamp(context), 8, CNW_COLORS.secondary, { minScale: 0.75 }),
    ];
  }
  return {
    type: 'widget', url: CNW_URL, refreshAfter: context.refreshAfter,
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
// 运行：安装 cainiao-widget.egern.yaml 并填写 CAINIAO_COOKIE
// 依赖：core.mjs、render.mjs；发布文件内联，不下载其他代码

class CwFailure extends Error {
    constructor(kind) { super(kind); this.kind = kind; }
}

// 原生文档未承诺浏览器计时器；检测到支持时为 HTTP 与读体增加 Promise 等待上限。
// 无计时器时依赖 ctx.http.timeout 和脚本时限，仍在接受结果前复核预算。
async function cwBounded(task, deadline, clock) {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new CwFailure("partial");
    let timer;
    try {
        const work = Promise.resolve().then(task);
        let result;
        if (typeof globalThis.setTimeout === "function" && typeof globalThis.clearTimeout === "function") {
            const limit = new Promise((_, reject) => { timer = globalThis.setTimeout(() => reject(new CwFailure("partial")), remaining); });
            result = await Promise.race([work, limit]);
        } else result = await work;
        if (clock() >= deadline) throw new CwFailure("partial");
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

function cwFailureMessage(kind, cached) {
    const messages = {
        expired: "登录已过期，请重新扫码",
        verify: "请在淘宝或菜鸟完成验证",
        offline: "暂时连不上，稍后再试",
        partial: "本次未查全，稍后刷新",
        schema: "接口数据有变化，暂未更新",
        account: "账号发生变化，请重新导入",
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
    let imported;
    try { imported = cwCookieMap(env.CAINIAO_COOKIE || ""); }
    catch { return {...base, status: "setup", message: "登录参数格式有误，请重新粘贴"}; }
    if (!imported.size) {
        // 清空参数即退出本组件登录，同时覆盖本组件的旧缓存和 Cookie。
        try { await ctx.storage.setJSON(CW_STORE, null); } catch {}
        return {...base, status: "setup", message: "先运行扫码助手，再填写登录参数"};
    }
    const owner = cwOwner(imported), inputHash = md5(cwCookieHeader(imported));
    let old;
    try { old = await ctx.storage.getJSON(CW_STORE); } catch {}
    const sameAccount = cwObject(old) && old.owner === owner;
    if (sameAccount && old.inputHash === inputHash && old.invalidated === true) return {...base, status: "error", message: cwFailureMessage("account", false)};
    let snapshot = sameAccount ? cwSnapshot(old.snapshot, now) : null;
    let cookies = imported;
    if (sameAccount && old.inputHash === inputHash) {
        try {
            const stored = cwCookieMap(old.cookie);
            if (stored.size && (!imported.get("unb") || !stored.get("unb") || imported.get("unb") === stored.get("unb"))) cookies = stored;
        } catch {}
    }
    // 最多保留七天旧结果；更久的数据只保留更新时间用于说明，不再展示码。
    if (snapshot && now - Date.parse(snapshot.updatedAt) > 7 * 86400000) snapshot = null;
    const state = {version: CW_VERSION, owner, inputHash, cookie: cwCookieHeader(cookies), snapshot,
        observedUnb: imported.get("unb") || cookies.get("unb") || (sameAccount && old.inputHash === inputHash && typeof old.observedUnb === "string" ? old.observedUnb : "")};
    let storageOK = true;
    const persist = async () => {
        state.cookie = cwCookieHeader(cookies);
        try { await ctx.storage.setJSON(CW_STORE, state); } catch { storageOK = false; }
    };
    // 新账号先覆盖旧状态，失败也不能回显另一账号的包裹。
    await persist();
    const deadline = now + 18000;
    const getPage = async page => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const remaining = deadline - clock();
            if (remaining < 1200) throw new CwFailure("partial");
            let response;
            const beforeToken = cookies.get("_m_h5_tk") || "";
            try {
                response = await cwBounded(() => ctx.http.get(cwRequestURL(cookies, page, clock()), {
                    headers: {Cookie: cwCookieHeader(cookies), "User-Agent": CW_UA, Referer: "https://h5.m.taobao.com/", Accept: "application/json"},
                    timeout: Math.max(1, Math.min(7000, remaining - 500)), redirect: "manual", credentials: "omit", insecureTls: false,
                }), deadline, clock);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("offline"); }
            try { cwUpdateCookies(cookies, response.headers, clock()); } catch {}
            const nextUnb = cookies.get("unb") || "";
            if (state.observedUnb && state.observedUnb !== nextUnb) {
                state.snapshot = null; snapshot = null;
                state.invalidated = true;
                // 后续同一导入值不再复用已变更的会话，等待用户重新扫码导入。
                cookies = new Map();
                throw new CwFailure("account");
            }
            if (nextUnb) state.observedUnb = nextUnb;
            // 失败响应也可能下发新 token，须先持久化再分类。
            await persist();
            if ([301, 302, 303, 307, 308, 403, 429].includes(response.status)) throw new CwFailure("verify");
            if (response.status === 401) throw new CwFailure("expired");
            if (response.status >= 500) throw new CwFailure("offline");
            if (response.status !== 200) throw new CwFailure("error");
            let body;
            try {
                const raw = await cwBounded(() => response.text(), deadline, clock);
                if (raw.length > 3 * 1024 * 1024) throw new CwFailure("schema");
                if (/^\s*</.test(raw)) throw new CwFailure("verify");
                body = JSON.parse(raw);
            } catch (error) { throw error instanceof CwFailure ? error : new CwFailure("schema"); }
            const kind = cwReturnKind(body);
            if (kind === "success") {
                try { return cwReadPage(body, page); } catch { throw new CwFailure("schema"); }
            }
            if (kind === "token") {
                const nextToken = cookies.get("_m_h5_tk") || "";
                if (attempt < 2 && nextToken && nextToken !== beforeToken) continue;
                throw new CwFailure("expired");
            }
            throw new CwFailure(kind);
        }
        throw new CwFailure("error");
    };
    let collected = [], partialItems = [];
    const pageSignatures = new Set();
    try {
        for (let page = 1; page <= 20; page++) {
            const result = await getPage(page);
            // 相同分页响应不能造成“已经取全”的假象。
            const signature = md5(JSON.stringify(result.packages));
            if (result.packages.length && pageSignatures.has(signature)) throw new CwFailure("partial");
            pageSignatures.add(signature);
            collected = collected.concat(result.packages);
            try { partialItems = cwItems(collected); } catch { throw new CwFailure("schema"); }
            if (result.complete) {
                if (clock() >= deadline) throw new CwFailure("partial");
                snapshot = {items: partialItems, updatedAt: new Date(clock()).toISOString()};
                state.snapshot = snapshot;
                await persist();
                return {...base, ...snapshot, total: snapshot.items.length, status: "ready", message: storageOK ? "" : "本机缓存写入失败，刷新时将重新查询"};
            }
        }
        throw new CwFailure("partial");
    } catch (error) {
        const kind = error instanceof CwFailure ? error.kind : "error";
        await persist();
        if (snapshot) return {...base, ...snapshot, total: snapshot.items.length,
            status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, true)};
        // 无历史快照时可展示已成功查到的部分，但不能缓存为完整结果或声称完整数量。
        if (partialItems.length && !["account", "expired", "verify"].includes(kind)) return {...base, items: partialItems, total: partialItems.length,
            updatedAt: new Date(clock()).toISOString(), partial: true, status: "partial", message: "只查到部分包裹，数量未取全"};
        return {...base, status: ["expired", "verify", "offline"].includes(kind) ? kind : "error", message: cwFailureMessage(kind, false)};
    }
}

export default async function(ctx) {
    const model = await loadCainiaoModel(ctx);
    return renderWidget(model, ctx.widgetFamily, Date.now());
}
