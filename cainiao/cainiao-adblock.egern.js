// Engine | Egern 原生脚本 API | JavaScript ES module
// Build: node cainiao/build.mjs
// Run: 导入 cainiao/cainiao-adblock.egern.yaml
// Deps: 无；纯策略由 cainiao-policy.js 构建时内联
// Engine | JavaScript ES2020+ | 菜鸟双端共用纯策略
// Build: node cainiao/build.mjs
// Run: 由 Surge 和 Egern 响应脚本在构建时内联
// Deps: 无；不访问网络或存储
// 来源：固定 Kelee 菜鸟活动规则；保留未知物流结构。
const CAINIAO_POLICY = (() => {
    const VERSION = "1.1.0";
    const PAGE_API = "mtop.cainiao.app.e2e.engine.page.fetch";
    const LONGQUAN_API = "mtop.com.cainiao.longquan.place.getpageresourcecontent.cn";
    const HOSTS = new Set([
        "cn-acs.m.cainiao.com",
        "e2e-mtop.cainiao.com",
        "longquan-mtop.cainiao.com",
    ]);

    function record(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function route(urlText) {
        let url;
        try { url = new URL(urlText); } catch (_) { return null; }
        if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password) return null;
        const path = url.pathname;
        const page = /^\/gw\/(mtop\.cainiao\.app\.e2e\.engine\.page\.fetch(?:\.cn)?)(?:\/[0-9]+(?:\.[0-9]+)*)?\/?$/.exec(path);
        if (page && (url.hostname === "cn-acs.m.cainiao.com" || url.hostname === "e2e-mtop.cainiao.com")) {
            const api = page[1];
            return { api, kind: "page", pageCn: api.endsWith(".cn"), host: url.hostname };
        }
        const longquan = /^\/gw\/(mtop\.com\.cainiao\.longquan\.place\.getpageresourcecontent\.cn)(?:\/[0-9]+(?:\.[0-9]+)*)?\/?$/.exec(path);
        if (longquan && url.hostname === "longquan-mtop.cainiao.com") {
            return { api: longquan[1], kind: "longquan", pageCn: false, host: url.hostname };
        }
        return null;
    }

    function failed(root) {
        if (root.success === false || root.isSuccess === false) return true;
        if (Object.prototype.hasOwnProperty.call(root, "code") && root.code !== null && root.code !== "" && ![0, "0", 200, "200"].includes(root.code)) return true;
        if (!Object.prototype.hasOwnProperty.call(root, "ret")) return false;
        return !Array.isArray(root.ret) || root.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
    }

    function deleteExisting(root, path, allowed) {
        const parts = path.split(".");
        let node = root;
        for (const part of parts.slice(0, -1)) {
            if (!record(node) || !Object.prototype.hasOwnProperty.call(node, part)) return false;
            node = node[part];
        }
        const key = parts[parts.length - 1];
        if (!record(node) || !Object.prototype.hasOwnProperty.call(node, key)) return false;
        if (!allowed(node[key])) return false;
        delete node[key];
        return true;
    }

    function clean(routeInfo, root) {
        if (!record(root)) return 0;
        let removed = 0;
        const container = value => record(value) || Array.isArray(value);
        if (routeInfo.kind === "page") {
            removed += Number(deleteExisting(root, "data.data.data.mainSearch.bizData.searchContents", Array.isArray));
            removed += Number(deleteExisting(root, "data.data.data.operationList", Array.isArray));
            // 仅 e2e 的 .fetch.cn 别名额外处理三个已知运营容器。
            if (routeInfo.pageCn && routeInfo.host === "e2e-mtop.cainiao.com") {
                removed += Number(deleteExisting(root, "data.data.banner", container));
                removed += Number(deleteExisting(root, "data.data.activity", container));
                removed += Number(deleteExisting(root, "data.data.vip", container));
            }
        } else if (routeInfo.kind === "longquan") {
            removed += Number(deleteExisting(root, "data.result.placeContentMap.780001.contentList", Array.isArray));
        }
        return removed;
    }

    // 严格 UTF-8 解码；无效字节保持原响应，不替换成 U+FFFD 后改写。
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

    return { VERSION, PAGE_API, LONGQUAN_API, record, route, failed, clean, decodeUTF8 };
})();
const P = CAINIAO_POLICY;
const VERSION = "eg-native-20261108-" + P.VERSION;
const { PAGE_API, LONGQUAN_API, record, route, failed, clean, decodeUTF8 } = P;
const STORE = "skernelx_cainiao_native_diag_v1";
const STATUSES = ["changed", "unchanged", "format", "server-error", "http-error"];
const ROUTES = [PAGE_API, PAGE_API + ".cn", LONGQUAN_API];
const STATUS_TEXT = { changed: "已改写", unchanged: "未见可改写字段", format: "格式或改写异常，保留", "server-error": "服务端错误，保留", "http-error": "非 HTTP 200，未读取正文" };

