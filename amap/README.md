# 高德地图去广告

**2.1.0 页面补全版；当前 Surge 包装以 iOS 6.x / WebView 为目标。** 保留 RT 开屏本地空响应，修复个人页 `nodefaasv3` 匹配，新增地点详情、搜索联想、打车子页等处理，没有第三方 JavaScript 或 JQ 运行依赖。

Surge 使用原地址的 [模块](<amap-adblock.sgmodule>) 与 [amap-cleaner.js](<amap-cleaner.js>)，已归并经过离线校正的二进制 UTF-8、完整响应头与错误放行包装；不新增第二份旧脚本。另提供独立的 [Egern 原生 YAML](<amap-adblock.egern.yaml>) 与 [ES module 脚本](<amap-cleaner.egern.js>)，本次未改变 Egern 资源或共用策略。两种客户端的配置与证书分别安装。

## 2.1.0 更新范围

- 页面从八类增至十五类；兼容旧入口，新增首页 assets/aiqs 和新附近接口。首页子接口只处理已知卡片结构，未知格式放行，不承诺所有变体都能清广告。
- 地点详情清已知推广模块，并同步清理区域、半隐藏、锚点与上滑提示引用；保留评价、资质、地图、预订、未知模块与尚未下发的业务目标。
- 搜索联想按明确广告标志过滤，快捷入口清角标文字；打车订单清皮肤、弹窗、营销工具，顺风车清 banner，工具箱清提示及已识别推广入口。
- `his_input_tip`、`engine_render`、`navi_cloud`、底图、打车和运动配置的内嵌 JSON 定点处理，解析失败或无变化时保留原字符串，不清空钱包、正常音乐和未知 AI 功能。
- `scene/recommend` 改为字段级净化，不再整包返回 `{}`；AI 本地规则收窄为 `ai.amap.com/v1/ai_rec/home_qs`。新增两个精确主机与路径的本地空响应：`rankingCard`、`marketingOperationStructured`。
- 未采用 Kelee 的个人页、地点详情和会话保留名单。会话 `raise_list` 缺少可靠的逐项广告判据，本版不处理。
- 两端策略源统一维护，构建后仍是各自独立脚本，不增加客户端导入或远程运行依赖。设计与取舍见[补全方案](方案.md)。

## 为什么旧版仍有开屏

2026-11-04 抓包里的实际接口为：

```text
https://amap-aos-info-nogw.amap.com/ws/aos/alimama/splash_screen_rt
```

旧正则漏掉了 `_rt`。该请求返回约 211 KB 的 multipart 响应，里面既有 `jsonData.data.custom_list` 广告配置，也直接夹带 PNG 和 JPEG。仅拦截图片 CDN，无法阻止这条接口把素材送到 App。

新版在请求发出前用 Map Local 返回同类 multipart：保留已观察到的成功状态、响应版本和唯一 `jsonData` 部分，将广告列表置空，不附带图片。不需要先把二进制广告下载下来再尝试 JSON 解析。详细证据和边界见[重写报告](REWRITE-REPORT.md)。

## 安装与更新

模块已迁移到新账号，安装或更新时使用以下地址：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.sgmodule
```

1. 将原高德模块的订阅地址换成上面的新链接，或重新安装该模块；模块描述应以 `2.1.0` 开头。
2. 刷新远程脚本缓存，确认获取了 [amap-cleaner.js](amap-cleaner.js)。停用重复处理高德接口的其他模块，不必删除 App。只有测试本地文件时，才需要修改两处 `script-path`。
3. 开启 Rewrite 与 MITM，安装、信任当前 Surge CA。配置里出现证书，不等于系统已信任。
4. 重新打开高德，按下面的请求记录验证。不要只看模块导入提示或页面脚本计数。

HTTPS 必须被解密，本模块追加 `*.amap.com`，不解密整个淘宝、阿里 CDN 或第三方统计服务。抓包时临时开启的全域解密，也不能代替平时的 MITM 配置。Egern 安装方法见下节，不将 Surge 模块导入成功当作跨客户端验证。

## Egern 原生版

使用独立模块地址：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.egern.yaml
```

