/*
 * 京东 App 去广告脚本 v1.0 for Surge
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
 * - cart             删购物车底部空车楼层与推荐楼层
 * - secondFloor      删首页二楼推荐楼层（问候/消息等功能保留）
 * - lite_advertising 极速版广告位字段名替换（使 App 解析不到）
 *
 * 所有分支均 try/catch 包裹，解析失败原样返回，不影响 App 正常功能。
 */

const CONFIG = {
    scriptName: "京东去广告",
    version: "1.0.0",
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

    // lite_advertising：字符串级字段名替换（Loon replace-regex 语义）
    if (url.includes("functionId=lite_advertising")) {
        if (body.includes("jdLiteAdvertisingVO")) {
            body = body.split("jdLiteAdvertisingVO").join("sooyaaabo");
            log("lite_advertising: 字段名已替换");
        }
        $done({ body });
        return;
    }

    const m = url.match(/functionId=(start|welcomeHome|deliverLayer|basicConfig|cart|secondFloor)(?:&|$|\?)/);
    if (!m) { $done({}); return; }

    const data = safeParse(body);
    if (!data) { $done({}); return; }

    try {
        const handlers = {
            start: handleStart,
            welcomeHome: handleWelcomeHome,
            deliverLayer: handleDeliverLayer,
            basicConfig: handleBasicConfig,
            cart: handleCart,
            secondFloor: handleSecondFloor
        };
        const result = handlers[m[1]](data);
        log(`${m[1]}: 已处理`);
        $done({ body: JSON.stringify(result) });
    } catch (e) {
        // 等价 Loon jq 的 catch $o：出错返回原始响应
        log(`${m[1]}: 处理失败，返回原始响应`);
        $done({});
    }
}

main();
