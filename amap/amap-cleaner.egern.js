// Engine | Egern 原生脚本 API | JavaScript ES module
// Build: 无需构建
// Run: 导入 amap-adblock.egern.yaml；手动运行“高德净化诊断 · Egern”
// Deps: Egern ctx API；测试：node --experimental-vm-modules --test amap/tests/egern.test.cjs
// Version: 2.0.0
// Author: atopsecret；页面端点历史参考 ddgksf2013，详见本目录 README。

export const VERSION = "2.0.0";
export const STORE = "egern_amap_cleaner_v2";
const ROUTES = [
    ["notice", /^\/ws\/message\/notice\/list(?:\/|$)/],
    ["home", /^\/ws\/faas\/amap-navigation\/main-page(?:\/|$)/],
    ["message", /^\/ws\/msgbox\/pull(?:\/|$)/],
    ["profile", /^\/ws\/shield\/dsp\/profile\/index\/nodefaas(?:\/|$)/],
    ["hotword", /^\/ws\/shield\/search\/new_hotword(?:\/|$)/],
    ["config", /^\/ws\/shield\/frogserver\/aocs\/updatable(?:\/|$)/],
    ["nearby", /^\/ws\/shield\/search\/nearbyrec_smart(?:\/|$)/],
    ["taxi", /^\/ws\/promotion-web\/resource(?:\/|$)/]
];
const STATUSES = ["changed", "unchanged", "empty", "format", "server-error", "http-error"];
const AD_CARDS = ["AdCard", "AdvertCard", "AdvertisingCard", "PromotionCard", "BannerCard", "CommercialCard"];
const CONFIG_KEYS = ["gd_notch_logo", "home_business_position_config", "his_input_tip", "operation_layer", "SplashScreenControl", "splashview_config"];
const NEARBY_KEYS = ["coupon", "scene", "activity", "commodity_rec", "operation_activity"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function route(url) {
    const match = /^https?:\/\/(?:[a-z0-9-]+\.)+amap\.com(?::[0-9]+)?(\/[^?#]*)/i.exec(String(url || ""));
    const found = match && ROUTES.find(entry => entry[1].test(match[1]));
    return found ? found[0] : null;
}

// 先保存原字节，再严格解码 UTF-8；不依赖未文档化的 clone 或 TextDecoder 全局。
// 无效 UTF-8、BOM 或未知编码不替换成占位字符，直接交还已保存的原字节。
function decodeUTF8(bytes) {
    const parts = [];
    let chunk = "";
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++];
        let point = first, count = 0, minimum = 0;
        if (first >= 0xc2 && first <= 0xdf) { point &= 0x1f; count = 1; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { point &= 0x0f; count = 2; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { point &= 0x07; count = 3; minimum = 0x10000; }
        else if (first > 0x7f) throw new Error("invalid-utf8");
        for (let j = 0; j < count; j++) {
            const next = bytes[i++];
            if (next === undefined || (next & 0xc0) !== 0x80) throw new Error("invalid-utf8");
            point = point * 64 + (next & 0x3f);
        }
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("invalid-utf8");
        chunk += String.fromCodePoint(point);
        if (chunk.length >= 8192) { parts.push(chunk); chunk = ""; }
    }
    parts.push(chunk);
    return parts.join("");
}

function clear(node, key) {
    if (!record(node)) return;
    if (Array.isArray(node[key])) node[key] = [];
    else if (record(node[key])) node[key] = {};
}
function adCard(item) {
    return record(item) && (AD_CARDS.includes(item.dataType) || item.isAd === true || item.is_ad === true || item.adFlag === 1);
}
function cards(node, key) {
    if (!record(node)) return;
    if (Array.isArray(node[key])) node[key] = node[key].filter(item => !adCard(item));
    else if (record(node[key])) {
        // 字典继续保持字典，只删除明确的广告卡，保留未知业务结构。
        for (const name of Object.keys(node[key])) if (adCard(node[key][name])) delete node[key][name];
    }
}
function clean(id, root) {
    const data = root.data;
    if (id === "notice") clear(data, "noticeList");
    else if (id === "message") {
        clear(root, "msgs"); clear(root.pull3, "msgs");
        clear(data, "msgs"); if (record(data)) clear(data.pull3, "msgs");
    } else if (id === "home" && record(data)) {
        cards(data, "cardList"); cards(data, "mapBizList");
        clear(data, "business_position"); clear(data.pull3, "msgs");
    } else if (id === "profile" && record(data)) {
        delete data.tipData; cards(data, "cardList");
    } else if (id === "hotword") clear(data, "header_hotword");
    else if (id === "config" && record(data)) {
        // 仅六个已知配置名，不按 ai_ 等子串清空导航或 AI 功能。
        for (const key of CONFIG_KEYS) if (record(data[key]) &&
            typeof data[key].value === "string" && typeof data[key].version === "string") {
            data[key] = { ...data[key], status: 1, version: "", value: "" };
        }
    } else if (id === "nearby" && record(data)) {
        for (const key of NEARBY_KEYS) delete data[key];
        if (Array.isArray(data.modules)) data.modules = data.modules.filter(item =>
            !(typeof item === "string" && NEARBY_KEYS.includes(item)));
    } else if (id === "taxi" && record(data)) {
        for (const key of ["icon", "banner", "tips", "popup", "bubble", "other"]) clear(data, key);
    }
}
function successful(root) {
    if (root.result !== undefined && ![true, "true", 1, "1", "success"].includes(root.result)) return false;
    if (root.success !== undefined && root.success !== true) return false;
    return root.code === undefined || [1, "1", 0, "0", 200, "200"].includes(root.code);
}
export function transform(id, body) {
    if (!ROUTES.some(entry => entry[0] === id)) return { status: "unsupported" };
    if (typeof body !== "string" || !body.length) return { status: "empty" };
    let root;
    try { root = JSON.parse(body); } catch (_) { return { status: "format" }; }
    if (!record(root)) return { status: "format" };
    if (!successful(root)) return { status: "server-error" };
    const before = JSON.stringify(root);
    clean(id, root);
    const after = JSON.stringify(root);
    return before === after ? { status: "unchanged" } : { status: "changed", body: after };
}
function responseHeaders(input) {
    const stale = ["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5", "content-type", "cache-control", "digest", "content-digest", "repr-digest"];
    const values = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-AMap-Cleaner-Version": VERSION
    };
    // Headers 不保证属性可枚举，直接修改原对象，Cookie 等未触及的多值头不会丢失。
    const names = [...new Set([...stale, ...Object.keys(values).map(name => name.toLowerCase())])];
    const before = names.map(name => [name, typeof input.getAll === "function" ? input.getAll(name) :
        (input.get(name) === null ? [] : [input.get(name)])]);
    try {
        for (const name of stale) input.delete(name);
        for (const [name, value] of Object.entries(values)) input.set(name, value);
        return input;
    } catch (error) {
        // 方法异常时恢复已触及的头，再由入口回传原字节。持续失败的 API 无法保证恢复。
        for (const [name, saved] of before) {
            try { input.delete(name); for (const value of saved) input.append(name, value); } catch (_) {}
        }
        throw error;
    }
}
function number(value) { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 999999) : 0; }
function loadCounts(ctx) {
    const output = { version: VERSION, routes: {} };
    try {
        const saved = ctx.storage.getJSON(STORE);
        if (saved === null) return { ...output, warning: "尚无页面记录，不能据此判断开屏是否被拦截" };
        if (!record(saved) || saved.version !== VERSION || !record(saved.routes)) {
            return { ...output, warning: "旧统计结构不符，显示本版零值" };
        }
        for (const [id] of ROUTES) if (record(saved.routes[id])) {
            output.routes[id] = {};
            for (const status of STATUSES) output.routes[id][status] = number(saved.routes[id][status]);
        }
        return output;
    } catch (_) { return { ...output, warning: "本地存储不可读取，零值不代表没有命中" }; }
}
function count(ctx, id, status) {
    // 只存固定路由、结果枚举及封顶计数，存储异常不能影响响应。
    try {
        const saved = loadCounts(ctx);
        const row = saved.routes[id] || Object.fromEntries(STATUSES.map(name => [name, 0]));
        row[status] = Math.min(number(row[status]) + 1, 999999);
        saved.routes[id] = row;
        ctx.storage.setJSON(STORE, { version: VERSION, routes: saved.routes });
    } catch (_) { /* 页面处理和诊断不发通知。 */ }
}
function diagnostic(ctx) {
    const saved = loadCounts(ctx);
    const lines = ["Egern 原生脚本 " + VERSION];
    if (saved.warning) lines.push(saved.warning);
    for (const [id] of ROUTES) {
        const row = saved.routes[id] || {};
        lines.push(id + ": 已改写=" + number(row.changed) + ", 无变化=" + number(row.unchanged) +
            ", 格式不符=" + (number(row.format) + number(row.empty)) +
            ", 错误放行=" + (number(row["server-error"]) + number(row["http-error"])));
    }
    lines.push("开屏走 Map Local，不计入页面脚本；请核对 RT 请求与版本响应头。");
    for (const line of lines) console.log("[高德净化] " + line);
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

export default async function(ctx) {
    if (!ctx.request && !ctx.response) return diagnostic(ctx);
    const id = ctx.request && route(ctx.request.url);
    if (!id || !ctx.response) return;
    if (ctx.response.status !== 200) { count(ctx, id, "http-error"); return; }
    try {
        const type = ctx.response.headers.get("Content-Type") || "";
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type);
        if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset[1])) return;
    } catch (_) { return; }
    let bytes;
    try { bytes = new Uint8Array(await ctx.response.arrayBuffer()); }
    catch (_) {
        // 流读取本身失败时无法重建尚未读完的数据；不二次消费或伪造成功响应。
        count(ctx, id, "format");
        return;
    }
    try {
        const result = transform(id, decodeUTF8(bytes));
        if (result.status === "changed") {
            const headers = responseHeaders(ctx.response.headers);
            count(ctx, id, result.status);
            return { body: result.body, headers };
        }
        count(ctx, id, result.status);
        return { body: bytes };
    } catch (_) {
        // 已消费的正文必须回传原字节，包括解析、解码和后续改写异常。
        count(ctx, id, "format");
        return { body: bytes };
    }
}
