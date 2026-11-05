# 拼多多去广告

重构自 [Thelongdarkorg/loon-plugins · pinduoduo_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-10-07 更新版）。

## 安装

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.sgmodule
```

## 原理与当前范围

| 层 | 方式 |
|---|---|
| 开屏接口 `api/cappuccino/splash` | Map Local 空体 200，App 判定无开屏直接进主界面 |
| 开屏素材（裸 IP + `/d` 路径直连下发） | URL-REGEX + 拼多多 UA 双条件拦截（`com.xunmeng.pinduoduo`） |
| 开屏接口 QUIC 旁路 | AND 规则阻断该域 QUIC，逼流量走 TCP 让 MITM 生效 |
| 首页、个人中心与会场页面 | 自托管脚本清理已知底栏和推广字段 |
| 订单与搜索页面 | 清理已知营销字段，不重构未知响应 |
| 多多视频浮层与指定运营接口 | 返回空 HTML 或 JSON |

## 处理边界

- 当前不只处理开屏，运营、推荐和签到领券入口可能受影响。功能异常时先停用模块做对照，再缩小到具体规则
- 素材拦截带 UA 限定，不影响其他 App 的同形请求
- 响应脚本最多处理 131072 字节，超过大小或字段结构变化时可能不执行页面改写
- 本模块不自动修改主配置的 IPv6 或 DNS 设置；HTTPS 接口改写依赖客户端实际接管、MITM 与证书信任
- 本目录没有 Egern 原生 YAML

相关文件：[模块](pdd-adblock.sgmodule)、[页面脚本](pdd-ad-block.js)。

[返回仓库首页](../README.md)
