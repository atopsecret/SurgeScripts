/*
 * Discord 抓包分析脚本 - URL 记录
 * 
 * 记录所有 Discord API 请求的 URL 路径
 * 最终输出一个完整的 URL 列表，用于分析哪些接口被调用
 */

const url = $request.url;
const method = $request.method || "GET";

// 提取 API 路径
const pathMatch = url.match(/\/api\/v(\d+)(\/.+?)(?:\?|$)/);
const version = pathMatch ? pathMatch[1] : "?";
const apiPath = pathMatch ? pathMatch[2] : url;

// 读取已有的 URL 列表
let urlList = $persistentStore.read("dc_all_urls") || "";

// 构造日志行：方法 + 路径
const logLine = `${method} /v${version}${apiPath}`;

// 去重：检查是否已存在
if (!urlList.includes(logLine)) {
    urlList += logLine + "\n";
    $persistentStore.write(urlList, "dc_all_urls");
    
    // 关键接口通知
    const keywords = ["gift", "nitro", "premium", "store", "shop", "entitle", "billing", "purchase", "upsell", "promotion", "experiment", "setting"];
    const matched = keywords.filter(kw => apiPath.toLowerCase().includes(kw));
    
    if (matched.length > 0) {
        $notification.post(
            "Discord 关键 API ⚡",
            logLine,
            `匹配关键词: ${matched.join(", ")}`
        );
    }
    
    console.log(`[DC-URL] ${logLine}`);
}

$done({});
