// Engine | Egern 原生 API | JavaScript ES module
// Build: node jd/build.mjs
// Run: Egern 导入 jd-adblock.egern.yaml；离线 node --test jd/tests/*.test.cjs
// Deps: 无；策略由 jd-policy.js 构建时内联
// Engine | JavaScript ES2020+ | 京东双端共用纯策略
// Build: node jd/build.mjs
// Run: 由 jd-ad-block.js 或 jd-ad-block.egern.js 内联执行
// Deps: 无；不访问网络
// 来源：Thelongdarkorg/loon-plugins；Kelee 固定镜像与 qsoyq/stash、zirawell/R-Store 底栏结构参考。
const JD_POLICY = (() => {
    const VERSION = "2.0.0";
    const TARGETS = new Set([
        "start", "welcomeHome", "deliverLayer", "basicConfig", "cart", "secondFloor",
        "lite_advertising", "readCustomSurfaceList", "getTabHomeInfo", "myOrderInfo",
        "orderTrackBusiness", "personinfoBusiness"
    ]);
    const VIDEO_LABELS = new Set(["逛", "逛逛", "视频", "短视频"]);
    // 只记录来源样本中明确出现的旧协议视频入口；未知 ID 一律保留。
    const VIDEO_IDS = new Set(["video"]);
    const CORE_IDS = ["index", "cart", "home"];
    const WELCOME_TYPES = new Set(["bottomXview", "float", "photoCeiling", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"]);
    const DELIVER_MIDS = new Set(["banner", "jdDeliveryBanner"]);
    const PAGE_PROMO_FLOORS = new Set(["bigSaleFloor", "buyOften", "newAttentionCard", "newBigSaleFloor", "newStyleAttentionCard", "newsFloor", "noticeFloor", "recommendfloor"]);
    const ALLOWED_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

    function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
    function target(id) { return TARGETS.has(id); }
    function decodePart(value) {
        try {
            return decodeURIComponent(String(value).replace(/\+/g, " "));
        } catch (_) { return null; }
    }
    function rawQueryKeys(query) {
        const output = [];
        if (!query) return output;
        for (const segment of query.split("&")) {
            if (!segment) continue;
            const at = segment.indexOf("=");
            const rawKey = at < 0 ? segment : segment.slice(0, at);
            const rawValue = at < 0 ? "" : segment.slice(at + 1);
            const decodedKey = decodePart(rawKey);
            output.push({ rawKey, rawValue, decodedKey });
        }
        return output;
    }
    function queryIdentity(url) {
        const text = String(url).split("#", 1)[0];
        const question = text.indexOf("?");
        const keys = rawQueryKeys(question < 0 ? "" : text.slice(question + 1));
        const candidates = keys.filter(item => item.rawKey === "functionId");
        const encoded = keys.some(item => item.rawKey !== "functionId" && item.decodedKey === "functionId");
        if (encoded || candidates.length > 1) return { present: true, id: "", invalid: true, source: "query" };
        if (candidates.length === 0) return { present: false, id: "", invalid: false, source: "query" };
        const id = decodePart(candidates[0].rawValue);
        return { present: true, id: id && ALLOWED_ID.test(id) ? id : "", invalid: !id || !ALLOWED_ID.test(id), source: "query" };
    }
    function formIdentity(text) {
        const keys = rawQueryKeys(String(text));
        const candidates = keys.filter(item => item.rawKey === "functionId");
        const encoded = keys.some(item => item.rawKey !== "functionId" && item.decodedKey === "functionId");
        if (encoded || candidates.length !== 1) return { id: "", invalid: true, source: "body" };
        const id = decodePart(candidates[0].rawValue);
        return { id: id && ALLOWED_ID.test(id) ? id : "", invalid: !id || !ALLOWED_ID.test(id), source: "body" };
    }
    function jsonFunctionIdCount(text) {
        const source = String(text); let depth = 0; let count = 0;
        for (let i = 0; i < source.length;) {
            const char = source[i];
            if (char === '"') {
                const start = i++; let escaped = false;
                for (; i < source.length; i++) {
                    const current = source[i];
                    if (escaped) { escaped = false; continue; }
                    if (current === "\\") { escaped = true; continue; }
                    if (current === '"') { i++; break; }
                }
                if (source[i - 1] !== '"') return -1;
                let next = i; while (/\s/.test(source[next] || "")) next++;
                if (depth === 1 && source[next] === ":") {
                    try { if (JSON.parse(source.slice(start, i)) === "functionId") count++; } catch (_) { return -1; }
                }
                continue;
            }
            if (char === "{" || char === "[") depth++;
            else if (char === "}" || char === "]") { depth--; if (depth < 0) return -1; }
            i++;
        }
        return depth === 0 ? count : -1;
    }
    function jsonIdentity(text) {
        // JSON.parse 会吞掉重复键；先对解码后的 JSON 字符串键计数，覆盖 \\u 转义键。
        if (jsonFunctionIdCount(text) !== 1) return { id: "", invalid: true, source: "body" };
        try {
            const value = JSON.parse(text);
            const id = record(value) ? value.functionId : "";
            return { id: typeof id === "string" && ALLOWED_ID.test(id) ? id : "", invalid: !(typeof id === "string" && ALLOWED_ID.test(id)), source: "body" };
        } catch (_) { return { id: "", invalid: true, source: "body" }; }
    }
    function bodyIdentity(text, contentType) {
        const type = String(contentType || "").toLowerCase();
        if (type.includes("json") || String(text).trimStart().startsWith("{")) return jsonIdentity(text);
        return formIdentity(text);
    }
    async function requestIdentity(request, url) {
        const query = queryIdentity(url.href || url.toString());
        if (query.present) return query;
        if (String(request && request.method).toUpperCase() !== "POST" || !request || typeof request.text !== "function") return query;
        try {
            const body = await request.text();
            return bodyIdentity(body, request.headers && request.headers.get ? request.headers.get("content-type") : "");
        } catch (_) { return { id: "", invalid: true, source: "body-read-error" }; }
    }
    function setExisting(root, path, value) {
        if (!record(root)) return;
        const parts = path.split("."); let node = root;
        for (const part of parts.slice(0, -1)) { if (!record(node)) return; node = node[part]; }
        const key = parts[parts.length - 1];
        if (record(node) && Object.prototype.hasOwnProperty.call(node, key)) node[key] = value;
    }
    function navigation(data) {
        const candidates = [[data.nodeMap, false], [record(data.result) && data.result.modeMap, true]];
        let removed = 0, recognized = false;
        for (const [modes, oldIds] of candidates) {
            if (!record(modes)) continue;
            for (const mode of ["normal", "dark"]) {
                const config = modes[mode];
                if (!record(config) || !Array.isArray(config.navigationAll)) continue;
                const original = config.navigationAll;
                if (!original.every(record)) continue;
                let kept;
                const textProtocol = original.every(item => typeof item.cutLabelName === "string");
                if (textProtocol) {
                    kept = original.filter(item => !VIDEO_LABELS.has(item.cutLabelName));
                } else if (oldIds && original.every(item => typeof item.functionId === "string")) {
                    // 旧协议仅删除已被来源样本明确认作视频的 ID，未知入口和顺序全部保留。
                    kept = original.filter(item => !VIDEO_IDS.has(item.functionId));
                } else continue;
                // 文字协议可能使用中文展示名，无法把 index/cart/home 当作同一字段。
                // 旧 ID 协议才检查核心入口；文字协议仅要求至少保留两个导航，避免误清空。
                if (textProtocol ? kept.length < 2 : !CORE_IDS.every(id => kept.some(item => item.functionId === id))) continue;
                recognized = true; removed += original.length - kept.length; config.navigationAll = kept;
            }
        }
        return { removed, recognized };
    }
    function renameLite(node, depth = 0) {
        if (!node || typeof node !== "object" || depth > 12) return;
        for (const key of Object.keys(node)) {
            if (key === "jdLiteAdvertisingVO" && !Object.prototype.hasOwnProperty.call(node, "sooyaaabo")) {
                node.sooyaaabo = node[key]; delete node[key];
            } else if (node[key] && typeof node[key] === "object") renameLite(node[key], depth + 1);
        }
    }
    function clean(data, api) {
        if (api === "start") { if (Array.isArray(data.images)) data.images = []; if (typeof data.showTimesDaily === "number") data.showTimesDaily = 0; }
        else if (api === "welcomeHome") {
            if (Array.isArray(data.floorList)) data.floorList = data.floorList.filter(item => !record(item) || !WELCOME_TYPES.has(item.type));
            if (Array.isArray(data.webViewFloorList)) data.webViewFloorList = [];
        } else if (api === "deliverLayer" || api === "orderTrackBusiness") {
            delete data.bannerInfo; if (Array.isArray(data.floors)) data.floors = data.floors.filter(item => !record(item) || !DELIVER_MIDS.has(item.mId));
        } else if (api === "getTabHomeInfo") {
            if (record(data.result)) { delete data.result.iconInfo; delete data.result.roofTop; }
        } else if (api === "myOrderInfo") {
            if (Array.isArray(data.floors)) data.floors = data.floors.filter(floor => {
                if (!record(floor)) return true;
                if (["bannerFloor", "bpDynamicFloor", "plusFloor"].includes(floor.mId)) return false;
                if (floor.mId === "virtualServiceCenter" && record(floor.data) && Array.isArray(floor.data.virtualServiceCenters)) {
                    for (const group of floor.data.virtualServiceCenters) if (record(group) && Array.isArray(group.serviceList)) group.serviceList = group.serviceList.filter(card => !record(card) || card.serviceTitle !== "精选特惠");
                }
                return true;
            });
        } else if (api === "personinfoBusiness") {
            if (Array.isArray(data.floors)) data.floors = data.floors.filter(floor => {
                if (!record(floor)) return true;
                if (PAGE_PROMO_FLOORS.has(floor.mId)) return false;
                if (floor.mId === "basefloorinfo" && record(floor.data)) {
                    for (const key of ["commonPopup", "commonPopup_dynamic", "floatLayer"]) delete floor.data[key];
                    if (Array.isArray(floor.data.commonTips)) floor.data.commonTips = [];
                    if (Array.isArray(floor.data.commonWindows)) floor.data.commonWindows = [];
                } else if (floor.mId === "userinfo" && record(floor.data)) delete floor.data.newPlusBlackCard;
                return true;
            });
        } else if (api === "basicConfig") {
            for (const root of [data, data.data]) { setExisting(root, "JDMessage.socketmonitor.isSocketEstablishedAhead", 0); setExisting(root, "JDMessage.socketmonitor.isSocketReport", 0); setExisting(root, "JDHttpToolKit.httpdns.httpdns", 0); }
        } else if (api === "cart") { if (record(data.cartLocationMap)) delete data.cartLocationMap.loc_emptyCartFloor2; delete data.emptyCartRecommendFloor;
        } else if (api === "secondFloor") { if (record(data.data)) delete data.data.recommendFloor;
        } else if (api === "lite_advertising") renameLite(data);
        else if (api === "readCustomSurfaceList") navigation(data);
        return data;
    }
    function failed(data) {
        if (data.success === false || data.isSuccess === false) return true;
        if (Object.prototype.hasOwnProperty.call(data, "code") && data.code !== null && data.code !== "" && ![0, "0", 200, "200"].includes(data.code)) return true;
        if (Object.prototype.hasOwnProperty.call(data, "ret") && !Array.isArray(data.ret)) return true;
        return Array.isArray(data.ret) && data.ret.some(value => typeof value !== "string" || !value.startsWith("SUCCESS::"));
    }
    return { VERSION, TARGETS, record, target, queryIdentity, requestIdentity, bodyIdentity, clean, failed, navigation };
})();
const STORE = "skernelx_jd_native_diag_v2";

function loadState(ctx) {
    try { const value = ctx.storage.getJSON(STORE); return JD_POLICY.record(value) && value.version === JD_POLICY.VERSION ? value : {}; }
    catch (_) { return {}; }
}
function saveState(ctx, state) {
    try { ctx.storage.setJSON(STORE, { ...state, version: JD_POLICY.VERSION, at: new Date().toISOString() }); } catch (_) {}
}
function diagnostics(ctx) {
    const state = loadState(ctx);
    const text = ["京东原生版本：" + JD_POLICY.VERSION, state.at ? "最近接口：" + state.api + "；状态：" + state.status : "尚无本版接口记录；不等于模块或证书正常。"];
    if (state.hits) text.push("目标接口命中：" + state.hits + " 次");
    if (state.nav) text.push("导航：" + state.nav);
    console.log(text.join("\n"));
    return { type: "widget", padding: 12, children: [{ type: "text", text: text.join("\n") }] };
}
function responseHeaders(headers) {
    const stale = ["content-length", "content-encoding", "transfer-encoding", "etag", "content-md5", "content-digest", "repr-digest", "digest", "content-type", "cache-control"];
    const values = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-JD-Cleaner-Version": JD_POLICY.VERSION };
    const old = [];
    try {
        const names = [...new Set([...stale, ...Object.keys(values).map(name => name.toLowerCase())])];
        for (const name of names) old.push([name, typeof headers.getAll === "function" ? headers.getAll(name) : (headers.get(name) === null ? [] : [headers.get(name)])]);
        for (const name of stale) headers.delete(name);
        for (const [name, value] of Object.entries(values)) headers.set(name, value);
        return headers;
    } catch (error) {
        for (const [name, valuesForName] of old) { try { headers.delete(name); for (const value of valuesForName) headers.append(name, value); } catch (_) {} }
        throw error;
    }
}
function decodeUTF8(bytes) {
    const parts = []; let chunk = "";
    for (let i = 0; i < bytes.length;) {
        const first = bytes[i++]; let point = first, count = 0, minimum = 0;
        if (first >= 0xc2 && first <= 0xdf) { point &= 0x1f; count = 1; minimum = 0x80; }
        else if (first >= 0xe0 && first <= 0xef) { point &= 0x0f; count = 2; minimum = 0x800; }
        else if (first >= 0xf0 && first <= 0xf4) { point &= 7; count = 3; minimum = 0x10000; }
        else if (first > 0x7f) throw Error("invalid-utf8");
        for (let j = 0; j < count; j++) { const next = bytes[i++]; if (next === undefined || (next & 0xc0) !== 0x80) throw Error("invalid-utf8"); point = point * 64 + (next & 0x3f); }
        if (point < minimum || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw Error("invalid-utf8");
        chunk += String.fromCodePoint(point); if (chunk.length > 8192) { parts.push(chunk); chunk = ""; }
    }
    parts.push(chunk); return parts.join("");
}
function contentAllowed(headers) {
    try {
        const type = headers.get("content-type") || "";
        if (type && !/^\s*(?:application\/(?:[\w.+-]+\+)?json|text\/json)\s*(?:;|$)/i.test(type)) return false;
        const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(type);
        return !charset || /^(?:utf-8|utf8|us-ascii)$/i.test(charset[1]);
    } catch (_) { return false; }
}
export default async function(ctx) {
    if (!ctx.request && !ctx.response) return diagnostics(ctx);
    if (!ctx.request || !ctx.response) return;
    let url;
    try {
        url = new URL(ctx.request.url);
        if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "api.m.jd.com" || url.pathname !== "/client.action" || url.username || url.password) return;
    } catch (_) { return; }
    const identity = await JD_POLICY.requestIdentity(ctx.request, url);
    if (!identity.id || !JD_POLICY.target(identity.id) || !ctx.response) return;
    const old = loadState(ctx);
    const hits = Number.isSafeInteger(old.hits) && old.hits >= 0 ? old.hits : 0;
    const state = { hits: Math.min(hits + 1, 999999), api: identity.id, status: "未处理" };
    if (ctx.response.status !== 200) { saveState(ctx, { ...state, status: "非 HTTP 200，未读取正文" }); return; }
    if (!contentAllowed(ctx.response.headers)) { saveState(ctx, { ...state, status: "非 JSON 或不支持编码，未读取正文" }); return; }
    let bytes;
    try { bytes = new Uint8Array(await ctx.response.arrayBuffer()); } catch (_) { saveState(ctx, { ...state, status: "正文读取失败，未改写" }); return; }
    try {
        const text = decodeUTF8(bytes);
        const data = JSON.parse(text);
        if (!JD_POLICY.record(data)) throw Error("unknown-structure");
        if (JD_POLICY.failed(data)) {
            saveState(ctx, { ...state, status: "服务端错误或陌生状态码，原字节放行" });
            return { body: bytes };
        }
        const before = JSON.stringify(data);
        JD_POLICY.clean(data, identity.id);
        const changed = JSON.stringify(data);
        if (changed === before) {
            saveState(ctx, { ...state, status: "未见可改写字段" });
            return { body: bytes };
        }
        const headers = responseHeaders(ctx.response.headers);
        saveState(ctx, { ...state, status: "已改写", nav: identity.id === "readCustomSurfaceList" ? "已处理" : undefined });
        return { body: changed, headers };
    } catch (_) {
        saveState(ctx, { ...state, status: "编码、结构或改写异常，原字节放行" });
        return { body: bytes };
    }
}
