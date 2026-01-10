/**
 * ============================================================
 * 京东/拼多多/闲鱼 开屏广告抓包脚本
 * ============================================================
 * 
 * 📋 功能说明：
 * - 捕获并高亮显示可能的开屏广告请求
 * - 自动识别App来源（京东/拼多多/闲鱼）
 * - 记录请求详情便于分析
 * 
 * 🔍 使用方法：
 * 1. 在 Surge 中启用此脚本
 * 2. 打开对应 App
 * 3. 查看 Surge 日志，搜索 [SPLASH-AD] 或 🔴
 * 
 * 作者: Kiro Assistant
 * 更新: 2026-01-10
 * ============================================================
 */

// ==================== 开屏广告关键词库 ====================

// 高优先级关键词（几乎确定是广告）
const HIGH_PRIORITY_KEYWORDS = [
  // 开屏广告专用
  'splash', 'splashad', 'splash_ad', 'splashAd',
  'launchad', 'launch_ad', 'launchAd',
  'startupAd', 'startup_ad', 'startad',
  'openad', 'open_ad', 'openAd',
  'bootad', 'boot_ad',
  
  // 京东专用
  'client.action.*functionId=start',
  'client.action.*functionId=splash',
  'client.action.*functionId=queryMaterialAdverts',
  'client.action.*functionId=getAdConfig',
  'client.action.*functionId=getAdvertising',
  
  // 拼多多专用
  'api/oak/integration/render',
  'api/fiora/splash',
  'api/alexa/splash',
  'resource_splash',
  'splash_screen',
  
  // 闲鱼专用
  'mtop.taobao.idlecommerce.splash',
  'mtop.idle.idleadv',
  'mtop.taobao.idle.user.strategy',
  'idlecommerce.splash.async.ads',
];

// 中优先级关键词（可能是广告）
const MEDIUM_PRIORITY_KEYWORDS = [
  // 通用广告关键词
  'advert', 'advertise', 'advertising',
  'banner', 'promotion', 'promo',
  'creative', 'material', 'campaign',
  'adConfig', 'adInfo', 'adData', 'adList',
  'getAd', 'fetchAd', 'loadAd', 'requestAd',
  
  // 广告SDK相关
  'pangle', 'pangolin', 'csjad',  // 穿山甲
  'gdt', 'gdtad',                  // 广点通
  'mobads', 'baiduad',             // 百度
  'adukwai', 'ksad',               // 快手
];

// URL 路径关键词
const URL_PATH_KEYWORDS = [
  '/splash', '/ad/', '/ads/', '/advert/',
  '/launch', '/startup', '/boot/',
  '/promotion/', '/banner/', '/screen/',
  '/config/ad', '/api/ad', '/v1/ad', '/v2/ad',
  '/resource/', '/material/', '/creative/',
  '/oak/', '/fiora/', '/alexa/',  // 拼多多
];

// ==================== 核心函数 ====================

/**
 * 检查是否是开屏广告请求
 */
function checkSplashAd(url, body) {
  const urlLower = url.toLowerCase();
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  const bodyLower = bodyStr.toLowerCase();
  const combined = urlLower + ' ' + bodyLower;
  
  // 1. 检查高优先级关键词
  for (const keyword of HIGH_PRIORITY_KEYWORDS) {
    const keywordLower = keyword.toLowerCase();
    if (combined.includes(keywordLower)) {
      return { 
        matched: true, 
        priority: 'HIGH',
        reason: `🔴 高优先级匹配: ${keyword}`,
        emoji: '🔴'
      };
    }
  }
  
  // 2. 检查 URL 路径关键词
  for (const keyword of URL_PATH_KEYWORDS) {
    if (urlLower.includes(keyword)) {
      return { 
        matched: true, 
        priority: 'MEDIUM',
        reason: `🟠 URL路径匹配: ${keyword}`,
        emoji: '🟠'
      };
    }
  }
  
  // 3. 检查中优先级关键词
  for (const keyword of MEDIUM_PRIORITY_KEYWORDS) {
    const keywordLower = keyword.toLowerCase();
    if (combined.includes(keywordLower)) {
      return { 
        matched: true, 
        priority: 'MEDIUM',
        reason: `🟡 中优先级匹配: ${keyword}`,
        emoji: '🟡'
      };
    }
  }
  
  return { matched: false, priority: 'NONE', reason: null, emoji: '⚪' };
}

/**
 * 识别 App 来源
 */
