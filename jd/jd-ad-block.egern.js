// Egern native JavaScript | 2026-11-02 r1
// Runtime: export default async function(ctx); no Surge globals.
// Navigation references: qsoyq/stash override/ad/jd.stoverride;
// zirawell/R-Store Res/Scripts/AntiAd/jd.js. Device behavior remains unverified.
const VERSION = "eg-native-20261102-r2-silent";
const STORE = "skernelx_jd_native_diag_v1";
const NAV_IDS = ["index", "messagenew", "cart", "home"];
const VIDEO_LABELS = ["逛", "逛逛", "视频", "短视频"];

function readState(ctx) {
    try { return ctx.storage.getJSON(STORE) || {}; } catch (_) { return {}; }
}

function safeKeys(value) {
    return value && typeof value === "object" && !Array.isArray(value) ?
        Object.keys(value).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(key)).slice(0, 20) : [];
}

function saveState(ctx, patch) {
    const old = readState(ctx);
    const state = old.version === VERSION ? old : {};
    const next = { ...state, ...patch, version: VERSION, appVersion: ctx.app && ctx.app.version,
        at: new Date().toISOString() };
    try { ctx.storage.setJSON(STORE, next); } catch (_) { /* Diagnostics never block responses. */ }
    return next;
}

function showDiagnostics(ctx) {
    const s = readState(ctx);
    const messages = ["诊断脚本版本：" + VERSION];
    if (s.version !== VERSION) messages.push("本版尚未记录到京东接口响应。不能据此判定是证书、接管还是应用缓存问题。");
    else {
        messages.push("已接到接口响应：" + (s.responses || 0) + " 次；最近接口：" + (s.lastApi || "未知"));
        messages.push("最近处理：" + (s.lastStatus || "未处理"));
        messages.push("导航接口命中：" + (s.navHits || 0) + " 次；最近导航结果：" + (s.navStatus || "尚未接到导航配置"));
        messages.push("最近导航移除项数：" + (s.navRemoved || 0));
        if (s.seenApis) messages.push("已见接口名：" + s.seenApis.join(", "));
        if (s.navPaths) messages.push("导航数组位置：" + s.navPaths.join(", "));
        if (s.topKeys) messages.push("最近目标响应键名：" + s.topKeys.join(", "));
        messages.push("记录时间：" + (s.at || "未知"));
    }
    console.log(messages.join("\n"));
}

async function getFunctionId(request) {
    const find = text => {
        const m = String(text || "").match(/(?:[?&]|^)functionId=([A-Za-z][A-Za-z0-9_]{0,63})(?:&|$)/);
        return m ? m[1] : "";
    };
    let id = find(request.url);
    if (id || String(request.method).toUpperCase() !== "POST") return id;
    // Some requests carry functionId in a form/JSON POST body instead of the URL.
    // Never persist this body or its parameter values.
    try {
        const text = await request.text();
        id = find(text);
        if (!id) {
            const obj = JSON.parse(text);
            if (obj && typeof obj.functionId === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(obj.functionId)) id = obj.functionId;
        }
    } catch (_) {}
    return id;
}

function setExisting(root, path, value) {
    const parts = path.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!node || typeof node !== "object") return;
        node = node[parts[i]];
    }
    if (node && typeof node === "object" && Object.prototype.hasOwnProperty.call(node, parts[parts.length - 1])) node[parts[parts.length - 1]] = value;
}

function navigation(data) {
    const candidates = [
        ["nodeMap", data.nodeMap, false],
        ["result.modeMap", data.result && data.result.modeMap, true]
    ];
    let removed = 0;
    let recognized = 0;
    const paths = [];
    for (const [prefix, modes, allowIds] of candidates) {
        if (!modes || typeof modes !== "object") continue;
        for (const mode of ["normal", "dark"]) {
            const config = modes[mode];
            if (!config || !Array.isArray(config.navigationAll)) continue;
            paths.push(prefix + "." + mode + ".navigationAll");
            const original = config.navigationAll;
            if (!original.every(item => item && typeof item === "object" && !Array.isArray(item))) continue;
            let kept;
            if (original.some(item => typeof item.cutLabelName === "string")) {
                kept = original.filter(item => !VIDEO_LABELS.includes(item.cutLabelName));
                if (kept.length < 2) continue;
            } else if (allowIds && original.every(item => typeof item.functionId === "string")) {
                kept = original.filter(item => NAV_IDS.includes(item.functionId));
                if (!["index", "cart", "home"].every(id => kept.some(item => item.functionId === id))) continue;
            } else continue;
            recognized++;
            removed += original.length - kept.length;
            config.navigationAll = kept;
        }
    }
    return { removed, paths, status: removed ? "已改写导航列表" :
        (recognized ? "已识别列表，未发现可移除项" : (paths.length ? "数组结构未识别，保留原响应" : "未见已知导航数组，保留原响应")) };
}

