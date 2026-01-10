/**
 * 拼多多去开屏广告脚本
 * 基于抓包分析，精准屏蔽拼多多开屏广告
 */

const url = $request.url;
let body = $response.body;

try {
  let obj = JSON.parse(body);
  
  // AB测试接口（包含开屏广告配置）
  if (url.includes('/abtest') || url.includes('/experiment')) {
    // 遍历清理广告相关配置
    function cleanAdConfig(data) {
      if (!data || typeof data !== 'object') return data;
      
      for (let key in data) {
        const keyLower = key.toLowerCase();
        // 清理开屏广告相关
        if (keyLower.includes('splash') || 
            keyLower.includes('launch') ||
            keyLower.includes('startup') ||
            keyLower.includes('openad') ||
            keyLower.includes('bootad')) {
          if (typeof data[key] === 'object') {
            data[key] = {};
          } else if (typeof data[key] === 'boolean') {
            data[key] = false;
          } else if (typeof data[key] === 'number') {
            data[key] = 0;
          } else {
            data[key] = null;
          }
        }
        // 递归处理嵌套对象
        if (typeof data[key] === 'object' && data[key] !== null) {
          data[key] = cleanAdConfig(data[key]);
        }
      }
      return data;
    }
    
    obj = cleanAdConfig(obj);
    console.log('[PDD] 已清理AB测试中的广告配置');
  }
  
  // 配置接口
  if (url.includes('/mobile_config/')) {
    function cleanMobileConfig(data) {
      if (!data || typeof data !== 'object') return data;
      
      for (let key in data) {
        const keyLower = key.toLowerCase();
        if (keyLower.includes('ad') || 
            keyLower.includes('splash') ||
            keyLower.includes('banner') ||
            keyLower.includes('popup') ||
            keyLower.includes('float')) {
          if (Array.isArray(data[key])) {
            data[key] = [];
          } else if (typeof data[key] === 'object') {
            data[key] = {};
          } else if (typeof data[key] === 'boolean') {
            data[key] = false;
          }
        }
        if (typeof data[key] === 'object' && data[key] !== null) {
          data[key] = cleanMobileConfig(data[key]);
        }
      }
      return data;
    }
    
    obj = cleanMobileConfig(obj);
    console.log('[PDD] 已清理移动配置中的广告');
  }
  
  // 首页接口（清理广告位）
  if (url.includes('/alexa/')) {
    function cleanHomeAds(data) {
      if (!data || typeof data !== 'object') return data;
      
      // 清理广告相关字段
      if (data.ads) data.ads = [];
      if (data.adList) data.adList = [];
      if (data.banners) {
        // 过滤掉广告类型的banner
        data.banners = data.banners.filter(b => 
          !b.type?.toLowerCase().includes('ad') &&
          !b.adType
        );
      }
      if (data.floatAd) data.floatAd = null;
      if (data.popupAd) data.popupAd = null;
      
      // 递归处理
      for (let key in data) {
        if (typeof data[key] === 'object' && data[key] !== null) {
          data[key] = cleanHomeAds(data[key]);
        }
      }
      return data;
    }
    
    obj = cleanHomeAds(obj);
    console.log('[PDD] 已清理首页广告');
  }
  
  body = JSON.stringify(obj);
} catch (e) {
  console.log('[PDD] 处理出错: ' + e.message);
}

$done({ body });
