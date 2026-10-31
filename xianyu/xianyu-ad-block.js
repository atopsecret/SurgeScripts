/*
 * 闲鱼APP去广告脚本 v2.0 for Surge
 *
 * v2.0 更新（2026-11-01）：
 * - 开屏广告处理改为结构自适配：不再只认 data.data.adMap，递归清除响应中
 *   所有已知开屏广告容器（adMap / ads / splashAds / advertising / item 列表），
 *   兼容闲鱼重装后新版开屏接口的响应结构变化
 * - 新增 mtop.idle.idleadv.* 通用兜底：上报/场景恢复/曝光类接口直接返回
 *   「无广告」成功响应，URL 模式由脚本内部 includes 匹配，新端点免改模块
 * - 移除每次拦截都弹通知的骚扰行为（改为静默，统计数据保留）
 * - 修复：$response.body 为空时不再抛错；handleLaunchReport 等伪造响应
 *   统一走 $done({body}) 返回
 *
 * 处理的接口（URL 关键词匹配）：
 * - mtop.taobao.idlecommerce.splash.async.ads   开屏广告（主接口）
 * - mtop.idle.idleadv.app.launch.report         广告上报
 * - mtop.idle.idleadv.scene.restore             广告场景恢复
 * - mtop.taobao.idle.user.strategy.list         悬浮球/弹窗策略
 * - mtop.taobao.idlehome.home.circle.list       首页Tab广告追踪
 *
 * 作者: Kiro Assistant / skernelx 维护
 */

const CONFIG = {
    scriptName: "闲鱼去广告",
    version: "2.0.0",
    statsKey: "xianyu_ad_block_stats",
    showNotification: false,   // v2: 默认静默，拦截不再弹通知
    debug: false
};

function log(msg) {
    if (CONFIG.debug) console.log(`[${CONFIG.scriptName}] ${msg}`);
}

function updateStats(type) {
    try {
        let stats = { splash: 0, float: 0, track: 0, total: 0 };
        const saved = $persistentStore.read(CONFIG.statsKey);
        if (saved) stats = JSON.parse(saved);
        stats[type] = (stats[type] || 0) + 1;
        stats.total = (stats.total || 0) + 1;
        stats.lastUpdate = new Date().toLocaleString('zh-CN');
        $persistentStore.write(JSON.stringify(stats), CONFIG.statsKey);
    } catch (e) { /* 统计失败不影响主流程 */ }
}

function safeParse(str) {
    try { return JSON.parse(str); } catch (e) { return null; }
}

// 开屏广告容器字段名（命中即清空）
const SPLASH_CONTAINERS = ["adMap", "ads", "splashAds", "advertising", "adList", "splashList"];

// 递归清除开屏广告容器，返回清除数量
function stripSplashAds(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return 0;
    let removed = 0;
    for (const key of Object.keys(node)) {
        if (SPLASH_CONTAINERS.includes(key) && node[key] && Object.keys(node[key]).length > 0) {
            node[key] = Array.isArray(node[key]) ? [] : {};
            removed++;
        } else if (typeof node[key] === 'object') {
            removed += stripSplashAds(node[key], depth + 1);
        }
    }
    return removed;
}

// 伪造「无广告」成功响应
function emptyAdResponse(api) {
    return JSON.stringify({
        api: api,
        data: {},
        ret: ["SUCCESS::调用成功"],
        v: "1.0"
    });
}

function handleSplashAds(body) {
    const data = safeParse(body);
    if (!data) return body;
    const removed = stripSplashAds(data, 0);
    if (removed > 0) {
        log(`开屏广告：清除 ${removed} 个容器`);
        updateStats("splash");
    }
    return JSON.stringify(data);
}

function handleStrategyList(body) {
    const data = safeParse(body);
    if (!data) return body;
    if (data.data && Array.isArray(data.data.strategies)) {
        const adTypes = ["FLOAT_LAYER", "POPUP", "MODAL", "BANNER"];
        const before = data.data.strategies.length;
        data.data.strategies = data.data.strategies.filter(s =>
            s.type === "BIZ_PUBLISH_BALL" || !adTypes.includes(s.type)
        );
        if (before - data.data.strategies.length > 0) {
            log(`悬浮广告：移除 ${before - data.data.strategies.length} 个策略`);
            updateStats("float");
        }
    }
    return JSON.stringify(data);
}

function handleCircleList(body) {
    const data = safeParse(body);
    if (!data) return body;
    if (data.data && Array.isArray(data.data.circleList)) {
        data.data.circleList.forEach(circle => {
            if (circle.trackParams && circle.trackParams.args) {
                Object.keys(circle.trackParams.args).forEach(key => {
                    if (key.startsWith("idleAds")) delete circle.trackParams.args[key];
                });
            }
        });
        updateStats("track");
    }
    return JSON.stringify(data);
}

function main() {
    const url = $request.url;
    let body = $response.body || '';

    if (url.includes("idlecommerce.splash.async.ads")) {
        body = handleSplashAds(body);
    } else if (url.includes("idleadv.app.launch.report")
            || url.includes("idleadv.scene.restore")
            || url.includes("idle.ad.expose")) {
        // 上报与场景恢复：统一回「无广告」
        body = emptyAdResponse("mtop.idle.idleadv");
        updateStats("track");
    } else if (url.includes("idle.user.strategy.list")) {
        body = handleStrategyList(body);
    } else if (url.includes("idlehome.home.circle.list")) {
        body = handleCircleList(body);
    }

    $done({ body });
}

main();
