#!/usr/bin/env node
/**
 * 专门分析闲鱼的 HAR 文件
 */

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const harFiles = fs.readdirSync(dir).filter(f => f.endsWith('.har'));

console.log('🐟 闲鱼请求分析\n');

const xianyuRequests = [];

for (const file of harFiles) {
  const content = fs.readFileSync(path.join(dir, file), 'utf-8');
  const har = JSON.parse(content);
  const entries = har.log?.entries || [];
  
  for (const entry of entries) {
    const url = entry.request?.url || '';
    
    // 只看闲鱼相关的请求
    if (url.includes('goofish') || 
        url.includes('idle') || 
        url.includes('taobao') ||
        url.includes('alicdn') ||
        url.includes('alipay') ||
        url.includes('alibaba')) {
      
      xianyuRequests.push({
        url: url,
        method: entry.request?.method,
        status: entry.response?.status,
        size: entry.response?.content?.size || 0,
        mimeType: entry.response?.content?.mimeType,
        responseText: entry.response?.content?.text?.substring(0, 500) || ''
      });
    }
  }
}

// 按域名分组
const byDomain = {};
for (const req of xianyuRequests) {
  try {
    const u = new URL(req.url);
    const domain = u.hostname;
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(req);
  } catch (e) {}
}

// 输出
for (const [domain, reqs] of Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📍 ${domain} (${reqs.length} 个请求)`);
  console.log(`${'═'.repeat(60)}`);
  
  // 去重 URL 路径
  const paths = {};
  for (const req of reqs) {
    try {
      const u = new URL(req.url);
      const pathKey = u.pathname;
      if (!paths[pathKey]) {
        paths[pathKey] = req;
      }
    } catch (e) {}
  }
  
  for (const [pathKey, req] of Object.entries(paths)) {
    console.log(`\n${req.method} ${pathKey}`);
    console.log(`   状态: ${req.status}, 大小: ${req.size} bytes`);
    
    // 检查响应中是否有广告相关内容
    const respLower = req.responseText.toLowerCase();
    if (respLower.includes('splash') || 
        respLower.includes('ad') ||
        respLower.includes('banner') ||
        respLower.includes('popup')) {
      console.log(`   ⚠️ 响应可能包含广告数据`);
    }
  }
}

// 特别关注 mtop 接口
console.log(`\n\n${'═'.repeat(60)}`);
console.log(`🔍 MTOP 接口列表（闲鱼核心API）`);
console.log(`${'═'.repeat(60)}`);

const mtopApis = new Set();
for (const req of xianyuRequests) {
  if (req.url.includes('/gw/mtop.')) {
    const match = req.url.match(/mtop\.[a-zA-Z0-9.]+/);
    if (match) {
      mtopApis.add(match[0]);
    }
  }
}

for (const api of [...mtopApis].sort()) {
  console.log(`   ${api}`);
}
