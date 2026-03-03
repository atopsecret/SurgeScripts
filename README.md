# Surge 脚本集合

个人使用的 Surge 脚本合集，包含自动签到、去广告、路由优化等功能。

## 📦 模块列表

### 1. Google AI 路由优化 🆕

让所有 Google AI 相关请求走美国节点，提升访问稳定性。

**一键安装：** [点击安装模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/google-ai-routing.sgmodule)

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/google-ai-routing.sgmodule
```

**优化服务：**
- ✅ Google AI Studio (aistudio.google.com)
- ✅ Gemini API (generativelanguage.googleapis.com)
- ✅ Google Bard/Gemini (bard.google.com, gemini.google.com)
- ✅ Google Cloud AI Platform
- ✅ Google Vertex AI

**使用方法：**
1. 安装模块，选择你的美国节点名称
2. 重新加载 Surge 配置
3. 访问 Google AI 服务时会自动走美国节点

**相关文件：**
- 模块文件: `google-ai-routing.sgmodule`
- 配置文件: `google-ai-routing.conf`

---

### 2. 闲鱼去广告

基于抓包分析，精准屏蔽闲鱼APP各类广告。

**一键安装：** [点击安装模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule)

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule
```

**屏蔽内容：**
- ✅ 开屏广告（启动时的全屏广告）
- ✅ 首页悬浮球广告
- ✅ 弹窗广告
- ✅ 广告追踪参数

**相关文件：**
- 模块文件: `xianyu/xianyu-ad-block.sgmodule`
- 脚本文件: `xianyu/xianyu-ad-block.js`
- 配置文件: `xianyu/xianyu-ad-block.conf`

---

### 3. 蔚来自动签到

蔚来APP全自动签到脚本，支持Token自动抓取。

**一键安装：** [点击安装模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.sgmodule)

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.sgmodule
```

**功能特性：**
- ✅ Token自动抓取（打开蔚来APP即可）
- ✅ 每天早上9点自动签到
- ✅ 显示连续签到天数
- ✅ Token过期自动提醒

**使用方法：**
1. 安装模块后，打开蔚来APP进行任意操作
2. 脚本会自动抓取并保存Token
3. 第二天早上9点自动签到
4. 手动签到：Safari访问 `https://weilai.checkin.local/`

**相关文件：**
- 模块文件: `weilai/weilai-auto-checkin.sgmodule`
- 脚本文件: `weilai/weilai-auto-checkin.js`
- 配置文件: `weilai/weilai-surge-config.conf`

---

### 4. 闲鱼抓包辅助

用于分析闲鱼APP的广告接口，为去广告脚本提供数据支持。

**相关文件：**
- 脚本文件: `xianyu/xianyu-capture.js`
- 配置文件: `xianyu/xianyu-capture.conf`

---

## 🚀 安装方法

### 方式一：模块安装（推荐）

1. 打开 Surge → 首页 → 模块
2. 点击右上角 `+` 添加模块
3. 粘贴模块链接，点击确定
4. 开启模块即可

### 方式二：手动配置

1. 下载脚本文件到 Surge 脚本目录
2. 将 `.conf` 文件内容添加到 Surge 主配置文件

---

## 📊 闲鱼广告接口分析

基于 2026-01-05/06 的抓包分析，闲鱼主要广告接口如下：

| 接口 | 说明 | 处理方式 |
|-----|------|---------|
| `mtop.taobao.idlecommerce.splash.async.ads` | 开屏广告 | 清空adMap |
| `mtop.idle.idleadv.app.launch.report` | 广告上报 | 返回失败 |
| `mtop.idle.idleadv.scene.restore` | 广告场景恢复 | 返回失败 |
| `mtop.taobao.idle.user.strategy.list` | 悬浮球/弹窗 | 过滤广告策略 |
| `mtop.taobao.idlehome.home.circle.list` | 首页Tab | 清理追踪参数 |

---

## ⚠️ 注意事项

- 确保 Surge 的 MITM 功能已开启
- 确保已安装并信任 Surge 的 CA 证书
- 脚本仅供学习交流使用
- 如遇问题可在 Issues 反馈

---

## 📝 更新日志

### 2026-01-08
- 🆕 新增 Google AI 路由优化模块
- 让所有 Google AI 相关请求走美国节点
- 支持 Google AI Studio、Gemini API、Bard 等服务
- 提供 .sgmodule 模块和 .conf 配置两种方式

### 2026-01-06
- 🆕 新增 `.sgmodule` 模块格式，支持一键安装
- 🆕 新增闲鱼去广告脚本
- 基于抓包分析精准屏蔽开屏广告
- 支持屏蔽悬浮球、弹窗等广告

### 2026-01-05
- 新增闲鱼抓包辅助脚本
- 整理仓库结构

### 2026-01-04
- 蔚来签到脚本更新至 v2.0.2

---

## 📄 License

MIT License
