# 拼多多去广告

重构自 [Thelongdarkorg/loon-plugins · pinduoduo_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-10-07 更新版）。

## 安装

```
https://raw.githubusercontent.com/skernelx/SurgeScripts/master/pinduoduo/pdd-adblock.sgmodule
```

## 原理

| 层 | 方式 |
|---|---|
| 开屏接口 `api/cappuccino/splash` | Map Local 空体 200，App 判定无开屏直接进主界面 |
| 开屏素材（裸 IP + `/d` 路径直连下发） | URL-REGEX + 拼多多 UA 双条件拦截（`com.xunmeng.pinduoduo`） |
| 开屏接口 QUIC 旁路 | AND 规则阻断该域 QUIC，逼流量走 TCP 让 MITM 生效 |

## 设计边界（刻意不做）

- **只处理开屏广告**。App 内的运营弹窗、红包雨、签到弹窗属于运营内容而非广告 SDK，拦它们容易误伤签到/领券功能
- 素材拦截带 UA 限定，不影响其他 App 的同形请求
