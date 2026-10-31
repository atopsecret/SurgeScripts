# 红果短剧去广告

拦截红果短剧 / 番茄系 App 的插播广告、穿山甲广告 SDK 与埋点追踪，共 75 条精确域名规则。

## 原理

广告视频与正片视频走**不同子域名**：

- 正片：`v*-reading-video.qznovelvod.com` → 放行
- 广告：`v*-reading-ad.qznovelvod.com` → 拦截

只拦广告专用子域名，不用通配符，正片播放零影响。

## 安装

Surge iOS：模块 → 安装新模块，粘贴：

```
https://raw.githubusercontent.com/skernelx/SurgeScripts/master/hongguo/hongguo-adblock.sgmodule
```

## 覆盖范围

| 分类 | 示例 |
|---|---|
| 插播广告视频 CDN | `v*-reading-ad.qznovelvod.com` |
| 穿山甲广告 SDK | `pangle.io`、`pangolin-sdk-toutiao.com` |
| 字节广告分发 | `ads*-normal-*.zijieapi.com`、`p*-ad-sign.byteimg.com` |
| 番茄埋点 | `log*/rtlog*/mon*-*.fqnovel.com` |
| 友盟统计 | `*.umeng.com` |
| 其他 App 追踪 | 小红书埋点、腾讯 beacon、小爱 tracker 等 |
| 防 DoH 绕过 | `dns.alidns.com`、`doh.pub` |

## 已知限制

- 直播间广告与直播流同域名，无法拦截
- 已缓存的广告不受影响（DNS 层只拦新请求）
- 需主动看激励视频解锁的剧集，广告会加载失败
- 部分剧集若强依赖广告返回数据，可能出现短暂"广告加载中"后跳过，属预期行为

## 规则来源

域名清单来自 [abclq/home-dns-adblock](https://github.com/abclq/home-dns-adblock)（MIT 协议），基于真实设备 DNS 日志提取，上游项目持续维护中。本模块内嵌快照，更新时可对照上游 `dist/clash-surge-rules.txt` 同步。
