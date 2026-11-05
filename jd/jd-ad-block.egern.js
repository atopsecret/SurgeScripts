// Engine | Egern 原生 API（2026-11-05） | JavaScript ES module
// Build: node --input-type=module --check < jd/jd-ad-block.egern.js
// Run: Egern 导入 jd-adblock.egern.yaml；离线 node --test jd/tests/egern.test.cjs
// Deps: 无；离线测试需要 Node.js 20+
// 来源：Thelongdarkorg/loon-plugins；导航参考 qsoyq/stash、zirawell/R-Store。
const VERSION = "eg-native-20261105-r1";
const STORE = "skernelx_jd_native_diag_v1";
const TARGETS = new Set(["start", "welcomeHome", "deliverLayer", "basicConfig", "cart", "secondFloor", "lite_advertising", "readCustomSurfaceList"]);
const NAV_IDS = ["index", "messagenew", "cart", "home"];
const VIDEO_LABELS = ["逛", "逛逛", "视频", "短视频"];
const WELCOME_TYPES = ["bottomXview", "float", "photoCeiling", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"];

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readState(ctx) {
    try {
        const saved = ctx.storage.getJSON(STORE);
        return record(saved) && saved.version === VERSION ? saved : {};
    } catch (_) { return {}; }
}

function saveState(ctx, state) {
    try {
        ctx.storage.setJSON(STORE, { ...state, version: VERSION, at: new Date().toISOString() });
    } catch (_) { /* 诊断存储失败不阻断业务响应。 */ }
}

function diagnostics(ctx) {
    const state = readState(ctx);
    const lines = ["京东原生版本：" + VERSION];
    if (!state.at) lines.push("尚未记录到本版本目标接口；这不等于证书或模块正常。");
    else {
        lines.push("目标接口命中：" + (state.hits || 0) + " 次；最近接口：" + state.api);
        lines.push("最近状态：" + state.status);
        if (state.navStatus) lines.push("导航：" + state.navStatus + "；移除：" + (state.navRemoved || 0) + " 项");
        lines.push("记录时间：" + state.at);
    }
    console.log(lines.join("\n"));
    return { type: "widget", padding: 12, children: [{ type: "text", text: lines.join("\n") }] };
}

function uniqueId(params) {
    const values = params.getAll("functionId");
    return values.length === 1 && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(values[0]) ? values[0] : "";
}

async function functionId(request, url) {
    // 已有查询参数（即使非法或重复）不再用 POST 正文替它猜测。
    if (url.searchParams.has("functionId")) return uniqueId(url.searchParams);
    if (String(request.method).toUpperCase() !== "POST" || typeof request.text !== "function") return "";
    try {
        const body = await request.text();
        if (body.trimStart().startsWith("{")) {
            const json = JSON.parse(body);
            return record(json) && typeof json.functionId === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(json.functionId) ? json.functionId : "";
        }
        return uniqueId(new URLSearchParams(body));
    } catch (_) { return ""; }
}

function failed(data) {
    if (data.success === false || data.isSuccess === false) return true;
    // 仅接受已知的 0/200 成功码格式；其它状态不推定成功，保守放行。
    if (Object.prototype.hasOwnProperty.call(data, "code") && data.code !== null && data.code !== "" && ![0, "0", 200, "200"].includes(data.code)) return true;
    return Array.isArray(data.ret) && data.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
}

function setExisting(root, path, value) {
    const parts = path.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
        if (!record(node)) return;
        node = node[part];
    }
    const key = parts[parts.length - 1];
    if (record(node) && Object.prototype.hasOwnProperty.call(node, key)) node[key] = value;
}

