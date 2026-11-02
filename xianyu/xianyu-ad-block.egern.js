/* 闲鱼去广告：Egern 原生响应脚本；同文件可作为 generic 脚本查看本地诊断。 */
const VERSION = "eg-native-20261102-r1";
const DIAG_KEY = "skernelx_xianyu_native_diag_v1";
const SPLASH = /^mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads$/;
const TARGET = /^(?:mtop\.taobao\.idlecommerce\.splash\.(?:async\.)?ads|mtop\.idle\.idleadv\.(?:app\.launch\.report|scene\.restore)|mtop\.idle\.ad\.expose|mtop\.taobao\.idle\.user\.strategy\.list|mtop\.taobao\.idlehome\.home\.circle\.list)$/;
const CONTAINERS = new Set(["adMap", "ads", "splashAds", "advertising", "adList", "splashList", "dspList"]);

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value) {
    return record(value) ? Object.keys(value).filter(k => /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(k)).slice(0, 20) : [];
}

function load(ctx) {
    try {
        const saved = ctx.storage.getJSON(DIAG_KEY);
        return record(saved) && saved.version === VERSION ? saved : null;
    } catch (_) { return null; }
}

function save(ctx, value) {
    try { ctx.storage.setJSON(DIAG_KEY, value); return true; }
    catch (_) { return false; }
}

function notify(ctx, subtitle, body) {
    try { ctx.notify({ title: "闲鱼原生脚本诊断", subtitle, body, sound: false }); }
    catch (_) { /* 通知失败不影响响应。 */ }
}

function stripAds(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 6) return 0;
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
        } else if (value && typeof value === "object") {
            removed += stripAds(value, depth + 1);
        }
    }
    return removed;
}

function clean(api, data) {
    if (SPLASH.test(api)) return stripAds(data);
    if (!record(data)) return 0;
    if (api === "mtop.taobao.idle.user.strategy.list" && Array.isArray(data.strategies)) {
        const before = data.strategies.length;
        data.strategies = data.strategies.filter(s => !record(s) || !["FLOAT_LAYER", "POPUP", "MODAL", "BANNER"].includes(s.type));
        return before - data.strategies.length;
    }
    if (api === "mtop.taobao.idlehome.home.circle.list" && Array.isArray(data.circleList)) {
        let removed = 0;
        for (const circle of data.circleList) {
            const args = circle && circle.trackParams && circle.trackParams.args;
            if (!record(args)) continue;
            for (const key of Object.keys(args)) {
                if (key.startsWith("idleAds")) { delete args[key]; removed++; }
            }
        }
        return removed;
    }
    // 上报/恢复接口仅清理已知广告容器，保留服务端 ret、api、v 与错误信息。
    if (/^mtop\.idle\./.test(api)) return stripAds(data);
    return 0;
}

export default async function(ctx) {
    if (!ctx.response) {
        const diag = load(ctx);
        const statusName = value => ({ changed: "已改写", unchanged: "未见可改写字段", "parse-failed": "解析或读取失败，未改写" }[value] || "尚未接到");
        notify(ctx, VERSION, diag
            ? `Egern版本：${ctx.app && ctx.app.version || "未知"}\n已接到MTOP响应：${diag.observed || 0}次；已知目标接口：${diag.hits || 0}次\n最近接口：${diag.lastObservedApi || diag.api || "未知"}\n开屏命中：${diag.splashHits || 0}次；最近开屏状态：${statusName(diag.splashStatus)}；最近开屏清理：${diag.splashCleaned || 0}项\n目标接口累计清理：${diag.cleaned || 0}项\n已见接口名：${(diag.seenApis || []).join(", ")}\n顶层键：${(diag.topKeys || []).join(", ")}\ndata键：${(diag.dataKeys || []).join(", ")}`
            : `Egern版本：${ctx.app && ctx.app.version || "未知"}\n本版本暂无网关接口命中记录（或本地存储不可用）。`);
        return;
    }

    let api;
    try {
        const url = new URL(ctx.request.url);
        if (!/^(?:acs|g-acs|gw)\.m\.(?:goofish|taobao)\.com$/.test(url.hostname)) return;
        const match = /^\/(?:gw|h5)\/(mtop\.[a-zA-Z0-9.]+)(?:\/|$)/.exec(url.pathname);
        if (!match) return;
        api = match[1];
    } catch (_) { return; }

    const previous = load(ctx) || {};
    const seenApis = Array.isArray(previous.seenApis) ? previous.seenApis.slice() : [];
    if (!seenApis.includes(api)) seenApis.push(api);
    const observation = {
        ...previous,
        version: VERSION,
        observed: (Number(previous.observed) || 0) + 1,
        lastObservedApi: api,
        seenApis: seenApis.slice(-20)
    };
    // 新接口只记录名称和计数，不读取或改写消息、交易等非目标响应。
    if (!TARGET.test(api)) { save(ctx, observation); return; }
    const diag = {
        ...observation,
        api,
        hits: (Number(previous.hits) || 0) + 1,
        status: "unchanged",
        cleaned: Number(previous.cleaned) || 0,
        lastCleaned: 0,
        topKeys: [],
        dataKeys: [],
        notified: Boolean(previous.notified)
    };
    if (SPLASH.test(api)) {
        diag.splashHits = (Number(previous.splashHits) || 0) + 1;
        diag.splashStatus = "unchanged";
        diag.splashCleaned = 0;
    }
    let body;
    try { body = await ctx.response.text(); }
    catch (_) {
        diag.status = "parse-failed";
        if (SPLASH.test(api)) diag.splashStatus = diag.status;
        save(ctx, diag);
        return;
    }
    let output = body;
    try {
        // JSONP 不尝试剥离或重构；解析失败时完整返回已经读取的原文。
        const root = JSON.parse(body);
        diag.topKeys = keys(root);
        if (record(root)) {
            const stringData = typeof root.data === "string";
            const data = stringData ? JSON.parse(root.data) : root.data;
            diag.dataKeys = keys(data);
            const failed = Array.isArray(root.ret) && root.ret.some(r => typeof r !== "string" || !r.startsWith("SUCCESS::"));
            if (!failed) {
                let removed = clean(api, data);
                if (SPLASH.test(api)) removed += stripAds(root);
                if (removed) {
                    root.data = stringData ? JSON.stringify(data) : data;
                    output = JSON.stringify(root);
                    diag.status = "changed";
                    diag.lastCleaned = removed;
                    diag.cleaned += removed;
                }
            }
        }
    } catch (_) { diag.status = "parse-failed"; }

    if (SPLASH.test(api)) {
        diag.splashStatus = diag.status;
        diag.splashCleaned = diag.lastCleaned;
    }
    const shouldNotify = SPLASH.test(api) && ctx.env && ctx.env.NOTIFY_ONCE === "true" && !diag.notified;
    if (shouldNotify) diag.notified = true;
    const stored = save(ctx, diag);
    if (shouldNotify && stored) {
        notify(ctx, VERSION, `已命中开屏接口；${diag.status === "changed" ? `已改写，清理 ${diag.lastCleaned} 个广告容器` : diag.status === "parse-failed" ? "解析失败，保留原响应" : "未改写，保留原响应"}。此记录不代表真机广告已消失。`);
    }
    return { body: output };
}
