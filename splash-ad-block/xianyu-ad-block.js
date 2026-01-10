/**
 * 闲鱼去开屏广告脚本
 * 基于抓包分析，精准屏蔽闲鱼开屏广告
 */

const url = $request.url;
let body = $response.body;

try {
  let obj = JSON.parse(body);
  
  // 开屏广告接口
  if (url.includes('idlecommerce.splash')) {
    // 清空广告数据
    if (obj.data) {
      if (obj.data.ads) obj.data.ads = [];
      if (obj.data.adList) obj.data.adList = [];
      if (obj.data.splashAds) obj.data.splashAds = [];
      if (obj.data.splash) obj.data.splash = null;
      if (obj.data.result) {
        if (obj.data.result.ads) obj.data.result.ads = [];
        if (obj.data.result.adList) obj.data.result.adList = [];
      }
    }
    // mtop 接口格式
    if (obj.ret && obj.ret[0] === 'SUCCESS::调用成功') {
      if (obj.data) {
        obj.data = {};
      }
    }
    console.log('[闲鱼] 已清理开屏广告');
  }
  
  // 广告上报接口 - 返回成功但不做任何事
  if (url.includes('idleadv.app.launch.report')) {
    obj = { ret: ['SUCCESS::调用成功'], data: {} };
    console.log('[闲鱼] 已拦截广告上报');
  }
  
  // 广告场景恢复
  if (url.includes('idleadv.scene.restore')) {
    if (obj.data) {
      obj.data = {};
    }
    console.log('[闲鱼] 已清理广告场景');
  }
  
  // 用户策略（悬浮球/弹窗）
  if (url.includes('user.strategy.list')) {
    if (obj.data) {
      if (obj.data.strategyList) obj.data.strategyList = [];
      if (obj.data.list) obj.data.list = [];
      if (obj.data.floatBall) obj.data.floatBall = null;
      if (obj.data.popup) obj.data.popup = null;
      if (obj.data.bubble) obj.data.bubble = null;
    }
    console.log('[闲鱼] 已清理悬浮球/弹窗');
  }
  
  // 首页圈子列表
  if (url.includes('home.circle.list')) {
    if (obj.data && obj.data.list) {
      // 过滤掉广告类型的圈子
      obj.data.list = obj.data.list.filter(item => {
        const type = (item.type || '').toLowerCase();
        const bizType = (item.bizType || '').toLowerCase();
        return !type.includes('ad') && 
               !bizType.includes('ad') &&
               !type.includes('promotion') &&
               !bizType.includes('promotion');
      });
    }
    console.log('[闲鱼] 已清理首页圈子广告');
  }
  
  // 首页刷新
  if (url.includes('home.nextfresh')) {
    function cleanFeedAds(data) {
      if (!data) return data;
      
      // 清理广告字段
      if (data.ads) data.ads = [];
      if (data.adList) data.adList = [];
      if (data.bannerAd) data.bannerAd = null;
      if (data.insertAd) data.insertAd = null;
      
      // 过滤列表中的广告
      if (data.list && Array.isArray(data.list)) {
        data.list = data.list.filter(item => {
          const type = (item.type || '').toLowerCase();
          const bizType = (item.bizType || '').toLowerCase();
          const itemType = (item.itemType || '').toLowerCase();
          return !type.includes('ad') && 
                 !bizType.includes('ad') &&
                 !itemType.includes('ad') &&
                 !type.includes('promotion');
        });
      }
      
      return data;
    }
    
    if (obj.data) {
      obj.data = cleanFeedAds(obj.data);
    }
    console.log('[闲鱼] 已清理首页信息流广告');
  }
  
  // 活动查询
  if (url.includes('activity.query')) {
    if (obj.data) {
      // 过滤广告类型的活动
      if (obj.data.activityList) {
        obj.data.activityList = obj.data.activityList.filter(item => {
          const type = (item.type || '').toLowerCase();
          return !type.includes('ad') && !type.includes('promotion');
        });
      }
      if (obj.data.list) {
        obj.data.list = obj.data.list.filter(item => {
          const type = (item.type || '').toLowerCase();
          return !type.includes('ad') && !type.includes('promotion');
        });
      }
    }
    console.log('[闲鱼] 已清理活动广告');
  }
  
  // 首页配置
  if (url.includes('home.config')) {
    if (obj.data) {
      // 关闭广告相关配置
      if (obj.data.adConfig) obj.data.adConfig = {};
      if (obj.data.splashConfig) obj.data.splashConfig = {};
      if (obj.data.floatConfig) obj.data.floatConfig = {};
      if (obj.data.popupConfig) obj.data.popupConfig = {};
    }
    console.log('[闲鱼] 已清理首页广告配置');
  }
  
  body = JSON.stringify(obj);
} catch (e) {
  console.log('[闲鱼] 处理出错: ' + e.message);
}

$done({ body });
