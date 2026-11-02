/*
 * 京东 App 去广告脚本 v1.1 for Surge / Egern
 *
 * 重构自 Thelongdarkorg/loon-plugins jd_splash_ad_block.plugin（Loon 格式），
 * 将其 response-body-json-jq / json-replace / json-del / replace-regex
 * 四类 Loon 原生改写翻译为等价的 JavaScript 实现。
 *
 * 处理的 functionId：
 * - start            清空开屏大图列表 + 展示次数归零（根除缓存开屏回闪）
 * - welcomeHome      删首屏浮层楼层 + 网页浮层列表
 * - deliverLayer     删物流页顶部 banner
 * - basicConfig      关闭 socket 监控/上报 + httpdns
 * - readCustomSurfaceList 精简亮色/深色底栏，保留首页/消息/购物车/我的
 * - cart             删购物车底部空车楼层与推荐楼层
 * - secondFloor      删首页二楼推荐楼层（问候/消息等功能保留）
 * - lite_advertising 极速版广告位字段名替换（使 App 解析不到）
 *
 * 所有分支均 try/catch 包裹，解析失败原样返回，不影响 App 正常功能。
 */

const CONFIG = {
    scriptName: "京东去广告",
    version: "1.1.0",
    debug: false
};

function log(msg) {
    if (CONFIG.debug) console.log(`[${CONFIG.scriptName}] ${msg}`);
}

function safeParse(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
}

// ---------- start：开屏大图 + 展示次数 ----------
// Loon jq: .images=[] / .showTimesDaily=0（根对象字段，类型校验后操作）
function handleStart(data) {
    if (Array.isArray(data.images)) data.images = [];
    if (typeof data.showTimesDaily === "number") data.showTimesDaily = 0;
    return data;
}

// ---------- welcomeHome：首屏浮层 ----------
// Loon jq: floorList 过滤黑名单 type + webViewFloorList=[]
const WELCOME_FLOOR_TYPES = ["bottomXview", "float", "photoCeiling", "ruleFloat", "searchIcon", "topRotate", "tabBarAtmosphere"];
function handleWelcomeHome(data) {
    if (Array.isArray(data.floorList)) {
        data.floorList = data.floorList.filter(f =>
            f.type == null || !WELCOME_FLOOR_TYPES.includes(f.type)
        );
    }
    if (Array.isArray(data.webViewFloorList)) data.webViewFloorList = [];
    return data;
}

// ---------- deliverLayer：物流页 banner ----------
// Loon jq: del(.bannerInfo) + floors 过滤黑名单 mId
const DELIVER_FLOOR_MIDS = ["banner", "jdDeliveryBanner"];
function handleDeliverLayer(data) {
    delete data.bannerInfo;
    if (Array.isArray(data.floors)) {
        data.floors = data.floors.filter(f =>
            f.mId == null || !DELIVER_FLOOR_MIDS.includes(f.mId)
        );
    }
    return data;
}

// ---------- basicConfig：关监控/上报/httpdns ----------
// Loon json-replace 路径：data.JDMessage.socketmonitor.* / data.JDHttpToolKit.httpdns.httpdns
function setPath(obj, path, value) {
    const keys = path.split(".");
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (node == null || typeof node !== "object") return;
        node = node[keys[i]];
    }
    if (node != null && typeof node === "object" && keys[keys.length - 1] in node) {
        node[keys[keys.length - 1]] = value;
    }
}
function handleBasicConfig(data) {
    setPath(data, "JDMessage.socketmonitor.isSocketEstablishedAhead", 0);
    setPath(data, "JDMessage.socketmonitor.isSocketReport", 0);
    setPath(data, "JDHttpToolKit.httpdns.httpdns", 0);
    return data;
}

