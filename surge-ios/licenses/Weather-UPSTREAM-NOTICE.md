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
- 所有旧客户端全局 API 仅存在于这个测试夹具和未修改的原始源码参数中，不是产物的运行依赖。

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
