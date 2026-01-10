#!/usr/bin/env node
/**
 * HAR 文件分析脚本 - 提取开屏广告相关请求
 */

const fs = require('fs');
const path = require('path');

// 广告关键词
const AD_KEYWORDS = [
  // 开屏广告
  'splash', 'launch', 'startup', 'boot', 'openad',
  'splashad', 'launchad', 'startad',
  
  // 通用广告
  'advert', 'advertise', 'advertising', 'ad_',
  'banner', 'promotion', 'promo', 'creative',
  'adconfig', 'adinfo', 'addata', 'adlist',
  'getad', 'fetchad', 'loadad', 'requestad',
  
  // 京东
  'querymaterialadverts', 'getadconfig', 'getadvertising',
  'jdadunion', 'jdad',
  
  // 拼多多
  'oak/integration', 'fiora', 'alexa',
  'resource_splash', 'splash_screen',
  
  // 闲鱼/阿里
  'idlecommerce.splash', 'idleadv', 'idle.user.strategy',
  'mtop.taobao.idle',
  
  // 广告SDK
  'pangle', 'pangolin', 'csjad',
  'gdt', 'gdtad', 'mobads', 'adukwai'
];

// 分析单个 HAR 文件
function analyzeHar(filePath) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📁 分析文件: ${path.basename(filePath)}`);
  console.log(`${'='.repeat(60)}`);
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const har = JSON.parse(content);
  
  const entries = har.log?.entries || [];
  console.log(`📊 总请求数: ${entries.length}`);
  
  const adRequests = [];
  const domainStats = {};
  
  for (const entry of entries) {
    const url = entry.request?.url || '';
    const urlLower = url.toLowerCase();
    
    // 统计域名
    try {
      const domain = new URL(url).hostname;
      domainStats[domain] = (domainStats[domain] || 0) + 1;
    } catch (e) {}
    
    // 检查是否包含广告关键词
    let matchedKeyword = null;
    for (const keyword of AD_KEYWORDS) {
      if (urlLower.includes(keyword.toLowerCase())) {
        matchedKeyword = keyword;
        break;
      }
    }
    
    // 检查响应内容
    const responseText = entry.response?.content?.text || '';
    const responseLower = responseText.toLowerCase();
    
    if (!matchedKeyword) {
      for (const keyword of AD_KEYWORDS) {
        if (responseLower.includes(keyword.toLowerCase())) {
          matchedKeyword = `响应包含: ${keyword}`;
          break;
        }
      }
    }
    
    if (matchedKeyword) {
      adRequests.push({
        url: url,
        method: entry.request?.method,
        status: entry.response?.status,
        keyword: matchedKeyword,
        size: entry.response?.content?.size || 0,
        mimeType: entry.response?.content?.mimeType
      });
    }
  }
  
  // 输出广告请求
  console.log(`\n🔴 疑似广告请求: ${adRequests.length} 个`);
  console.log(`${'─'.repeat(60)}`);
  
  for (const req of adRequests) {
    console.log(`\n📍 ${req.method} ${req.url.substring(0, 120)}${req.url.length > 120 ? '...' : ''}`);
    console.log(`   关键词: ${req.keyword}`);
    console.log(`   状态: ${req.status}, 大小: ${req.size} bytes`);
  }
  
  // 输出域名统计（前20个）
  console.log(`\n📊 域名统计 (前20):`);
  console.log(`${'─'.repeat(60)}`);
  
  const sortedDomains = Object.entries(domainStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  for (const [domain, count] of sortedDomains) {
    console.log(`   ${count.toString().padStart(4)} 次 - ${domain}`);
  }
  
  return { adRequests, domainStats, total: entries.length };
}

// 主函数
function main() {
  const dir = __dirname;
  const harFiles = fs.readdirSync(dir).filter(f => f.endsWith('.har'));
  
  console.log(`\n🔍 开屏广告抓包分析工具`);
  console.log(`📂 目录: ${dir}`);
  console.log(`📄 HAR 文件数: ${harFiles.length}`);
  
  const allAdRequests = [];
  const allDomains = {};
  
  for (const file of harFiles) {
    const result = analyzeHar(path.join(dir, file));
    allAdRequests.push(...result.adRequests);
    
    for (const [domain, count] of Object.entries(result.domainStats)) {
      allDomains[domain] = (allDomains[domain] || 0) + count;
    }
  }
  
  // 汇总
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 汇总分析`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`🔴 总疑似广告请求: ${allAdRequests.length} 个`);
  
  // 去重 URL
  const uniqueUrls = [...new Set(allAdRequests.map(r => {
    try {
      const u = new URL(r.url);
      return `${u.hostname}${u.pathname}`;
    } catch (e) {
      return r.url;
    }
  }))];
  
  console.log(`\n📋 去重后的广告 URL 模式:`);
  console.log(`${'─'.repeat(60)}`);
  for (const url of uniqueUrls) {
    console.log(`   ${url}`);
  }
}

main();
