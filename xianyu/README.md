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
| 曝光上报 `mtop.idle.ad.expose`（g-acs） | 已纳入目标接口；Egern 只清已知广告容器，不伪造服务端结果 |

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml
```

Egern 原生版本 `eg-native-20261105-r1` 使用 [原生脚本](xianyu-ad-block.egern.js)。本版覆盖六个网关、新旧开屏、缓存广告、指定上报/场景恢复、悬浮策略与首页广告追踪。默认静默，不发送首次命中通知；旧 `NOTIFY_ONCE` 参数不再使用。

generic 入口“闲鱼去广告诊断”打印本地命中、移除数量和处理状态，并返回诊断 Widget；不发网络请求或通知，不保存请求/响应正文。模块 YAML 只挂已知目标接口；消息、交易和其它 MTOP 响应不读取、不改写。

HTTP 错误、失败 `ret`、非数组或空 `ret`、显式 `success=false` 都保留。`data` 为 JSON 字符串时保留字符串包装；JSONP、XML 或未知结构不尝试重构。已经读取的正文在解析/处理失败后显式返回，避免一次性流被丢弃。

两套实现的错误响应和上报分支行为不完全相同，不将模块导入成功视为跨客户端兼容验证。安装后需要启用 MITM，并安装、信任当前客户端自己的 CA 证书。

## 注意

- `tbs_vsucai` 视频库与商品内容共用域名，未整段拦截（避免误伤商品视频）
- 若仍有开屏：抓 HAR 后找 `creatives-assets` / 大于 1MB 的视频 URL，补充 REJECT 规则
- 闲鱼若加证书固定（App 打不开），关模块即恢复

## 旧配置与抓包辅助

[旧手动配置](xianyu-ad-block.conf) 的匹配范围不等同于当前模块，新安装优先使用 `.sgmodule`。现有 [抓包配置](xianyu-capture.conf) 仍把 `script-path` 指向去广告脚本，使用前需要校正为 [xianyu-capture.js](xianyu-capture.js)，不能直接当纯记录配置使用。

抓包辅助会输出请求、响应片段。采集结束后停用，分享前脱敏。

## 离线验证

需要 Node.js 20+，无需 npm 依赖。在仓库根目录运行：

```sh
node --input-type=module --check < xianyu/xianyu-ad-block.egern.js
node --test xianyu/tests/egern.test.cjs
```

测试使用虚构响应、内存存储及一次性正文。覆盖六网关、新旧开屏、字符串包装、错误 `ret`、严格 API 边界、未知字段、消费失败、幂等与静默诊断。不执行闲鱼真实请求，也不把离线通过当成真机广告消失。

[返回仓库首页](../README.md)