- 八条 `map_locals` 的正文、状态与响应头与 Surge 2.1.0 逐项一致。RT 正文保留 2.0.0 的 CRLF、boundary 与成功契约，更新版本头；仅一个 `jsonData` 部分，字节与 Surge base64 解码结果相同。
- `rules` 只拒绝广告素材主机及已知归因路径。HTTP 响应脚本处理十五类页面，不加载 `amap-splash.js`，不改 HTTPDNS。
- 脚本使用 `export default async function(ctx)`、`ctx.response.arrayBuffer()` 和 `ctx.storage`，没有 Surge 全局适配层或远程公共运行时。正文只读一次；成功读出的原字节用于无变化、未知格式与后续异常的放行。
- 修改响应头直接使用原 `Headers.delete/set`，不枚举重建，不丢未触及的多值 Cookie 或未知业务头。方法异常时回传原正文，并尝试恢复触及的头；持续失效的 Headers API 无法保证恢复。
- 非 200、非 UTF-8、明确业务错误与未知结构不改写。流读取本身失败时没有完整原文可恢复；脚本不会二次读取或伪造空正文，实际客户端的流错误处理仍需运行验收。
- `高德净化诊断 · Egern` 返回合法 widget 并写本地日志，不发通知、不请求网络。计数键为 `egern_amap_cleaner_v2`，只存固定路由、枚举及封顶数字，不与 Surge 共享。
- Egern 仍需安装、信任它自己的 CA，并开启相应 HTTPS 解密。YAML 解析与模拟脚本通过，不等于手机已导入、CA 已信任或开屏缓存已消除。

原生版 34 项离线测试覆盖八条 Map Local 字节、严格匹配、十五个页面分支、版本别名、一次性流、多值响应头、异常放行及静默诊断；另有 24 项共用策略回归：

```sh
node --input-type=module --check < amap/amap-cleaner.egern.js
node --experimental-vm-modules --test amap/tests/egern.test.cjs
node --experimental-vm-modules --test amap/tests/policy.test.cjs
```

