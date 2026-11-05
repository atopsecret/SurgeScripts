// Engine | Egern 原生 API（2026-11-05） | JavaScript ES module
// Build: node --input-type=module --check < pinduoduo/pdd-ad-block.egern.js
// Run: Egern 导入 pdd-adblock.egern.yaml；离线 node --test pinduoduo/tests/egern.test.cjs
// Deps: 无；离线测试需要 Node.js 20+
// 来源：Thelongdarkorg/loon-plugins；Loon Hub 的 RuCu6、ZenmoFeiShi、可莉实现。
const VERSION = "eg-native-20261105-r1";
const STORE = "skernelx_pdd_native_diag_v1";
const KEEP_TABS = ["index.html", "chat_list.html", "personal.html"];
const API_HOSTS = ["api.pinduoduo.com", "api.yangkeduo.com"];

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function load(ctx) {
    try {
        const saved = ctx.storage.getJSON(STORE);
        return record(saved) && saved.version === VERSION ? saved : {};
    } catch (_) { return {}; }
}

function save(ctx, state) {
    try { ctx.storage.setJSON(STORE, { ...state, version: VERSION, at: new Date().toISOString() }); }
    catch (_) { /* 本地诊断不可用时仍正常处理响应。 */ }
}

function diagnostics(ctx) {
    const state = load(ctx);
    const lines = [
        "拼多多原生版本：" + VERSION,
        state.at ? "目标命中：" + (state.hits || 0) + " 次；最近接口：" + state.api : "尚未记录到本版本目标接口。",
        state.at ? "状态：" + state.status + "；最近导航移除：" + (state.tabsRemoved || 0) + " 项" : "模块导入不代表广告已消失。"
    ];
    console.log(lines.join("\n"));
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

function header(headers, name) {
    try {
        if (headers && typeof headers.get === "function") return String(headers.get(name) || "");
        if (headers) {
            const key = Object.keys(headers).find(value => value.toLowerCase() === name.toLowerCase());
            return key ? String(headers[key] || "") : "";
        }
    } catch (_) { /* 不根据读取失败的 Host 猜测请求归属。 */ }
    return "";
}

function bareIP(hostname) {
    if (/^\[[0-9a-f:]+\]$/i.test(hostname)) return true;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) && hostname.split(".").every(part => Number(part) <= 255);
}

function owned(request, url) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    if (API_HOSTS.includes(url.hostname)) return true;
    if (!bareIP(url.hostname)) return false;
    // 裸 IP 直连只接受已知 API 的精确 Host；域名子串和 UA 均不能替代它。
    const match = /^(api\.(?:pinduoduo|yangkeduo)\.com)(?::([0-9]{1,5}))?$/.exec(header(request.headers, "host").trim().toLowerCase());
    return Boolean(match && (!match[2] || Number(match[2]) > 0 && Number(match[2]) <= 65535));
}

function apiPath(pathname) {
    const known = new Map([
        ["/api/alexa/homepage/hub", "homepage"],
        ["/api/philo/personal/hub", "personal"],
        ["/api/oak/integration/render", "integration"],
        ["/api/aristotle/order_list_v4", "order-list"],
        ["/search", "search"]
    ]);
    return known.get(pathname) || (pathname.startsWith("/order/") ? "order" : "");
}

function delPath(root, path) {
    const keys = path.split(".");
    let node = root;
    for (const key of keys.slice(0, -1)) {
        if (!record(node)) return;
        node = node[key];
    }
    if (record(node)) delete node[keys[keys.length - 1]];
}

function filterTabs(tabs) {
    if (!Array.isArray(tabs) || !tabs.every(item => record(item) && typeof item.link === "string")) return { tabs, removed: 0 };
    // 只有识别到首页、聊天、个人三个核心入口，才使用原来源的导航白名单。
    // 缺少核心入口、对象类型变化或新协议时整份导航原样保留，避免清空底栏。
    if (!KEEP_TABS.every(link => tabs.some(item => item.link === link))) return { tabs, removed: 0 };
    const kept = tabs.filter(item => KEEP_TABS.includes(item.link));
    return { tabs: kept, removed: tabs.length - kept.length };
}

function failed(data) {
    return data.success === false || data.is_success === false || data.error_code !== undefined && ![0, "0", null, ""].includes(data.error_code);
}

function clean(data, api) {
    let removed = 0;
    if (api === "homepage" && record(data.result)) {
        const root = data.result;
        for (const key of ["bottom_tabs", "buffer_bottom_tabs"]) {
            const filtered = filterTabs(root[key]);
            if (filtered.removed) { root[key] = filtered.tabs; removed += filtered.removed; }
        }
        if (Array.isArray(root.all_top_opts)) {
            for (const option of root.all_top_opts) {
                if (!record(option)) continue;
                for (const key of ["selected_image", "image", "height", "width"]) delete option[key];
            }
        }
        delPath(root, "dy_module.irregular_banner_dy");
        delete root.icon_set;
        delete root.search_bar_hot_query;
    } else if (api === "personal") {
        delete data.monthly_card_entrance;
        delete data.personal_center_style_v2_vo;
        delPath(data, "icon_set.icons");
        delPath(data, "icon_set.top_personal_icons");
    } else if (api === "integration") {
        delete data.bottom_section_list;
        delPath(data, "ui.bottom_section");
        delPath(data, "ui.live_section.float_info");
    } else if (api === "order") {
        delete data.marketing_banner_vo;
        delPath(data, "shipping.banner_above_recommend");
    } else if (api === "order-list" && Array.isArray(data.orders)) {
        for (const order of data.orders) {
            if (!record(order) || !Array.isArray(order.order_buttons)) continue;
            for (const button of order.order_buttons) if (record(button)) delete button.order_growth_tip;
        }
    } else if (api === "search") delete data.expansion;
    return removed;
}

export default async function(ctx) {
    if (!ctx.response) { if (!ctx.request) return diagnostics(ctx); return; }
    let api;
    try {
        const url = new URL(ctx.request.url);
        if (!owned(ctx.request, url)) return;
        api = apiPath(url.pathname);
        if (!api) return;
    } catch (_) { return; }
    const old = load(ctx);
    const state = { hits: (Number(old.hits) || 0) + 1, api, status: "未处理", tabsRemoved: 0 };
    if (ctx.response.status < 200 || ctx.response.status >= 300) {
        save(ctx, { ...state, status: "HTTP 错误，未读取正文" });
        return;
    }
    let body;
    try { body = await ctx.response.text(); }
    catch (_) { save(ctx, { ...state, status: "正文读取失败，未改写" }); return; }
    let output = body;
    try {
        const data = JSON.parse(body);
        if (!record(data)) throw new Error("unknown-structure");
        if (failed(data)) state.status = "服务端错误，保留";
        else {
            const before = JSON.stringify(data);
            state.tabsRemoved = clean(data, api);
            const after = JSON.stringify(data);
            if (after !== before) { output = after; state.status = "已改写"; }
            else state.status = "未见可改写字段，保留";
        }
    } catch (_) { state.status = "无效 JSON 或未知结构，保留"; }
    save(ctx, state);
    // 已消费的响应流不能再次读取，异常与无变化都显式返回保存的原文。
    return { body: output };
}
