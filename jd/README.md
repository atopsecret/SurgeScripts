# 京东去广告 2.0.0

重构自 [Thelongdarkorg/loon-plugins · jd_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-09-19 版）。2.0.0 对照 Kelee 固定镜像补全四个页面接口；Surge 与 Egern 分别使用各自原生模块和脚本，共用策略在构建时内联，不依赖远程运行时。

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml
```

两端脚本版本均为 `2.0.0`。Egern 使用独立的 [原生脚本](jd-ad-block.egern.js)，另有 generic 诊断入口“京东去广告诊断”。诊断打印本地状态并返回诊断 Widget，不发通知、不访问网络，不保存 URL、请求正文或商品信息。记录的是实际接口命中和字段处理，不证明页面已经隐藏。

两端查询参数都不要求 `functionId` 排第一。Egern 还支持查询缺少 ID 时从 POST 表单或 JSON 读取；Surge 的可选关联方式见下文。重复、编码身份键、非法 `functionId`、非目标接口、非京东主机不猜测、不读取响应；JSON 中转义后重复的 `functionId` 也放行。只改 HTTP `200` 的完整 JSON；显式失败、陌生 `code` 和畸形 `ret` 保留。Egern 使用 `arrayBuffer()` 只读一次，严格解码 UTF-8；无变化、无效字节、未知 JSON 和处理异常返回保存的原字节。改写时维护正文相关头，保留未触及的多值头。

两种客户端均需安装、信任自己的 CA 证书，并启用对应解密设置；不要同时启用处理相同接口的重复模块。

## 覆盖范围

| 位置 | 方式 |
|---|---|
| 开屏广告（start 接口字段剥离） | 脚本；不直接删除 App 缓存 |
| 首屏浮层/网页浮层（welcomeHome） | 脚本 |
| 物流页 banner（deliverLayer） | 脚本 |
| 物流页 banner 变体（orderTrackBusiness） | 脚本 |
| 新品页悬浮图/二楼（getTabHomeInfo） | 脚本 |
| 订单页推广楼层（myOrderInfo） | 脚本；不改客户服务提示、评价提醒和正常订单数据 |
| 我的页面已知促销（personinfoBusiness） | 脚本；不采用工具栏固定白名单，不改变未知工具顺序 |
| 购物车推荐楼层（cart） | 脚本 |
| 极速版广告位（lite_advertising 字段名替换） | 两端只改 JSON 字段名，不替换字符串值 |
| 已知亮色/深色底栏（readCustomSurfaceList） | 脚本；未知结构、缺少核心入口时保留 |
| 物料广告下发（queryMaterialAdverts） | Map Local 空 JSON |
| ADX 实时竞价（bdsp-x/dsp-x.jd.com） | URL Rewrite 拒绝 |
| 开屏大图（仅 s1125x2436_jfs 精确尺寸） | Map Local 空体 |
| 登录页推广 / 首页小组件 / 9 个推荐接口（含 uniformRecommend0/6） | Map Local + 拒绝 |
| socket 监控与上报、httpdns | 脚本置零 |
| 诊断域名 jddebug.com | URL-REGEX 拒绝 |

## 工程决策

- **start 接口只剥字段不返回空对象**：保留正常配置，减少客户端回退风险；是否停止展示旧缓存需要真机验证
- **开屏大图只拦 `s1125x2436_jfs` 精确路径**：360buyimg 是京东全站图片 CDN，通配 `jfs` 会把商品图一并打死（首页大面积空白）
- **HTTPS 主机按规则完整声明**：`api.m.jd.com`、`m.360buyimg.com`、`apk.360buyimg.com`、`bdsp-x.jd.com`、`dsp-x.jd.com`；不解密无关京东域名
- 两端保留非 HTTP 200、非成功码与未知响应，不在错误响应上清广告字段
- 导航文字协议只删除“逛/逛逛/视频/短视频”，至少保留两个项目并保持未知入口顺序；旧 ID 协议只删除来源样本明确的 `video`，并要求 `index`、`cart`、`home` 完整，不再复制旧工具白名单
- `lite_advertising` 只改 JSON 键名，保护目标键冲突，不改商品名称或说明文字
- Surge 使用 `binary-body-mode=true,full-header-mode=true,engine=webview`；Egern 使用严格 UTF-8 和原生 Headers。两端改写会清理旧长度、压缩、ETag、MD5、缓存头，保留未知头和多值 Cookie

## 已知限制

- 来源提示 `start` 处理可能影响比价；本轮未做真机复现。Surge 可从响应脚本 `pattern` 的接口列表移除 `start` 并保持可选 POST 捕获关闭。
- Surge 官方响应脚本没有 `$request.body`。仓库提供 [可选 POST 关联脚本](jd-post-capture.js)，模块中整行注释，默认关闭；只覆盖没有查询字符串的 `/client.action`。明确需要时去掉该行注释，须接受请求正文 `max-size=33554432`（32 MiB）超限会终止连接及额外内存开销。它不改出站请求，只保存稳定 `$request.id`、目标接口与 60 秒到期时间，最多 64 项；无稳定 ID、存储失败、过期或并发丢更新时放行。存储没有 CAS，不承诺绝对关联。
- 静态本地规则只接受 ASCII 原始参数键、唯一的完整 ID 值；编码的参数键、编码的目标 ID 值和陌生格式保守放行。普通参数值可携带 URL 编码，不按接口名前缀匹配。
- 常用功能仍需按实际 App 版本核验，网络改写不保证所有账号分组使用相同响应结构
- 若京东加证书固定（App 打不开），关模块即恢复

## 离线验证

需要 Node.js 20+，无需 npm 依赖。在仓库根目录运行：

```sh
node jd/build.mjs --check
node --input-type=module --check < jd/jd-ad-block.egern.js
node --check jd/jd-ad-block.js
node --check jd/jd-post-capture.js
node --experimental-vm-modules --test jd/tests/*.test.cjs
```

京东 **44/44 → 82/82**，包括原生、Surge 与十二接口的一致性和幂等验证。测试使用内存存储及一次性响应流，覆盖四个 Kelee 页面分支、未知业务、编码/重复参数、错误放行、原字节、多值头、POST 关联 TTL/容量/异常和默认关闭行为。完整记录见[本次验证记录](../egern/验证记录-京东菜鸟-20261108.md)。测试不执行真实京东请求；模块加载、MITM 信任和页面效果仍需在客户端验收。

## 补全来源

Kelee 原站本轮返回 403；采用 [Moli-X 固定活动插件](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/JD_remove_ads.plugin)及其[引用脚本](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/Script/JD_remove_ads.js)，与 `fkingikelee/fkikelee@d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0` 的活动 LPX 和脚本交叉核对。两份脚本 SHA-256 均为 `c029c4151fe73b3a6f660d0933393d1b6afd1969651f01a88d5a357abfdd7cb4`，脚本声明来源 RuCu6。只参考端点与字段，未复制其工具保留名单和排序；不能据镜像声称核实了原站当前最新版。

## 构建

修改 [jd-policy.js](jd-policy.js) 或三个运行时模板后，在仓库根目录执行 `node jd/build.mjs`。策略会分别内联到 Surge、Egern 和可选 POST 请求脚本；生成文件不加载外部脚本。`node jd/build.mjs --check` 用于确认没有 stale 产物。

[返回仓库首页](../README.md)