// ---------- readCustomSurfaceList：全局底栏，不是首页频道 ----------
// 来源：qsoyq/stash override/ad/jd.stoverride（nodeMap / cutLabelName）；
// zirawell/R-Store Res/Scripts/AntiAd/jd.js（result.modeMap / functionId）。
// 两种公开协议均覆盖亮色/深色，当前 App 是否下发仍需实测。
const NAVIGATION_IDS = ["index", "messagenew", "cart", "home"];
function handleCustomSurfaceList(data) {
    const maps = [
        { modes: data.nodeMap, allowIdFallback: false },
        { modes: data.result && data.result.modeMap, allowIdFallback: true }
    ];
    let lists = 0;
    let removed = 0;
    for (const entry of maps) {
        if (!entry.modes || typeof entry.modes !== "object") continue;
        for (const mode of ["normal", "dark"]) {
            const config = entry.modes[mode];
            if (!config || !Array.isArray(config.navigationAll)) continue;
            lists++;
            const original = config.navigationAll;
            if (!original.every(item => item && typeof item === "object" &&
                !Array.isArray(item))) continue;
            let kept;
            if (original.some(item => typeof item.cutLabelName === "string")) {
                // 有文字标识时只删视频入口，秒送、分类等其它导航原样保留。
                kept = original.filter(item => !["逛", "逛逛", "视频", "短视频"].includes(item.cutLabelName));
                if (kept.length < 2) continue;
            } else if (entry.allowIdFallback && original.every(item =>
                typeof item.functionId === "string")) {
                // 旧协议无文字标识时沿用来源白名单；缺少核心入口则不猜。
                kept = original.filter(item => NAVIGATION_IDS.includes(item.functionId));
                if (!["index", "cart", "home"].every(id =>
                    kept.some(item => item.functionId === id))) continue;
            } else continue;
            removed += original.length - kept.length;
            config.navigationAll = kept;
        }
    }
    // 不记录响应、Cookie 或个人信息，仅打印命中及删除数量。
    console.log(`[${CONFIG.scriptName} v${CONFIG.version}] readCustomSurfaceList: lists=${lists}, removed=${removed}`);
    return data;
}

// ---------- cart：删空车楼层与推荐楼层 ----------
// Loon json-del 路径：cartLocationMap.loc_emptyCartFloor2 / emptyCartRecommendFloor
function handleCart(data) {
    if (data.cartLocationMap && "loc_emptyCartFloor2" in data.cartLocationMap) {
        delete data.cartLocationMap.loc_emptyCartFloor2;
    }
    if ("emptyCartRecommendFloor" in data) {
        delete data.emptyCartRecommendFloor;
    }
    return data;
}

// ---------- secondFloor：首页二楼推荐楼层 ----------
// 问候语/天气/消息提醒等功能保留，只删推荐楼层
function handleSecondFloor(data) {
    if (data.data && "recommendFloor" in data.data) {
        delete data.data.recommendFloor;
    }
    return data;
}

// ---------- 主分发 ----------
function main() {
    const url = $request.url;
    let body = $response.body || "";

    // 不要求 functionId 是首个查询参数；只接受京东客户端接口。
    if (!/^https?:\/\/api\.m\.jd\.com\/client\.action(?:\?|$)/i.test(url)) {
        $done({}); return;
    }
    const idMatch = url.match(/[?&]functionId=([^&#]+)/);
    const functionId = idMatch ? idMatch[1] : "";

    // lite_advertising：字符串级字段名替换（Loon replace-regex 语义）
    if (functionId === "lite_advertising") {
        if (body.includes("jdLiteAdvertisingVO")) {
            body = body.split("jdLiteAdvertisingVO").join("sooyaaabo");
            log("lite_advertising: 字段名已替换");
        }
        $done({ body });
        return;
    }

    const handlers = {
        start: handleStart,
        welcomeHome: handleWelcomeHome,
        deliverLayer: handleDeliverLayer,
        basicConfig: handleBasicConfig,
        cart: handleCart,
        secondFloor: handleSecondFloor,
        readCustomSurfaceList: handleCustomSurfaceList
    };
    if (!Object.prototype.hasOwnProperty.call(handlers, functionId)) { $done({}); return; }

    const data = safeParse(body);
    if (!data || typeof data !== "object" || Array.isArray(data)) { $done({}); return; }

    try {
        const result = handlers[functionId](data);
        log(`${functionId}: 已处理`);
        $done({ body: JSON.stringify(result) });
    } catch (e) {
        // 等价 Loon jq 的 catch $o：出错返回原始响应
        log(`${functionId}: 处理失败，返回原始响应`);
        $done({});
    }
}

main();