function navigation(data) {
    const candidates = [[data.nodeMap, false], [record(data.result) && data.result.modeMap, true]];
    let removed = 0;
    let recognized = 0;
    for (const [modes, allowIds] of candidates) {
        if (!record(modes)) continue;
        for (const mode of ["normal", "dark"]) {
            const config = modes[mode];
            if (!record(config) || !Array.isArray(config.navigationAll)) continue;
            const original = config.navigationAll;
            if (!original.every(record)) continue;
            let kept;
            if (original.every(item => typeof item.cutLabelName === "string")) {
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
    return { removed, status: removed ? "已改写" : recognized ? "已识别，未见视频入口" : "未知结构，保留" };
}

function renameLiteFields(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 12) return;
    for (const key of Object.keys(node)) {
        // 只改字段名，不改说明文字、商品名称或其它字段的字符串值。
        if (key === "jdLiteAdvertisingVO" && !Object.prototype.hasOwnProperty.call(node, "sooyaaabo")) {
            node.sooyaaabo = node[key];
            delete node[key];
        } else if (node[key] && typeof node[key] === "object") renameLiteFields(node[key], depth + 1);
    }
}

function clean(data, api) {
    if (api === "start") {
        if (Array.isArray(data.images)) data.images = [];
        if (typeof data.showTimesDaily === "number") data.showTimesDaily = 0;
    } else if (api === "welcomeHome") {
        if (Array.isArray(data.floorList)) data.floorList = data.floorList.filter(item => !record(item) || !WELCOME_TYPES.includes(item.type));
        if (Array.isArray(data.webViewFloorList)) data.webViewFloorList = [];
    } else if (api === "deliverLayer") {
        delete data.bannerInfo;
        if (Array.isArray(data.floors)) data.floors = data.floors.filter(item => !record(item) || !["banner", "jdDeliveryBanner"].includes(item.mId));
    } else if (api === "basicConfig") {
        for (const root of [data, data.data]) {
            setExisting(root, "JDMessage.socketmonitor.isSocketEstablishedAhead", 0);
            setExisting(root, "JDMessage.socketmonitor.isSocketReport", 0);
            setExisting(root, "JDHttpToolKit.httpdns.httpdns", 0);
        }
    } else if (api === "cart") {
        if (record(data.cartLocationMap)) delete data.cartLocationMap.loc_emptyCartFloor2;
        delete data.emptyCartRecommendFloor;
    } else if (api === "secondFloor") {
        if (record(data.data)) delete data.data.recommendFloor;
    } else if (api === "lite_advertising") renameLiteFields(data);
}

export default async function(ctx) {
    if (!ctx.response) { if (!ctx.request) return diagnostics(ctx); return; }
    let url;
    try {
        url = new URL(ctx.request.url);
        if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "api.m.jd.com" || url.pathname !== "/client.action" || url.username || url.password) return;
    } catch (_) { return; }
    const api = await functionId(ctx.request, url);
    if (!TARGETS.has(api)) return;
    const old = readState(ctx);
    const state = { hits: (Number(old.hits) || 0) + 1, api, status: "未处理" };
    if (ctx.response.status < 200 || ctx.response.status >= 300) {
        saveState(ctx, { ...state, status: "HTTP 错误，未读取正文" });
        return;
    }
    let body;
    try { body = await ctx.response.text(); }
    catch (_) { saveState(ctx, { ...state, status: "正文读取失败，未改写" }); return; }
    let output = body;
    try {
        const data = JSON.parse(body);
        if (!record(data)) throw new Error("unknown-structure");
        if (failed(data)) state.status = "服务端错误或陌生状态码，保留";
        else {
            const before = JSON.stringify(data);
            if (api === "readCustomSurfaceList") {
                const nav = navigation(data);
                state.navStatus = nav.status;
                state.navRemoved = nav.removed;
            } else clean(data, api);
            const changed = JSON.stringify(data);
            if (changed !== before) { output = changed; state.status = "已改写"; }
            else state.status = "未见可改写字段，保留";
        }
    } catch (_) { state.status = "无效 JSON 或未知结构，保留"; }
    saveState(ctx, state);
    // Egern 正文只能读取一次；解析、处理或存储失败都显式返回保存的原文。
    return { body: output };
}
