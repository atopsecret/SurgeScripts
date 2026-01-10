/**
 * 京东去开屏广告脚本
 * 基于抓包分析，精准屏蔽京东开屏广告
 */

const url = $request.url;
let body = $response.body;

try {
  let obj = JSON.parse(body);
  
  // 开屏广告接口
  if (url.includes('functionId=start') || url.includes('functionId=queryMaterialAdverts')) {
    // 清空广告数据
    if (obj.data) {
      if (obj.data.ads) obj.data.ads = [];
      if (obj.data.adList) obj.data.adList = [];
      if (obj.data.splashAd) obj.data.splashAd = null;
      if (obj.data.splash) obj.data.splash = null;
      if (obj.data.advertise) obj.data.advertise = null;
    }
    if (obj.ads) obj.ads = [];
    if (obj.adList) obj.adList = [];
    console.log('[JD] 已清理开屏广告');
  }
  
  // 广告配置接口
  if (url.includes('functionId=getAdConfig') || url.includes('functionId=getAdvertising')) {
    if (obj.data) {
      obj.data = {};
    }
    console.log('[JD] 已清理广告配置');
  }
  
  // 基础配置接口（清理启动广告配置）
  if (url.includes('functionId=basicConfig')) {
    if (obj.data) {
      // 清理开屏广告相关配置
      if (obj.data.launchAd) obj.data.launchAd = null;
      if (obj.data.splashAd) obj.data.splashAd = null;
      if (obj.data.startupAd) obj.data.startupAd = null;
      if (obj.data.adConfig) obj.data.adConfig = {};
    }
    console.log('[JD] 已清理基础配置中的广告');
  }
  
  // 弹窗广告接口
  if (url.includes('functionId=getBubbleInfo')) {
    if (obj.data) {
      if (obj.data.bubbleList) obj.data.bubbleList = [];
      if (obj.data.list) obj.data.list = [];
    }
    console.log('[JD] 已清理弹窗广告');
  }
  
  // 开关配置（关闭广告开关）
  if (url.includes('functionId=switchQuery')) {
    if (obj.data) {
      // 遍历关闭广告相关开关
      for (let key in obj.data) {
        if (key.toLowerCase().includes('ad') || 
            key.toLowerCase().includes('splash') ||
            key.toLowerCase().includes('banner') ||
            key.toLowerCase().includes('popup')) {
          obj.data[key] = false;
        }
      }
    }
    console.log('[JD] 已关闭广告开关');
  }
  
  // xview配置（清理广告列表）
  if (url.includes('functionId=xview2Config')) {
    if (obj.data && obj.data.adList) {
      obj.data.adList = [];
    }
    console.log('[JD] 已清理xview广告配置');
  }
  
  body = JSON.stringify(obj);
} catch (e) {
  console.log('[JD] 处理出错: ' + e.message);
}

$done({ body });
