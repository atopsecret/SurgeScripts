# 高德地图去广告

**2.0.0 完整重写版，适用于 Surge iOS 5.9.1+ / Mac 5.5.1+。** 核心开屏在联网前返回本地空广告响应；首页、个人页面、搜索、附近及打车推广使用本仓库可读脚本处理，没有第三方 JavaScript 运行依赖。

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

1. 将原高德模块的订阅地址换成上面的新链接，或重新安装该模块；模块描述应以 `2.0.0` 开头。
2. 刷新远程脚本缓存，确认获取了 [amap-cleaner.js](amap-cleaner.js)。停用重复处理高德接口的其他模块，不必删除 App。只有测试本地文件时，才需要修改两处 `script-path`。
3. 开启 Rewrite 与 MITM，安装、信任当前 Surge CA。配置里出现证书，不等于系统已信任。
4. 重新打开高德，按下面的请求记录验证。不要只看模块导入提示或页面脚本计数。

HTTPS 必须被解密，本模块追加 `*.amap.com`，不解密整个淘宝、阿里 CDN 或第三方统计服务。抓包时临时开启的全域解密，也不能代替平时的 MITM 配置。本目录未提供 Egern 原生版本，不将 Surge 模块导入成功当作跨客户端兼容验证。

## 覆盖范围

| 位置 | 处理 |
| --- | --- |
| aos `splash_screen_rt` | 本地 multipart/jsonData 成功空广告响应，无内嵌图片 |
| 旧 aos / valueadded `splash_screen` | 本地 JSON 成功空广告响应 |
| `optimus-ads.amap.com` | 拒绝广告素材主机，不依赖用户另装广告规则集 |
| 首页 AI 推荐、路线规划推广、订单 Tip、scene 推荐、推广天气 | 已知专用路径返回空 JSON |
| 首页卡片与运营位置 | 删除明确广告卡，清理已知推广容器；保留未知业务卡 |
| 我的页面 | 清理 tipData 和明确广告卡，保留订单及未知卡片 |
| 搜索热词 | 仅清理 header_hotword，不删除真实搜索结果 |
| 附近页面 | 清理已知优惠、活动与运营模块 |
| 打车页面 | 按原容器类型清理 icon/banner/tips/popup/bubble/other |
| 首页推广配置 | 精确处理已知键，不按 ai_ 等宽泛子串清空导航或 AI 功能 |
| 消息推广与底栏角标 | 清理对应端点中的已知消息/角标容器 |
| 广告归因 | 拒绝已知归因路径 |

只有已确认的 aos RT 通道使用 multipart，未抓到的其他 RT 变体不套用这个格式。静态广告接口返回空响应可能影响相应推广或推荐入口；不承诺所有 App 版本与账号分组都有相同页面结构。

## 怎么确认开屏规则生效

在请求记录中查找 `/ws/aos/alimama/splash_screen_rt`：

- 应命中本模块的 Map Local，跳过上游请求。
- 响应头应有 `X-AMap-Cleaner-Version: 2.0.0`。
- multipart 应仅剩 `jsonData`，`custom_list` 为空，不再出现图片部分。
- 再检查开屏展示，同时验证地图、检索、路线、家庭组和打车等常用功能。

**开屏走 Map Local，不执行页面脚本。** 因此页面脚本命中次数为零，不能据此判断开屏拦截失败。

如果仍出现广告，先区分：旧缓存展示、RT 请求未命中、客户端没有解密、其他模块优先处理，还是出现了新接口。不要直接扩大到封锁整个地图域名或共用图片 CDN。模块不能直接删除 App 沙盒缓存；本地空列表是否足以让当前 App 停用已有缓存，需要真机验证。

## 本地诊断

模块附带 generic 脚本“高德净化诊断”，手动运行后在日志中查看：

- 实际脚本版本。
- 八个页面分支的改写、无变化、格式不符和错误放行计数。
- 存储不可用或版本不符的明确说明。

自动处理与诊断都不发通知，也不保存 URL、请求头、响应内容、账号或定位。页面脚本只存固定路由名与有上限的计数。诊断不能证明 App 已经不展示广告。

## 响应保护与兼容边界

- 服务端明确失败、非 200、JSONP、二进制或未知结构原样放行。
- 无变化时不重新序列化；改写时保留无关字段，移除过时的长度、编码、缓存与校验头。
- 不对未知卡片使用“只保留两种卡片”的删除策略，不把整个地图、导航或 AI 配置清空。
- 页面脚本最多处理 2 MiB 响应，超出限制可能由客户端跳过。
- 新模块不再改写阿里 HTTPDNS。现存 [amap-splash.js](amap-splash.js) 是旧模块使用的历史文件，2.0.0 不加载它。
- 接口、图片传输方式、证书策略或 App 缓存机制变化后，仍可能需要重新分析。

## 离线验证

```sh
node --check amap/amap-cleaner.js
node --test amap/tests/cleaner.test.cjs
python3 amap/tests/check_har.py /path/to/capture.har
```

29 项测试覆盖规则、multipart 契约、页面分支、错误保护、响应头、诊断与版本一致性。对用户本次 HAR 的离线对照结果为：原响应一条广告、两张内嵌图片；本地替代响应零条广告、零张图片。未发真实请求，不把离线通过等同于真机缓存已清除。

## 实现与参考

- [完整模块](amap-adblock.sgmodule)
- [自托管页面脚本](amap-cleaner.js)
- [离线测试](tests/cleaner.test.cjs)
- [HAR 契约检查](tests/check_har.py)

实现重新编写；历史页面端点及部分字段名称参考 [ddgksf2013/Rewrite](https://github.com/ddgksf2013/Rewrite/blob/master/AdBlock/AmapAds.conf) 和 [ddgksf2013/Scripts](https://github.com/ddgksf2013/Scripts/blob/master/amap.js)，保留出处。Surge 的本地响应和脚本行为依据[官方 Map Local 文档](https://manual.nssurge.com/http/map-local.html)与[脚本接口文档](https://manual.nssurge.com/scripting/api.html)。

[返回仓库首页](../README.md)
