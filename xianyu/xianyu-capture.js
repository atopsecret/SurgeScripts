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
        "splash", "startup", "launch", "ad", "ads",
        "banner", "promotion", "marketing", "commercial",
        "advertise", "popup", "interstitial", "preload"
    ],
    
    // 存储key
    storageKey: "xianyu_capture_log",
    
    // 最大记录条数
    maxLogs: 50
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
    const adFields = checkAdFields(body);
    const hasAdFields = adFields.length > 0;
    
    // 构建日志条目
    const logEntry = {
        time: time,
        url: url,
        path: urlPath,
        status: status,
        bodyLength: body.length,
        isPossibleAd: isPossibleAd,
        adFields: adFields,
        bodyPreview: truncate(body, 1000)
    };
    
    // 控制台输出
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${CONFIG.scriptName}] ${time}`);
    console.log(`📡 URL: ${url}`);
    console.log(`📊 状态: ${status} | 大小: ${body.length} 字节`);
    
    if (isPossibleAd) {
        console.log(`⚠️ 可能是广告接口！(URL包含广告关键词)`);
    }
    
    if (hasAdFields) {
        console.log(`🎯 发现广告相关字段:`);
        adFields.forEach(field => {
            console.log(`   - ${field.path} (${field.type}${field.isArray ? '[]' : ''})`);
        });
    }
    
    // 输出响应体预览
    if (body) {
        console.log(`📄 响应预览:`);
        console.log(truncate(body, 2000));
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    // 保存日志
    saveLog(logEntry);
    
    // 如果是可能的广告接口，发送通知
    if (isPossibleAd || hasAdFields) {
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
