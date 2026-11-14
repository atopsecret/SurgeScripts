# 来源、许可与修改记录

## WeatherKit

- 项目：NSRingo/WeatherKit。
- 原作者：VirgilClyne、WordlessEcho、001。
- 版本：v3.1.0；源码提交 `77d06d5525297ba5f85543934db505aab6ef7547`。
- 许可：Apache License 2.0，全文见 `vendor/weatherkit/LICENSE`。
- 原始算法文件保存在 `vendor/weatherkit/src/`，保留注释，不在这些文件中手工重写天气或 AQI 算法。
- `wk2.js` 来自 `wuchunkei/weather-kit` 的 `d44877a505308bac9970366fd7c0305257598168`，该 Apache-2.0 项目从同版本公开发布包还原了缺失的绑定。它不是成功下载的上游私有子模块。
- 该绑定的行尾空白原样保留以维持来源 SHA-256；本目录 `.gitattributes` 仅对这个固定文件关闭空白样式告警，不修改它的内容。

## FlatBuffers

- 项目：Google FlatBuffers JavaScript runtime。
- 版本：24.12.23。
- 许可：Apache License 2.0，全文见 `vendor/FLATBUFFERS-LICENSE`。
- 运行时代码随本模块打包；构建依赖通过 `package-lock.json` 固定。

## 原发布包测试夹具

- `tests/fixtures/upstream-v3.1.0.bundle.js` 来自 NSRingo/WeatherKit v3.1.0 的原发布资产，未经修改。
- 夹具含上游 `@nsnanocat/util` 2.2.3 运行时，许可为 Apache-2.0，全文见 `vendor/NSNANOCAT-UTIL-LICENSE`。该工具库没有进入 Egern 原生产物；它只在离线测试中模拟旧环境。
- Egern 原生产物不依赖旧客户端全局 API。Surge 入口使用其客户端原生全局 API 完成 HTTP、存储和响应适配；上游工具库仍仅用于既有离线夹具，不进入这两个客户端的生产核心。

## 配置参考

- 用户给定的 Kelee URL 当前抓取为 HTTP 403。
- 镜像配置保存于 `vendor/AppleWeatherEnhancer.lpx`，固定来源和 SHA-256 见 `vendor/manifest.json`。
- 原镜像作者署名保留；本模块没有声称由 Kelee 或 iRingo 官方维护。

## atopsecret 的 Egern 适配，2026-11-08

- 新增原生入口、HTTP 与存储注入、独立核心闭包、参数校验、诊断、故障回退、YAML、构建和测试。
- 构建时只移除 URL 解析函数对旧 `$request` 的默认参数依赖；调用者始终显式传入 URL。其余源文件不修改。
- 核心工具库引用替换为本模块的原生依赖注入，不携带 `$done`/`$httpClient` 等旧运行时。
- 将 Loon 参数界面转换为 `env_schema`，不迁移 BoxJs 存储；将拒绝动作改为官方文档列出的 `REJECT`。
- 本目录的适配源码按 Apache License 2.0 提供。仓库其它目录的许可不受此说明改变。

## atopsecret 的 Surge 统一入口与目录归并，2026-11-14

- 产物：[apple-weather-enhancer.surge.js](<apple-weather-enhancer.surge.js>)；canonical 模块：[apple-weather-enhancer.sgmodule](<apple-weather-enhancer.sgmodule>)。原可用性、天气二进制和 generic 诊断三个条目都引用同一个自包含 JS，不加载远程代码。
- 直接复用固定提交 `5015215c1d0627ac019bd3c657842a83077daffc` 的 [Egern 1.0.0 bundle](<apple-weather-enhancer.egern.js>)。完整 bundle SHA-256 是 `d37a5d41045bfc58449a1028c86388aa06771a8ec3cd6b8bb32df3a013e54e1e`。包装时仅省略末尾 ES module export 指令；WeatherKit v3.1.0、FlatBuffers 24.12.23、Egern 处理实现及其正文回退的其余字节原样嵌入一次。
- 未更改 Egern 生产 JS、YAML、[原入口](<src/main.mjs>)、[原运行时](<src/runtime.mjs>)、[原构建](<build.mjs>)、[原 Egern 测试](<tests/egern.test.cjs>)或既有 vendor 来源文件。
- 新增 [Surge adapter 源](<src/surge-adapter.js>) 与 [最小构建](<build-surge.mjs>)：按 `$script.type` / `$request.url` 分配 generic、可用性 JSON、天气 binary 三种运行入口；保留参数解析、HTTP 毫秒到秒转换、原始字节范围、重复响应头与 `{}` 原响应回退。构建只写 Surge JS，不调用原 Egern build，也不安装依赖。
- 原 48 项 Surge Weather 测试迁到 [weather.test.cjs](<tests/weather.test.cjs>)，增加 20 项路由、参数、正文与非破坏构建验证。测试直接使用现有 Egern bundle 和 vendor；没有再复制一份 Egern bundle、WeatherKit 源码或许可证。来源、三份旧文件哈希与基准计数保存在 [surge-source.json](<tests/fixtures/surge-source.json>)，执行结果见 [离线回归记录](<tests/README.md>)。
- 四条 Rule 和 `%APPEND% weatherkit.apple.com` 保持原匹配范围；Apple ASN 714 / 6185 的 QUIC 条件仍影响天气以外的 Apple QUIC，本次未扩大。模块的 API 令牌字段全部为空，没有附带 CA 或证书口令；上游核心原有的公开彩云备用令牌未作字节修改。
- 适配与构建的许可仍为 [Apache License 2.0](<LICENSE>)。其许可授予复制、修改及分发权限，分发时须随附许可、保留适用署名/NOTICE，并标明修改；本次标记不改变 WeatherKit、FlatBuffers 或仓库其它文件的许可范围。
- 已保留的第三方许可统一引用：[WeatherKit](<vendor/weatherkit/LICENSE>)、[FlatBuffers](<vendor/FLATBUFFERS-LICENSE>)、[原发布夹具工具库](<vendor/NSNANOCAT-UTIL-LICENSE>)。不新增重复许可副本，也不代表 Apple、Kelee 或 iRingo 官方发行。
