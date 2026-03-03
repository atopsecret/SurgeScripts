/*
 * 闲鱼APP去广告脚本 for Surge
 * 
 * 功能特性:
 * - 🚫 屏蔽开屏广告
 * - 🚫 屏蔽首页悬浮球广告
 * - 🚫 屏蔽首页Tab广告追踪
 * - 🚫 屏蔽信息流广告
 * - 📊 统计屏蔽数量
 * 
 * 基于抓包分析的接口:
 * - mtop.taobao.idlecommerce.splash.async.ads (开屏广告)
 * - mtop.idle.idleadv.app.launch.report (广告上报)
 * - mtop.idle.idleadv.scene.restore (广告场景恢复)
 * - mtop.taobao.idle.user.strategy.list (悬浮球/弹窗策略)
 * - mtop.taobao.idlehome.home.circle.list (首页Tab广告追踪)
 * 
 * 作者: Kiro Assistant
 * 版本: v1.0.0
 * 更新时间: 2026-01-06
 */

// ==================== 配置区域 ====================
const CONFIG = {
    scriptName: "闲鱼去广告",
    version: "1.0.0",
    
    // 统计key
    statsKey: "xianyu_ad_block_stats",
    
    // 是否显示通知
    showNotification: true,
    
    // 是否输出调试日志
    debug: false
};

// ==================== 工具函数 ====================

