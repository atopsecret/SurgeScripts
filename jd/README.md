# 京东去广告

重构自 [Thelongdarkorg/loon-plugins · jd_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-09-19 版）。Surge 与 Egern 分别使用各自原生模块和脚本，不共享全局变量适配器。

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml
```

Egern 原生版本 `eg-native-20261105-r1` 使用独立的 [原生脚本](jd-ad-block.egern.js)，另有 generic 诊断入口“京东去广告诊断”。诊断打印本地状态并返回诊断 Widget，不发通知、不访问网络，不保存 URL、请求正文或商品信息。记录的是实际接口命中和字段处理，不证明页面已经隐藏。

查询参数不要求 `functionId` 排第一；支持查询参数缺失时的已知 POST 表单或 JSON 格式。重复或非法 `functionId`、非目标接口、非京东主机不猜测、不读取响应。HTTP 错误，以及显式失败或陌生 `code` 的业务响应原样放行。已读取正文后解析失败，显式返回原文，避免一次性响应流被丢弃。

两种客户端均需安装、信任自己的 CA 证书，并启用对应解密设置；不要同时启用处理相同接口的重复模块。

## 覆盖范围

| 位置 | 方式 |
|---|---|
| 开屏广告（start 接口字段剥离，根除缓存回闪） | 脚本 |
| 首屏浮层/网页浮层（welcomeHome） | 脚本 |
| 物流页 banner（deliverLayer） | 脚本 |
| 购物车推荐楼层（cart） | 脚本 |
| 极速版广告位（lite_advertising 字段名替换） | 脚本；Egern 只改 JSON 字段名，不替换字符串值 |
| 已知亮色/深色底栏（readCustomSurfaceList） | 脚本；未知结构、缺少核心入口时保留 |
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
- Egern 保留 HTTP 错误和非成功码；不是在所有响应上无条件去广告
- 导航标签协议只删除“逛/逛逛/视频/短视频”，保留秒送等其它标签；旧 ID 协议沿用来源白名单，但缺少首页、购物车、我的时不执行

## 已知限制

- `start` 接口规则可能使「比价」功能失效，不需要可从 [Script] 中删除 start
- 常用功能仍需按实际 App 版本核验，网络改写不保证所有账号分组使用相同响应结构
- 若京东加证书固定（App 打不开），关模块即恢复

## 离线验证

需要 Node.js 20+，无需 npm 依赖。在仓库根目录运行：

```sh
node --input-type=module --check < jd/jd-ad-block.egern.js
node --test jd/tests/egern.test.cjs
```

测试使用内存存储和一次性 `Response` 正文，覆盖八接口、导航未知结构、精确归属、错误放行、正文单次消费、静默诊断及商品图片负例。测试不执行真实京东请求；模块下载、MITM 信任和页面效果仍需在 Egern 内验收。

[返回仓库首页](../README.md)
