# 京东去广告

重构自 [Thelongdarkorg/loon-plugins · jd_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-09-19 版），Loon 原生改写全部翻译为 Surge 等价语法。

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml
```

Egern 使用独立的 [原生脚本](jd-ad-block.egern.js)，配置另有 generic 诊断入口“京东去广告诊断”。自动响应处理保持静默，不发送通知；诊断记录说明的是实际命中与字段处理，不证明页面已经隐藏。

两种客户端均需安装、信任自己的 CA 证书，并启用对应解密设置；不要同时启用处理相同接口的重复模块。

## 覆盖范围

| 位置 | 方式 |
|---|---|
| 开屏广告（start 接口字段剥离，根除缓存回闪） | 脚本 |
| 首屏浮层/网页浮层（welcomeHome） | 脚本 |
| 物流页 banner（deliverLayer） | 脚本 |
| 购物车推荐楼层（cart） | 脚本 |
| 极速版广告位（lite_advertising 字段名替换） | 脚本 |
| 物料广告下发（queryMaterialAdverts） | Map Local 空 JSON |
| ADX 实时竞价（bdsp-x/dsp-x.jd.com） | URL Rewrite 拒绝 |
| 开屏大图（仅 s1125x2436_jfs 精确尺寸） | Map Local 空体 |
| 登录页推广 / 首页小组件 / 7 个推荐接口 | Map Local + 拒绝 |
| socket 监控与上报、httpdns | 脚本置零 |
| 诊断域名 jddebug.com | URL-REGEX 拒绝 |

## 工程决策（沿用原仓库 A/B 实证）

- **start 接口只剥字段不返回空对象**：App 收到 `{}` 会判异常并回退展示本地缓存开屏（隔几天偶发闪一次）；拔掉 JSON 里的开屏配置才能根除
- **开屏大图只拦 `s1125x2436_jfs` 精确路径**：360buyimg 是京东全站图片 CDN，通配 `jfs` 会把商品图一并打死（首页大面积空白）
- **360buyimg 只 MITM 单主机 `m.360buyimg.com`**：整域解密无必要

## 已知限制

- `start` 接口规则可能使「比价」功能失效，不需要可从 [Script] 中删除 start
- 常用功能仍需按实际 App 版本核验，网络改写不保证所有账号分组使用相同响应结构
- 若京东加证书固定（App 打不开），关模块即恢复

[返回仓库首页](../README.md)