// 获取当前时间字符串
function getTimeStr() {
    return new Date().toLocaleString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 调试日志
function log(msg) {
    if (CONFIG.debug) {
        console.log(`[${CONFIG.scriptName}] ${msg}`);
    }
}

// 更新统计数据
function updateStats(type) {
    try {
        let stats = { splash: 0, float: 0, track: 0, total: 0 };
        const saved = $persistentStore.read(CONFIG.statsKey);
        if (saved) {
            stats = JSON.parse(saved);
        }
        
        stats[type] = (stats[type] || 0) + 1;
        stats.total = (stats.total || 0) + 1;
        stats.lastUpdate = getTimeStr();
        
        $persistentStore.write(JSON.stringify(stats), CONFIG.statsKey);
        return stats;
    } catch (e) {
        return { total: 0 };
    }
}

// 发送通知
function notify(title, subtitle, message) {
    if (CONFIG.showNotification) {
        $notification.post(title, subtitle, message);
    }
}

// 安全解析JSON
function safeParseJSON(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

// ==================== 广告处理函数 ====================

/**
 * 处理开屏广告接口
 * API: mtop.taobao.idlecommerce.splash.async.ads
 */
function handleSplashAds(body) {
    const data = safeParseJSON(body);
    if (!data) return body;
    
    // 清空广告数据
    if (data.data && data.data.adMap) {
        data.data.adMap = {};
        log("已清空开屏广告数据");
        updateStats("splash");
        notify("🚫 已屏蔽开屏广告", "闲鱼去广告", "开屏广告已被拦截");
    }
    
    return JSON.stringify(data);
}

/**
 * 处理广告上报接口
 * API: mtop.idle.idleadv.app.launch.report
 */
function handleLaunchReport(body) {
    // 直接返回成功，不做实际上报
    const response = {
        api: "mtop.idle.idleadv.app.launch.report",
        data: { attributeSuccess: "false" },
        ret: ["SUCCESS::调用成功"],
        v: "1.0"
    };
    log("已拦截广告上报");
    updateStats("track");
    return JSON.stringify(response);
}

/**
 * 处理广告场景恢复接口
 * API: mtop.idle.idleadv.scene.restore
 */
function handleSceneRestore(body) {
    const response = {
        api: "mtop.idle.idleadv.scene.restore",
        data: { trackParams: { stageMatch: "false" } },
        ret: ["SUCCESS::调用成功"],
        v: "1.0"
    };
    log("已拦截广告场景恢复");
    updateStats("track");
    return JSON.stringify(response);
}

/**
 * 处理用户策略列表（悬浮球/弹窗广告）
 * API: mtop.taobao.idle.user.strategy.list
 */
function handleStrategyList(body) {
    const data = safeParseJSON(body);
    if (!data) return body;
    
    if (data.data && data.data.strategies) {
        // 过滤掉广告类型的策略
        const adTypes = ["FLOAT_LAYER", "POPUP", "MODAL", "BANNER"];
        const originalCount = data.data.strategies.length;
        
        data.data.strategies = data.data.strategies.filter(strategy => {
            // 保留发布球等功能性组件
            if (strategy.type === "BIZ_PUBLISH_BALL") {
                return true;
            }
            // 过滤广告类型
            if (adTypes.includes(strategy.type)) {
                return false;
            }
            return true;
        });
        
        const removedCount = originalCount - data.data.strategies.length;
        if (removedCount > 0) {
            log(`已移除 ${removedCount} 个悬浮广告策略`);
            updateStats("float");
            notify("🚫 已屏蔽悬浮广告", "闲鱼去广告", `移除了 ${removedCount} 个广告组件`);
        }
    }
    
    return JSON.stringify(data);
}

/**
 * 处理首页Tab列表（移除广告追踪参数）
 * API: mtop.taobao.idlehome.home.circle.list
 */
function handleCircleList(body) {
    const data = safeParseJSON(body);
    if (!data) return body;
    
    if (data.data && data.data.circleList) {
        data.data.circleList.forEach(circle => {
            if (circle.trackParams && circle.trackParams.args) {
                // 移除广告追踪参数
                const args = circle.trackParams.args;
                const adKeys = [
                    "idleAdsPositionId", "idleAdsMaterialId", "idleAdsTaskId",
                    "idleAdsOriginTaskId", "idleAdsLoginUserId", "idleAdsIdleCrowdId",
                    "idleAdsMaterialTemplateId", "idleAdsSubNamespace", "idleAdsNamespace",
                    "idleAdsCrowdId", "idleAdsRequestTraceId"
                ];
                
                adKeys.forEach(key => {
                    if (args[key]) {
                        delete args[key];
                    }
                });
            }
        });
        log("已清理首页Tab广告追踪参数");
        updateStats("track");
    }
    
    return JSON.stringify(data);
}

/**
 * 处理用户初始化接口
 * API: com.taobao.idle.user.init
 */
function handleUserInit(body) {
    // 保持原样返回，不做修改
    return body;
}

/**
 * 处理主机授权接口（包含广告配置）
 * API: com.taobao.idle.host.authorize
 */
function handleHostAuthorize(body) {
    const data = safeParseJSON(body);
    if (!data) return body;
    
    // 清理可能的广告相关配置
    if (data.data) {
        if (data.data.launchUrl) {
            // 保留基本配置，但可以在这里做进一步处理
        }
    }
    
    return JSON.stringify(data);
}

// ==================== 主处理函数 ====================

function main() {
    const url = $request.url;
    let body = $response.body || '';
    
    log(`处理请求: ${url}`);
    
    // 根据URL匹配不同的处理函数
    if (url.includes("idlecommerce.splash.async.ads")) {
        // 开屏广告
        body = handleSplashAds(body);
    } else if (url.includes("idleadv.app.launch.report")) {
        // 广告上报
        body = handleLaunchReport(body);
    } else if (url.includes("idleadv.scene.restore")) {
        // 广告场景恢复
        body = handleSceneRestore(body);
    } else if (url.includes("idle.user.strategy.list")) {
        // 悬浮球/弹窗策略
        body = handleStrategyList(body);
    } else if (url.includes("idlehome.home.circle.list")) {
        // 首页Tab列表
        body = handleCircleList(body);
    } else if (url.includes("idle.host.authorize")) {
        // 主机授权
        body = handleHostAuthorize(body);
    }
    
    $done({ body });
}

// 执行脚本
main();