测试依赖 Node.js 20+、Python 3 与 PyYAML（只解析公开 YAML）。依据 [Egern 原生 API](https://egernapp.com/zh-CN/docs/javascript-api/)、[脚本配置](https://egernapp.com/docs/configuration/scriptings/)与[官方配置示例](https://egernapp.com/docs/configuration/example/)。

## 覆盖范围

| 位置 | 处理 |
| --- | --- |
| aos `splash_screen_rt` | 本地 multipart/jsonData 成功空广告响应，无内嵌图片 |
| 旧 aos / valueadded `splash_screen` | 本地 JSON 成功空广告响应 |
| `optimus-ads.amap.com` | 拒绝广告素材主机，不依赖用户另装广告规则集 |
| 首页 AI 推荐、路线规划推广、订单 Tip、推广天气、排行与结构化营销 | 已知专用路径返回空 JSON；AI 仅 `v1/ai_rec/home_qs` |
| 首页卡片与运营位置 | 删除明确广告卡，清理已知推广容器；保留未知业务卡 |
| 我的页面 | 兼容 nodefaas / nodefaasv3，清理 tipData 和明确广告卡，保留订单及未知卡片 |
| 搜索热词 | 仅清理 header_hotword，不删除真实搜索结果 |
| 附近页面 | 兼容旧接口与 smartui 新入口，清理已知优惠、活动与运营模块 |
| 打车页面 | 按原容器类型清理推广，含 alpha/bravo/charlie/push；补订单子页和顺风车 banner |
| 推广配置 | 精确处理已知键及内嵌 JSON，不按 ai_ 等宽泛子串清空导航或 AI 功能 |
| 地点详情 | 清推广模块与关联引用，保留真实地点业务及未知模块 |
| 搜索联想、快捷入口 | 过滤明确广告、清角标文字，不采用联想保留名单 |
| 工具箱与场景推荐 | 清已知提示、广告项和引用，保留历史、快捷入口及未知内容 |
| 消息推广与底栏角标 | 清理对应端点中的已知消息/角标容器 |
| 广告归因 | 拒绝已知归因路径 |

只有已确认的 aos RT 通道使用 multipart，未抓到的其他 RT 变体不套用这个格式。静态广告接口返回空响应可能影响相应推广或推荐入口；不承诺所有 App 版本与账号分组都有相同页面结构。

## 怎么确认开屏规则生效

在请求记录中查找 `/ws/aos/alimama/splash_screen_rt`：

- 应命中本模块的 Map Local，跳过上游请求。
- 响应头应有 `X-AMap-Cleaner-Version: 2.1.0`。
- multipart 应仅剩 `jsonData`，`custom_list` 为空，不再出现图片部分。
- 再检查开屏展示，同时验证地图、检索、路线、家庭组和打车等常用功能。

**开屏走 Map Local，不执行页面脚本。** 因此页面脚本命中次数为零，不能据此判断开屏拦截失败。

如果仍出现广告，先区分：旧缓存展示、RT 请求未命中、客户端没有解密、其他模块优先处理，还是出现了新接口。不要直接扩大到封锁整个地图域名或共用图片 CDN。模块不能直接删除 App 沙盒缓存；本地空列表是否足以让当前 App 停用已有缓存，需要真机验证。

## 本地诊断

模块附带 generic 脚本“高德净化诊断”，手动运行后在日志中查看：

- 实际脚本版本。
- 十五个页面分支的改写、无变化、格式不符和错误放行计数。旧版计数不会混入本版。
- 存储不可用或版本不符的明确说明。

自动处理与诊断都不发通知，也不保存 URL、请求头、响应内容、账号或定位。页面脚本只存固定路由名与有上限的计数。诊断不能证明 App 已经不展示广告。

## 响应保护与兼容边界

- 服务端明确失败、非 200、JSONP、非 UTF-8 声明、无效 UTF-8 字节或未知结构原样放行；有效 UTF-8 文本和二进制 JSON 都支持处理。
- 无变化时不重新序列化；改写时保留无关字段，移除过时的长度、编码、缓存与校验头。
- 不对未知卡片使用“只保留两种卡片”的删除策略，不把整个地图、导航或 AI 配置清空。
- 页面脚本最多处理 2 MiB 响应，超出限制可能由客户端跳过。
- 新模块不再改写阿里 HTTPDNS。现存 [amap-splash.js](amap-splash.js) 是旧模块使用的历史文件，2.1.0 不加载它。
- 接口、图片传输方式、证书策略或 App 缓存机制变化后，仍可能需要重新分析。

## 离线验证

```sh
node --check amap/amap-cleaner.js
node --test amap/tests/cleaner.test.cjs
python3 amap/tests/check_har.py /path/to/capture.har
```

原高德 87 项离线测试保持通过：Surge 29、Egern 34、共用策略 24；覆盖规则、multipart 契约、页面分支、错误保护、响应头、诊断、版本与构建一致性。2.0.0 时对用户 HAR 的离线对照为原响应一条广告、两张内嵌图片，替代响应零广告、零图片；本次保留该替代正文，没有重放请求或重新取得原始 HAR。不把离线通过等同于真机缓存已清除。

2026-11-14 原目录归并：原回归 **87/87 → 87/87**；迁回 [canonical 回归](<tests/canonical.test.cjs>) **17/17 → 17/17**，当前本目录 **104/104**。另有跨模块的 [静态与诊断检查](<../egern/tests/common-canonical.test.cjs>)；所有用例使用纯 mock。

维护时修改 [amap-policy.js](amap-policy.js) 与对应 runtime 模板，再生成独立客户端脚本：

```sh
python3 amap/build.py
python3 amap/build.py --check
node --experimental-vm-modules --test amap/tests/*.test.cjs
```

构建只需 Python 3 标准库。模板是构建输入，不能直接导入客户端；客户端只安装原模块地址。

## 实现与参考

- [完整模块](amap-adblock.sgmodule)
- [自托管页面脚本](amap-cleaner.js)
- [离线测试](tests/cleaner.test.cjs)
- [HAR 契约检查](tests/check_har.py)

实现重新编写；历史页面端点及部分字段名称参考 [ddgksf2013/Rewrite](https://github.com/ddgksf2013/Rewrite/blob/master/AdBlock/AmapAds.conf) 和 [ddgksf2013/Scripts](https://github.com/ddgksf2013/Scripts/blob/master/amap.js)，保留出处。Surge 的本地响应和脚本行为依据[官方 Map Local 文档](https://manual.nssurge.com/http/map-local.html)与[脚本接口文档](https://manual.nssurge.com/scripting/api.html)。

2.1.0 的新增端点与字段参考 [Kelee LPX 固定镜像](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/Amap_remove_ads.plugin)及其 [updatable.jq](https://github.com/fkingikelee/fkikelee/blob/d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0/Resource/kelee/JQLang/Amap/updatable.jq)、[地点详情 JQ](https://github.com/fkingikelee/fkikelee/blob/d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0/Resource/kelee/JQLang/Amap/search_poi_detail.jq)。原站本次返回 403，不能声称核实其当前版本。未复制整份外部实现，不运行远程 JQ；没有做手机真机验证。

[返回仓库首页](../README.md)
