# 闲鱼去广告

## v2.1（2026-11-01，基于三份 HAR 抓包分析）

新版闲鱼开屏链路重构，本模块随之升级：

| 变化 | 应对 |
|---|---|
| 开屏接口从 `splash.async.ads/1.0` 改为 `splash.ads/2.0` | 正则改为 `splash\.(async\.)?ads` 双兼容 |
| 广告走 `cacheAd` 本地缓存引用下发（`adMap` 为空也有广告） | 脚本清空 `cacheAd` / 删除 `cacheAdInfo` / 清 `dspList` |
| 新网关 `g-acs.m.goofish.com` | MITM 已覆盖 |
| 广告创意素材走 `ossgw.alicdn.com/creatives-assets/` | URL Rewrite 直接拒绝 |
| TANX 广告交易打点 `bdlog/df.tanx.com` | URL Rewrite 直接拒绝 |
| 曝光上报 `mtop.idle.ad.expose`（g-acs） | 脚本伪造无广告回包 |

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml
```

Egern 使用 [原生脚本](xianyu-ad-block.egern.js)，保留服务端错误和未知字段，并附带 generic 诊断入口“闲鱼去广告诊断”。默认 `NOTIFY_ONCE: 'true'` 会在本版首次开屏命中时尝试发送无声诊断通知；可在导入配置中改为 `'false'`。

两套实现的错误响应和上报分支行为不完全相同，不将模块导入成功视为跨客户端兼容验证。安装后需要启用 MITM，并安装、信任当前客户端自己的 CA 证书。

## 注意

- `tbs_vsucai` 视频库与商品内容共用域名，未整段拦截（避免误伤商品视频）
- 若仍有开屏：抓 HAR 后找 `creatives-assets` / 大于 1MB 的视频 URL，补充 REJECT 规则
- 闲鱼若加证书固定（App 打不开），关模块即恢复

## 旧配置与抓包辅助

[旧手动配置](xianyu-ad-block.conf) 的匹配范围不等同于当前模块，新安装优先使用 `.sgmodule`。现有 [抓包配置](xianyu-capture.conf) 仍把 `script-path` 指向去广告脚本，使用前需要校正为 [xianyu-capture.js](xianyu-capture.js)，不能直接当纯记录配置使用。

抓包辅助会输出请求、响应片段。采集结束后停用，分享前脱敏。

[返回仓库首页](../README.md)