function identifyApp(url) {
  const urlLower = url.toLowerCase();
  
  // 京东
  if (urlLower.includes('jd.com') || urlLower.includes('jd.cn') || 
      urlLower.includes('360buy') || urlLower.includes('jingdong')) {
    return { name: '京东', emoji: '🛒' };
  }
  
  // 拼多多
  if (urlLower.includes('pinduoduo') || urlLower.includes('yangkeduo') || 
      urlLower.includes('pdd')) {
    return { name: '拼多多', emoji: '🍊' };
  }
  
  // 闲鱼
  if (urlLower.includes('goofish') || urlLower.includes('idle') || 
      urlLower.includes('xianyu')) {
    return { name: '闲鱼', emoji: '🐟' };
  }
  
  // 阿里系（可能是闲鱼）
  if (urlLower.includes('taobao') || urlLower.includes('alibaba') || 
      urlLower.includes('alicdn') || urlLower.includes('alipay')) {
    return { name: '阿里系', emoji: '🅰️' };
  }
  
  // 广告SDK
  if (urlLower.includes('pangle') || urlLower.includes('pangolin')) {
    return { name: '穿山甲SDK', emoji: '📢' };
  }
  if (urlLower.includes('gdt') || urlLower.includes('qq.com')) {
    return { name: '广点通SDK', emoji: '📢' };
  }
  if (urlLower.includes('baidu')) {
    return { name: '百度SDK', emoji: '📢' };
  }
  
  return { name: '未知', emoji: '❓' };
}

/**
 * 格式化时间
 */
function formatTime() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/**
 * 解析 URL 参数
 */
function parseUrlParams(url) {
  try {
    const queryString = url.split('?')[1];
    if (!queryString) return {};
    
    const params = {};
    queryString.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
      }
    });
    return params;
  } catch (e) {
    return {};
  }
}

/**
 * 提取关键参数（用于京东 functionId 等）
 */
function extractKeyParams(url, body) {
  const params = parseUrlParams(url);
  const keyParams = [];
  
  // 京东 functionId
  if (params.functionId) {
    keyParams.push(`functionId=${params.functionId}`);
  }
  
  // 拼多多 api_name
  if (params.api_name) {
    keyParams.push(`api_name=${params.api_name}`);
  }
  
  // 从 body 中提取
  if (body) {
    try {
      const bodyObj = typeof body === 'string' ? JSON.parse(body) : body;
      if (bodyObj.functionId) keyParams.push(`functionId=${bodyObj.functionId}`);
      if (bodyObj.api) keyParams.push(`api=${bodyObj.api}`);
    } catch (e) {}
  }
  
  return keyParams;
}

// ==================== 主逻辑 ====================

(function main() {
  const url = $request.url;
  const method = $request.method;
  const headers = $request.headers || {};
  const body = $request.body;
  
  const app = identifyApp(url);
  const checkResult = checkSplashAd(url, body);
  const keyParams = extractKeyParams(url, body);
  
  const timestamp = formatTime();
  const logPrefix = `[SPLASH-AD][${timestamp}]`;
  
  if (checkResult.matched) {
    // ==================== 疑似广告请求 ====================
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`${logPrefix} ${checkResult.emoji} ${app.emoji} ${app.name} - 疑似开屏广告!`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`📍 匹配原因: ${checkResult.reason}`);
    console.log(`📍 优先级: ${checkResult.priority}`);
    console.log(`📍 请求方法: ${method}`);
    console.log(`📍 完整URL: ${url}`);
    
    // 关键参数
    if (keyParams.length > 0) {
      console.log(`📍 关键参数: ${keyParams.join(', ')}`);
    }
    
    // 请求头
    const importantHeaders = ['User-Agent', 'Content-Type', 'Host', 'Referer', 'Cookie'];
    console.log(`📍 请求头:`);
    for (const h of importantHeaders) {
      if (headers[h]) {
        const value = headers[h].length > 100 ? headers[h].substring(0, 100) + '...' : headers[h];
        console.log(`   ${h}: ${value}`);
      }
    }
    
    // 请求体
    if (body) {
      const bodyPreview = typeof body === 'string' ? body : JSON.stringify(body);
      const truncated = bodyPreview.length > 800 ? bodyPreview.substring(0, 800) + '...(截断)' : bodyPreview;
      console.log(`📍 请求体:\n${truncated}`);
    }
    
    console.log(`${'═'.repeat(70)}\n`);
    
    // 高优先级发送通知
    if (checkResult.priority === 'HIGH') {
      $notification.post(
        `${app.emoji} ${app.name} 开屏广告`,
        checkResult.reason,
        url.substring(0, 150)
      );
    }
    
  } else {
    // ==================== 普通请求（简单记录） ====================
    const shortUrl = url.length > 80 ? url.substring(0, 80) + '...' : url;
    console.log(`${logPrefix} ${app.emoji} ${method} ${shortUrl}`);
  }
  
  // 放行请求
  $done({});
})();