function load(ctx) {
    const state = { routes: {} };
    try {
        const saved = ctx.storage.getJSON(STORE);
        if (!record(saved) || saved.version !== VERSION || !record(saved.routes)) return state;
        for (const api of ROUTES) if (record(saved.routes[api])) {
            state.routes[api] = Object.fromEntries(STATUSES.map(status => [status, number(saved.routes[api][status])]));
        }
        if (ROUTES.includes(saved.api)) state.api = saved.api;
        if (STATUSES.includes(saved.status)) state.status = saved.status;
        if (typeof saved.at === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(saved.at)) state.at = saved.at;
    } catch (_) { /* 诊断不可用不影响正文。 */ }
    return state;
}

function number(value) {
    return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 999999) : 0;
}

function remember(ctx, api, status) {
    try {
        const saved = load(ctx);
        const row = Object.fromEntries(STATUSES.map(key => [key, number(saved.routes[api] && saved.routes[api][key])]));
        row[status] = Math.min(row[status] + 1, 999999);
        saved.routes[api] = row;
        ctx.storage.setJSON(STORE, { version: VERSION, routes: saved.routes, api, status, at: new Date().toISOString() });
    } catch (_) { /* 诊断计数是旁路功能。 */ }
}

function diagnostic(ctx) {
    const saved = load(ctx);
    const lines = ["菜鸟原生版本：" + VERSION];
    if (!saved.at) lines.push("尚未记录到本版本目标接口；模块导入不代表接口已命中。");
    else {
        lines.push("最近接口：" + (saved.api || "未知") + "；状态：" + (STATUS_TEXT[saved.status] || "未知"));
        lines.push("记录时间：" + saved.at);
    }
    for (const api of ROUTES) {
        const row = saved.routes[api] || {};
        lines.push(api + "：已改写=" + number(row.changed) + "，无变化=" + number(row.unchanged) + "，格式放行=" + number(row.format) + "，错误放行=" + (number(row["server-error"]) + number(row["http-error"])));
    }
    lines.push("以上仅统计三个页面响应结构；广告域名、URL 和 Map Local 拦截请查看请求日志。");
    lines.push("模块另含广告 SDK 与菜鸟 UA 素材规则；查件、寄件、取件码和订单不在处理范围。");
    console.log(lines.join("\n"));
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

function responseHeaders(input) {
    const stale = ["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5", "cache-control", "digest", "content-digest", "repr-digest"];
    const values = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Cainiao-Cleaner-Version": VERSION,
    };
    const names = [...new Set([...stale, ...Object.keys(values).map(name => name.toLowerCase())])];
    const before = names.map(name => [name, typeof input.getAll === "function" ? input.getAll(name) : (input.get(name) === null ? [] : [input.get(name)])]);
    try {
        for (const name of stale) input.delete(name);
        for (const [name, value] of Object.entries(values)) input.set(name, value);
        return input;
    } catch (error) {
        for (const [name, saved] of before) {
            try { input.delete(name); for (const value of saved) input.append(name, value); } catch (_) {}
        }
        throw error;
    }
}

export { VERSION, route, clean, decodeUTF8 };

export default async function(ctx) {
    if (!ctx.request && !ctx.response) return diagnostic(ctx);
    if (!ctx.request || !ctx.response) return;
    const routeInfo = route(ctx.request.url);
    if (!routeInfo) return;
    if (ctx.response.status !== 200) {
        remember(ctx, routeInfo.api, "http-error");
        return;
    }
    try {
        const type = ctx.response.headers.get("Content-Type") || "";
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type);
        if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset[1])) return;
        if (type && !/^\s*(?:application\/(?:[\w.+-]+\+)?json|text\/json)\s*(?:;|$)/i.test(type)) return;
    } catch (_) { return; }
    let bytes;
    try { bytes = new Uint8Array(await ctx.response.arrayBuffer()); }
    catch (_) {
        remember(ctx, routeInfo.api, "format");
        return;
    }
    let output = bytes;
    let status = "unchanged";
    try {
        const text = decodeUTF8(bytes);
        const root = JSON.parse(text);
        if (!record(root)) throw new Error("unknown-structure");
        if (failed(root)) status = "server-error";
        else {
            const before = JSON.stringify(root);
            const removed = clean(routeInfo, root);
            const changed = JSON.stringify(root);
            if (removed && changed !== before) {
                output = changed;
                status = "changed";
            }
        }
    } catch (_) { status = "format"; }
    if (status === "changed") {
        try {
            const headers = responseHeaders(ctx.response.headers);
            remember(ctx, routeInfo.api, status);
            return { body: output, headers };
        } catch (_) { remember(ctx, routeInfo.api, "format"); return { body: bytes }; }
    }
    remember(ctx, routeInfo.api, status);
    return { body: output };
}
