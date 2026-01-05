/*
 * 闲鱼APP抓包辅助脚本 for Surge
 * 
 * 功能特性:
 * - 捕获闲鱼启动时的所有请求
 * - 自动识别可能的广告接口
 * - 记录请求URL和响应数据
 * - 通过通知展示关键信息
 * 
 * 使用方法:
 * 1. 在Surge中添加脚本规则
 * 2. 配置MITM域名
 * 3. 强制关闭闲鱼APP
 * 4. 重新打开闲鱼，观察Surge通知
 * 5. 在Surge日志中查看详细数据
 * 
 * 作者: Kiro Assistant
 * 版本: v1.0.0
 * 更新时间: 2026-01-05
 */

// ==================== 配置区域 ====================
const CONFIG = {
    scriptName: "闲鱼抓包",
    
    // 广告相关关键词（用于识别可能的广告接口）
    adKeywords: [
        // 开屏广告核心关键词
        "splash", "splashscreen", "screen",
        "startup", "launch", "boot", "cold",
        // 广告通用关键词
        "ad", "ads", "adv", "idleadv",
        "banner", "promotion", "marketing", "commercial",
        "advertise", "popup", "interstitial", "preload",
        // 闲鱼特有关键词
        "material", "creative", "exposure", "impression",
        "click", "skip", "countdown", "duration"
    ],
    
    // 高优先级接口关键词（开屏广告专用）
    splashKeywords: [
        "splash", "screen", "startup", "launch", "boot",
        "preload", "cold", "init", "first"
    ],
    
    // 存储key
    storageKey: "xianyu_capture_log",
    
    // 最大记录条数
    maxLogs: 100
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

// 检查URL是否可能是广告接口
function isPossibleAdUrl(url) {
    const lowerUrl = url.toLowerCase();
    return CONFIG.adKeywords.some(kw => lowerUrl.includes(kw));
}

// 检查是否是高优先级开屏广告接口
function isSplashUrl(url) {
    const lowerUrl = url.toLowerCase();
    return CONFIG.splashKeywords.some(kw => lowerUrl.includes(kw));
}

// 检查响应体是否包含开屏广告特征字段
function checkSplashFields(body) {
    const splashIndicators = [
        "imageUrl", "imgUrl", "picUrl", "image_url", "pic_url",
        "clickUrl", "click_url", "jumpUrl", "jump_url", "targetUrl",
        "duration", "countdown", "showTime", "displayTime",
        "skipText", "skip", "跳过",
        "splashId", "splash_id", "screenId", "adId"
    ];
    
    const lowerBody = body.toLowerCase();
    const found = [];
    
    splashIndicators.forEach(indicator => {
        if (lowerBody.includes(indicator.toLowerCase())) {
            found.push(indicator);
        }
    });
    
    return found;
}

// 检查响应体是否包含广告相关字段
function checkAdFields(body) {
    try {
        const data = JSON.parse(body);
        const adFields = [];
        
        function findAdFields(obj, path = '') {
            if (!obj || typeof obj !== 'object') return;
            
            for (const key in obj) {
                const currentPath = path ? `${path}.${key}` : key;
                const lowerKey = key.toLowerCase();
                
                // 检查是否是广告相关字段
                if (CONFIG.adKeywords.some(kw => lowerKey.includes(kw))) {
                    adFields.push({
                        path: currentPath,
                        type: typeof obj[key],
                        isArray: Array.isArray(obj[key]),
                        hasValue: obj[key] !== null && obj[key] !== undefined
                    });
                }
                
                // 递归检查
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    findAdFields(obj[key], currentPath);
                }
            }
        }
        
        findAdFields(data);
        return adFields;
    } catch (e) {
        return [];
    }
}

// 截断字符串
function truncate(str, maxLen = 500) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...[截断]' : str;
}

// 保存日志到本地存储
function saveLog(logEntry) {
    try {
        let logs = [];
        const saved = $persistentStore.read(CONFIG.storageKey);
        if (saved) {
            logs = JSON.parse(saved);
        }
        
        logs.unshift(logEntry);
        
        // 限制日志数量
        if (logs.length > CONFIG.maxLogs) {
            logs = logs.slice(0, CONFIG.maxLogs);
        }
        
        $persistentStore.write(JSON.stringify(logs), CONFIG.storageKey);
    } catch (e) {
        console.log("保存日志失败:", e);
    }
}

// ==================== 主处理函数 ====================

function main() {
    const url = $request.url;
    const body = $response.body || '';
    const status = $response.status;
    const time = getTimeStr();
    
    // 解析URL
    let urlPath = '';
    try {
        const urlObj = new URL(url);
        urlPath = urlObj.pathname;
    } catch (e) {
        urlPath = url.substring(0, 100);
    }
    
    // 检查是否可能是广告接口
    const isPossibleAd = isPossibleAdUrl(url);
    const isSplash = isSplashUrl(url);
    const adFields = checkAdFields(body);
    const hasAdFields = adFields.length > 0;
    const splashFields = checkSplashFields(body);
    const hasSplashFields = splashFields.length > 0;
    
    // 构建日志条目
    const logEntry = {
        time: time,
        url: url,
        path: urlPath,
        status: status,
        bodyLength: body.length,
        isPossibleAd: isPossibleAd,
        isSplash: isSplash,
        adFields: adFields,
        splashFields: splashFields,
        bodyPreview: truncate(body, 2000)
    };
    
    // 控制台输出
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${CONFIG.scriptName}] ${time}`);
    console.log(`📡 URL: ${url}`);
    console.log(`📊 状态: ${status} | 大小: ${body.length} 字节`);
    
    // 高优先级：开屏广告
    if (isSplash) {
        console.log(`🚨🚨🚨 可能是开屏广告接口！！！`);
    } else if (isPossibleAd) {
        console.log(`⚠️ 可能是广告接口！(URL包含广告关键词)`);
    }
    
    // 检查响应体中的开屏广告特征
    if (hasSplashFields) {
        console.log(`🎯🎯🎯 发现开屏广告特征字段:`);
        console.log(`   ${splashFields.join(', ')}`);
    }
    
    if (hasAdFields) {
        console.log(`🎯 发现广告相关字段:`);
        adFields.slice(0, 10).forEach(field => {
            console.log(`   - ${field.path} (${field.type}${field.isArray ? '[]' : ''})`);
        });
        if (adFields.length > 10) {
            console.log(`   ... 还有 ${adFields.length - 10} 个字段`);
        }
    }
    
    // 输出响应体预览（开屏广告相关的输出更多）
    if (body) {
        console.log(`📄 响应预览:`);
        const previewLen = (isSplash || hasSplashFields) ? 5000 : 2000;
        console.log(truncate(body, previewLen));
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    // 保存日志
    saveLog(logEntry);
    
    // 发送通知
    if (isSplash || hasSplashFields) {
        // 开屏广告 - 高优先级通知
        $notification.post(
            "🚨 发现开屏广告接口！",
            urlPath.substring(0, 50),
            `大小: ${body.length}字节\n特征: ${splashFields.join(', ').substring(0, 80)}`
        );
    } else if (isPossibleAd || hasAdFields) {
        const title = isPossibleAd ? "🎯 发现可能的广告接口" : "📋 发现广告字段";
        const subtitle = urlPath.substring(0, 50);
        let message = `大小: ${body.length}字节`;
        
        if (hasAdFields) {
            message += `\n字段: ${adFields.map(f => f.path).join(', ').substring(0, 100)}`;
        }
        
        $notification.post(title, subtitle, message);
    }
    
    // 不修改响应，原样返回
    $done({});
}

// 执行脚本
main();