function clean(data, api) {
    if (api === "start") {
        if (Array.isArray(data.images)) data.images = [];
        if (typeof data.showTimesDaily === "number") data.showTimesDaily = 0;
    } else if (api === "welcomeHome") {
        const types = ["bottomXview", "float", "photoCeiling", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"];
        if (Array.isArray(data.floorList)) data.floorList = data.floorList.filter(f => !f || !types.includes(f.type));
        if (Array.isArray(data.webViewFloorList)) data.webViewFloorList = [];
    } else if (api === "deliverLayer") {
        delete data.bannerInfo;
        if (Array.isArray(data.floors)) data.floors = data.floors.filter(f => !f || !["banner", "jdDeliveryBanner"].includes(f.mId));
    } else if (api === "basicConfig") {
        for (const root of [data, data.data]) {
            if (!root || typeof root !== "object") continue;
            setExisting(root, "JDMessage.socketmonitor.isSocketEstablishedAhead", 0);
            setExisting(root, "JDMessage.socketmonitor.isSocketReport", 0);
            setExisting(root, "JDHttpToolKit.httpdns.httpdns", 0);
        }
    } else if (api === "cart") {
        if (data.cartLocationMap && typeof data.cartLocationMap === "object") delete data.cartLocationMap.loc_emptyCartFloor2;
        delete data.emptyCartRecommendFloor;
    } else if (api === "secondFloor") {
        if (data.data && typeof data.data === "object") delete data.data.recommendFloor;
    }
}

export default async function(ctx) {
    if (!ctx.response) { showDiagnostics(ctx); return; }
    const request = ctx.request;
    if (!request || !/^https?:\/\/api\.m\.jd\.com\/client\.action(?:\?|$)/i.test(request.url)) return;
    const api = await getFunctionId(request);
    const previous = readState(ctx);
    const old = previous.version === VERSION ? previous : {};
    const seen = Array.isArray(old.seenApis) ? old.seenApis.slice() : [];
    if (api && !seen.includes(api)) seen.push(api);
    const base = { responses: (old.responses || 0) + 1, lastApi: api || "未取得functionId", seenApis: seen.slice(-20) };
    const targets = ["start", "welcomeHome", "deliverLayer", "basicConfig", "cart", "secondFloor", "lite_advertising", "readCustomSurfaceList"];
    if (!targets.includes(api)) { saveState(ctx, { ...base, lastStatus: "非目标接口，原样放行" }); return; }
    let body;
    try { body = await ctx.response.text(); }
    catch (_) { saveState(ctx, { ...base, lastStatus: "响应流读取失败" }); return; }
    try {
        if (api === "lite_advertising") {
            const rewritten = body.split("jdLiteAdvertisingVO").join("sooyaaabo");
            saveState(ctx, { ...base, lastStatus: rewritten === body ? "无需改写" : "已改写极速版广告字段" });
            return { body: rewritten };
        }
        const data = JSON.parse(body);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not-object");
        let nav;
        if (api === "readCustomSurfaceList") nav = navigation(data);
        else clean(data, api);
        const rewritten = JSON.stringify(data);
        const changed = rewritten !== JSON.stringify(JSON.parse(body));
        const patch = { ...base, lastStatus: changed ? "响应字段已改写" : "已执行，无字段变化", topKeys: safeKeys(data) };
        if (nav) {
            Object.assign(patch, { navHits: (old.navHits || 0) + 1, navStatus: nav.status, navRemoved: nav.removed, navPaths: nav.paths });
        }
        saveState(ctx, patch);
        console.log("[京东原生 " + VERSION + "] " + api + ": " + (nav ? nav.status + ", removed=" + nav.removed : patch.lastStatus));
        return { body: changed ? rewritten : body };
    } catch (_) {
        const patch = { ...base, lastStatus: "非JSON或处理失败，保留原响应" };
        if (api === "readCustomSurfaceList") Object.assign(patch, { navHits: (old.navHits || 0) + 1, navStatus: "导航响应无法按JSON处理", navRemoved: 0, navPaths: [] });
        saveState(ctx, patch);
        // The stream has been consumed, so always return the saved body on errors.
        return { body };
    }
}
