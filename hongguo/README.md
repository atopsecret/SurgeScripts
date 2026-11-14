# 红果短剧去广告 · 融合版

[HongGuo Lite](https://github.com/k6nfmm7dbr-commits/hongguo-lite)（Minis）与 [home-dns-adblock](https://github.com/abclq/home-dns-adblock)（abclq）的融合模块，保留广告/上报集合并排除公共 DoH：**78 条规则**。Surge 已归并到原 [hongguo-adblock.sgmodule](<hongguo-adblock.sgmodule>)，与现用 Egern 的广告范围一致；替代重复的 hongguo-lite / hongguo-lite-plus，不封锁主配置使用的公共 DNS。

## 安装

Surge iOS：模块 → 安装新模块，粘贴：

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.sgmodule
```

安装本模块前，先停用重复的 HongGuo Lite / Plus 模块，避免重复规则和 MITM 配置叠加。

### Egern 原生版

在 Egern 模块管理中添加：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.egern.yaml
```

两端现用模块均为 78 条广告/上报条件，已经省去 `dns.alidns.com`、`doh.pub` 拒绝规则，保留主配置公共 DNS。广告接口的空 JSON 只匹配穿山甲 SDK 三个已知域名族，不匹配伪造的主机前后缀。

域名拒绝不需要 MITM。穿山甲 HTTPS 广告接口的本地空响应需要启用 MITM 并安装、信任 **Egern 自己的 CA**；不解密整个 `snssdk.com`。静态格式和匹配验证不等于手机广告已消失。

## 融合了什么

| 来源 | 贡献 |
|---|---|
| HongGuo Lite | `DOMAIN-KEYWORD,pangolin` 覆盖整个穿山甲 SDK 家族；广告接口 Map Local 返回空 JSON（SDK 不重试）；`-ad-sign.byteimg.com` 素材签名域 |
| home-dns-adblock | `*-reading-ad.qznovelvod.com` 插播广告视频源（9 条，lite 完全没有）；fqnovel 埋点显式子域；友盟/小红书/腾讯埋点；公共 DoH 拒绝未迁入 |

## 相对 hongguo-lite-plus 的三处修正

1. **`DOMAIN-REGEX,^ads[0-9]+-normal...` 在 Surge iOS 5.23 被判无效配置**（启动日志有 WARNING，整行被忽略）——改为 6 条显式 `DOMAIN-SUFFIX`，`ads3/ads5-normal-*.zijieapi.com` 真正拦上了
2. **lite 的 `DOMAIN-KEYWORD,applog.fqnovel.com` / `-misc.fqnovel.com` 匹配不到 `log3-applog-lf.fqnovel.com` 这类横杠拼接子域**（keyword 是子串匹配，"applog.fqnovel.com" 不是其子串）——用 10 条显式子域补齐
3. **移除 `*.snssdk.com` 的 MITM**：该域包含视频 CDN（`video-edge-all.snssdk.com`），字节 App 不认 Surge CA 证书，实测单日产生 2700+ 次 TLS 握手失败、拖累视频加载。域名层拦截已覆盖绝大多数广告，MITM 该域弊大于利。当前模块不附带整域可选解密段，只追加穿山甲三个域名族

## 原理

广告视频与正片走不同子域名：

- 正片：`v*-reading-video.qznovelvod.com` → 放行
- 广告：`v*-reading-ad.qznovelvod.com` → 拦截

规则限定已知广告子域，没有封锁整个视频服务；新域名、缓存及服务端分流仍需实际验证。

## 已知限制

- 直播间广告与直播流同域名，无法拦截
- 已缓存的广告不受影响（DNS 层只拦新请求）
- 金币 / 看广告解锁类入口会加载失败，属预期行为
- 模块不拒绝 `dns.alidns.com` / `doh.pub`，不携带全局 DNS、CA 或代理；穿山甲 HTTPS Map Local 需在所用客户端信任自己的 CA

## 验证

Surge 请求记录 → 打开红果 → 确认以下请求显示 REJECT：

- `pangolin-sdk-toutiao.com`
- `ads3-normal-*.zijieapi.com`
- `*-reading-ad.qznovelvod.com`（刷剧触发插播时）

2026-11-14 原目录归并验证：[canonical 回归](<tests/canonical.test.cjs>) **1/1**，确认恰好 78 条规则、保留公共 DoH 与正片视频主机；共享静态测试逐项对照 Map Local 的状态、头和精确字节。

```sh
node --require ./egern/tests/offline-guard.cjs --test hongguo/tests/canonical.test.cjs egern/tests/common-canonical.test.cjs
```

## 致谢与协议

- [k6nfmm7dbr-commits/hongguo-lite](https://github.com/k6nfmm7dbr-commits/hongguo-lite)（MIT，作者 Minis）
- [abclq/home-dns-adblock](https://github.com/abclq/home-dns-adblock)（MIT，作者 abclq）
