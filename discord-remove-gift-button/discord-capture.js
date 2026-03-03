/*
 * Discord 抓包分析脚本 - 响应内容捕获
 * 
 * 记录 Discord 关键 API 的响应内容到 Surge 持久化存储
 * 使用方法：安装后打开 Discord，进入聊天页面
 *          然后在 Surge → 脚本编辑器 → 控制台 查看日志
 *          或通过 Surge HTTP API 获取存储的数据
 */

const url = $request.url;
const body = $response.body;

// 提取 API 路径（去掉域名和版本号前缀）
const pathMatch = url.match(/\/api\/v\d+(\/.+?)(?:\?|$)/);
const apiPath = pathMatch ? pathMatch[1] : url;

// 缩短路径用于存储 key
const storageKey = "dc_" + apiPath.replace(/\//g, "_").substring(0, 60);

try {
    const obj = JSON.parse(body);
    
    // 提取关键字段（避免存储过大的数据）
    let summary = {};
    
    if (apiPath === "/users/@me") {
        // 用户信息 - 提取关键控制字段
        summary = {
            _api: apiPath,
            premium_type: obj.premium_type,
            purchased_flags: obj.purchased_flags,
            premium_usage_flags: obj.premium_usage_flags,
            flags: obj.flags,
            public_flags: obj.public_flags,
            desktop: obj.desktop,
            mobile: obj.mobile,
            nsfw_allowed: obj.nsfw_allowed,
            mfa_enabled: obj.mfa_enabled,
            // 列出所有顶级 key
            _all_keys: Object.keys(obj)
        };
    } else if (apiPath.includes("/settings")) {
        // 设置 - 提取所有顶级 key 和关键字段
        const keys = Object.keys(obj);
        summary = {
            _api: apiPath,
            _all_keys: keys,
            // 保留所有字段（设置通常不大）
            _data: obj
        };
    } else if (apiPath.includes("/experiment") || apiPath.includes("/session")) {
        // 实验/功能开关 - 提取所有顶级 key
        const keys = Object.keys(obj);
        summary = {
            _api: apiPath,
            _all_keys: keys
        };
        // 如果有 assignments/experiments 字段，记录 key 列表
        if (obj.assignments) {
            summary._assignments_sample = JSON.stringify(obj.assignments).substring(0, 500);
        }
        if (obj.guild_experiments) {
            summary._guild_experiments_count = obj.guild_experiments.length;
        }
        // 搜索与 gift/nitro/premium/store 相关的字段
        const bodyStr = JSON.stringify(obj);
        const giftRelated = bodyStr.match(/gift|nitro|premium|store|shop|purchase|buy|upsell|entitlement/gi);
        if (giftRelated) {
            summary._gift_related_keywords = [...new Set(giftRelated)];
        }
    } else {
        // 其他 - 记录顶级 key 和完整数据（如果不太大）
        const bodyStr = JSON.stringify(obj);
        summary = {
            _api: apiPath,
            _all_keys: Array.isArray(obj) ? `Array[${obj.length}]` : Object.keys(obj),
            _data: bodyStr.length < 2000 ? obj : bodyStr.substring(0, 2000) + "...(truncated)"
        };
    }
    
    const result = JSON.stringify(summary, null, 2);
    
    // 存储到持久化
    $persistentStore.write(result, storageKey);
    
    // 输出到通知（仅关键接口）
    const importantApis = ["/users/@me", "/settings", "/entitlements", "/billing", "/experiments"];
    const isImportant = importantApis.some(api => apiPath.includes(api));
    
    if (isImportant) {
        $notification.post(
            "Discord 抓包 📦",
            apiPath,
            result.substring(0, 256)
        );
    }
    
    console.log(`[DC-Capture] ${apiPath}: ${result.substring(0, 500)}`);
    
} catch (e) {
    console.log(`[DC-Capture] ${apiPath}: 非JSON响应, body长度=${body ? body.length : 0}`);
    $persistentStore.write(`non-json, length=${body ? body.length : 0}`, storageKey);
}

$done({});
