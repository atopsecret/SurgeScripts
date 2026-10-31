# 红果短剧去广告 · 融合版

[HongGuo Lite](https://github.com/k6nfmm7dbr-commits/hongguo-lite)（Minis）与 [home-dns-adblock](https://github.com/abclq/home-dns-adblock)（abclq）的融合模块，取两者并集：**80 条规则**，装这一个即可，替代原 hongguo-lite / hongguo-lite-plus。

## 安装

Surge iOS：模块 → 安装新模块，粘贴：

```
https://raw.githubusercontent.com/skernelx/SurgeScripts/master/hongguo/hongguo-adblock.sgmodule
```

安装本模块前，**先卸载手机上的「红果短剧瘦身 · HongGuo Lite (Plus)」**，避免 MITM 配置叠加。

## 融合了什么

| 来源 | 贡献 |
|---|---|
| HongGuo Lite | `DOMAIN-KEYWORD,pangolin` 覆盖整个穿山甲 SDK 家族；广告接口 Map Local 返回空 JSON（SDK 不重试）；`-ad-sign.byteimg.com` 素材签名域 |
| home-dns-adblock | `*-reading-ad.qznovelvod.com` 插播广告视频源（9 条，lite 完全没有）；fqnovel 埋点显式子域；友盟/小红书/腾讯埋点；防 DoH 绕过 |

## 相对 hongguo-lite-plus 的三处修正

1. **`DOMAIN-REGEX,^ads[0-9]+-normal...` 在 Surge iOS 5.23 被判无效配置**（启动日志有 WARNING，整行被忽略）——改为 6 条显式 `DOMAIN-SUFFIX`，`ads3/ads5-normal-*.zijieapi.com` 真正拦上了
2. **lite 的 `DOMAIN-KEYWORD,applog.fqnovel.com` / `-misc.fqnovel.com` 匹配不到 `log3-applog-lf.fqnovel.com` 这类横杠拼接子域**（keyword 是子串匹配，"applog.fqnovel.com" 不是其子串）——用 10 条显式子域补齐
3. **移除 `*.snssdk.com` 的 MITM**：该域包含视频 CDN（`video-edge-all.snssdk.com`），字节 App 不认 Surge CA 证书，实测单日产生 2700+ 次 TLS 握手失败、拖累视频加载。域名层拦截已覆盖绝大多数广告，MITM 该域弊大于利。如需拦截红果自有 API 下发的广告（`/api/ad/` 路径），模块文末有注释掉的可选段

## 原理

广告视频与正片走不同子域名：

- 正片：`v*-reading-video.qznovelvod.com` → 放行
- 广告：`v*-reading-ad.qznovelvod.com` → 拦截

只拦广告专用子域，不用通配符整域，正片播放零影响。

## 已知限制

- 直播间广告与直播流同域名，无法拦截
- 已缓存的广告不受影响（DNS 层只拦新请求）
- 金币 / 看广告解锁类入口会加载失败，属预期行为
- 模块含 `dns.alidns.com` / `doh.pub` 两条防 DoH 绕过规则，**日后若在主配置启用 doh-server，先删这两条**

## 验证

Surge 请求记录 → 打开红果 → 确认以下请求显示 REJECT：

- `pangolin-sdk-toutiao.com`
- `ads3-normal-*.zijieapi.com`
- `*-reading-ad.qznovelvod.com`（刷剧触发插播时）

## 致谢与协议

- [k6nfmm7dbr-commits/hongguo-lite](https://github.com/k6nfmm7dbr-commits/hongguo-lite)（MIT，作者 Minis）
- [abclq/home-dns-adblock](https://github.com/abclq/home-dns-adblock)（MIT，作者 abclq）
