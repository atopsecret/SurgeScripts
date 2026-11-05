// Engine | Egern 原生 API（2026-11-05） | JavaScript ES module
// Build: node --input-type=module --check < xianyu/xianyu-ad-block.egern.js
// Run: Egern 导入 xianyu-adblock.egern.yaml；离线 node --test xianyu/tests/egern.test.cjs
// Deps: 无；离线测试需要 Node.js 20+
// 来源：本目录 Surge 去广告实现；保留 skernelx 作者署名。
const VERSION = "eg-native-20261105-r1";
const DIAG_KEY = "skernelx_xianyu_native_diag_v1";
const SPLASH = /^mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads$/;
const TARGET = /^(?:mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads|mtop\.idle\.idleadv\.(?:app\.launch\.report|scene\.restore)|mtop\.idle\.ad\.expose|mtop\.taobao\.idle\.user\.strategy\.list|mtop\.taobao\.idlehome\.home\.circle\.list)$/;
const CONTAINERS = new Set(["adMap", "ads", "splashAds", "advertising", "adList", "splashList", "dspList"]);

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function load(ctx) {
    try {
        const saved = ctx.storage.getJSON(DIAG_KEY);
        return record(saved) && saved.version === VERSION ? saved : {};
    } catch (_) { return {}; }
}

function save(ctx, value) {
    try { ctx.storage.setJSON(DIAG_KEY, { ...value, version: VERSION, at: new Date().toISOString() }); }
    catch (_) { /* 只记录状态与数量，存储失败不影响响应。 */ }
}

function diagnostics(ctx) {
    const state = load(ctx);
    const lines = ["闲鱼原生版本：" + VERSION];
    if (!state.at) lines.push("尚未记录到本版本目标接口；模块导入不代表接口已命中。");
    else {
        lines.push("目标命中：" + (state.hits || 0) + " 次；开屏命中：" + (state.splashHits || 0) + " 次");
        lines.push("最近接口：" + state.api + "；状态：" + state.status);
        lines.push("最近移除：" + (state.lastCleaned || 0) + " 项；累计：" + (state.cleaned || 0) + " 项");
        lines.push("记录时间：" + state.at);
    }
    console.log(lines.join("\n"));
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

function stripAds(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return 0;
    let removed = 0;
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (key === "cacheAd" && typeof value === "string" && value.length) {
            node[key] = "";
            removed++;
        } else if (key === "cacheAdInfo" && (record(value) || Array.isArray(value) || typeof value === "string")) {
            delete node[key];
            removed++;
        } else if (CONTAINERS.has(key) && (Array.isArray(value) || record(value))) {
            if (Object.keys(value).length) {
                node[key] = Array.isArray(value) ? [] : {};
                removed++;
            }
        } else if (value && typeof value === "object") removed += stripAds(value, depth + 1);
    }
    return removed;
}

function failed(root) {
    if (root.success === false) return true;
    if (!Object.prototype.hasOwnProperty.call(root, "ret")) return false;
    // ret 的非数组、空数组和失败条目都保留，绝不伪造 SUCCESS。
    return !Array.isArray(root.ret) || !root.ret.length || root.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
}

function clean(api, data) {
    if (SPLASH.test(api)) return stripAds(data);
    if (!record(data)) return 0;
    if (api === "mtop.taobao.idle.user.strategy.list" && Array.isArray(data.strategies)) {
        const before = data.strategies.length;
        data.strategies = data.strategies.filter(item => !record(item) || !["FLOAT_LAYER", "POPUP", "MODAL", "BANNER"].includes(item.type));
        return before - data.strategies.length;
    }
    if (api === "mtop.taobao.idlehome.home.circle.list" && Array.isArray(data.circleList)) {
        let removed = 0;
        for (const circle of data.circleList) {
            const args = record(circle) && record(circle.trackParams) && circle.trackParams.args;
            if (!record(args)) continue;
            for (const key of Object.keys(args)) {
                if (key.startsWith("idleAds")) { delete args[key]; removed++; }
            }
        }
        return removed;
    }
    // 上报和场景恢复仅清理已知容器；服务端 ret、api、v 与未知字段保留。
    return /^mtop\.idle\./.test(api) ? stripAds(data) : 0;
}

export default async function(ctx) {
    if (!ctx.response) { if (!ctx.request) return diagnostics(ctx); return; }
    let api;
    try {
        const url = new URL(ctx.request.url);
        if (!["http:", "https:"].includes(url.protocol) || !/^(?:acs|g-acs|gw)\.m\.(?:goofish|taobao)\.com$/.test(url.hostname) || url.username || url.password) return;
        const match = /^\/(?:gw|h5)\/(mtop\.[A-Za-z0-9.]+)(?:\/|$)/.exec(url.pathname);
        if (!match || !TARGET.test(match[1])) return;
        api = match[1];
    } catch (_) { return; }
    const old = load(ctx);
    const state = {
        hits: (Number(old.hits) || 0) + 1,
        splashHits: (Number(old.splashHits) || 0) + (SPLASH.test(api) ? 1 : 0),
        cleaned: Number(old.cleaned) || 0,
        lastCleaned: 0,
        api,
        status: "未处理"
    };
    if (ctx.response.status < 200 || ctx.response.status >= 300) {
        save(ctx, { ...state, status: "HTTP 错误，未读取正文" });
        return;
    }
    let body;
    try { body = await ctx.response.text(); }
    catch (_) { save(ctx, { ...state, status: "正文读取失败，未改写" }); return; }
    let output = body;
    try {
        const root = JSON.parse(body);
        if (!record(root)) throw new Error("unknown-structure");
        if (failed(root)) state.status = "服务端错误或未知 ret，保留";
        else {
            const stringData = typeof root.data === "string";
            const data = stringData ? JSON.parse(root.data) : root.data;
            let removed = clean(api, data);
            if (SPLASH.test(api)) removed += stripAds(root);
            if (removed) {
                if (stringData) root.data = JSON.stringify(data);
                output = JSON.stringify(root);
                state.status = "已改写";
                state.lastCleaned = removed;
                state.cleaned += removed;
            } else state.status = "未见可改写字段，保留";
        }
    } catch (_) { state.status = "无效 JSON 或未知结构，保留"; }
    save(ctx, state);
    // 读完正文后，无论解析或诊断存储是否成功，都返回保存的完整正文。
    return { body: output };
}
