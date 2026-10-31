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

```
https://raw.githubusercontent.com/skernelx/SurgeScripts/master/xianyu/xianyu-ad-block.sgmodule
```

## 注意

- `tbs_vsucai` 视频库与商品内容共用域名，未整段拦截（避免误伤商品视频）
- 若仍有开屏：抓 HAR 后找 `creatives-assets` / 大于 1MB 的视频 URL，补充 REJECT 规则
- 闲鱼若加证书固定（App 打不开），关模块即恢复
