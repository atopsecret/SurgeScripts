# Apple 天气增强 · Surge / Egern

本目录按原功能维护两种客户端入口。**Egern 1.0.0** 原生实现保持不变；**Surge 1.0.0-surge.2** 将可用性、天气数据和手动诊断合并为一个自包含脚本。两者保留 WeatherKit **v3.1.0** 的完整天气、降水、空气质量算法与 **FlatBuffers 24.12.23** 编解码，不升级核心版本。

Egern 使用 `export default async function(ctx)`、`ctx.http`、`ctx.storage` 和 `ctx.env`，不依赖 Loon/Surge 全局变量。Surge 在同一核心外注入原生 `$httpClient`、`$persistentStore` 与二进制正文适配；运行时不加载外部 JS、不执行下载脚本的 `eval`。每个客户端都只引用一份自包含 JS。

## Surge 安装（canonical）

- [Surge 模块安装 URL](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.sgmodule)
- [统一自包含 Surge JS](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.surge.js)
- 本地文件：[模块](<apple-weather-enhancer.sgmodule>)、[统一入口](<apple-weather-enhancer.surge.js>)。

1. 在 Surge 模块管理中添加以上模块 URL，启用“Apple 天气增强”。模块为 Surge iOS 6.x 的 WebView 引擎格式；本轮只做离线运行验证。
2. 在自己的 Surge 配置中启用 MITM，安装并信任 **Surge 当前使用的 CA**。模块只追加 `weatherkit.apple.com`，不附带 CA、证书密码或用户 API 令牌。
3. 停用其它处理相同 WeatherKit 响应接口的模块，重新打开 Apple 天气。
4. 需要调整数据源或填入自己的 API 凭据时，保持三个 Script 入口的 `argument` 参数一致。字段与默认值见下文；支持 URL 查询参数格式，也支持含这些扁平键的 JSON 对象。不要添加 `MODE` 参数。
5. 在 Surge 脚本列表手动运行 `weather-diagnostic`。它只显示版本、命中计数与最近处理摘要，不访问天气服务，不输出 API 凭据或坐标。

三个 Script 条目均使用上面的同一 root URL：

| 条目 | 触发与正文 | 运行配置 |
| --- | --- | --- |
| `weather-availability` | `/api/v1/availability/` 的 JSON | `requires-body=true`、`binary-body-mode=false`、4 MiB、30 秒 |
| `weather-data` | `/api/v2/weather/` 的 FlatBuffers binary | `requires-body=true`、`binary-body-mode=true`、4 MiB、30 秒 |
| `weather-diagnostic` | `type=generic` 的手动诊断 | 10 秒，不读取响应正文 |

统一入口先按 `$script.type` 识别 generic 诊断，再按 `$request.url` 识别 JSON 或天气二进制；不依赖脚本名称。没有脚本类型但存在请求时仍按 URL 路由；完全没有请求与类型的手动运行显示诊断。其它类型、非目标 URL、错误状态与未知媒体类型保留原响应。

HTTP 适配将 Egern 的毫秒超时换算为 Surge 的秒：`7000 ms → 7 s`，保留单次最多 16 个不同请求、18 秒启动窗口、禁用 Cookie 与自动重定向的行为。失败或无需改写时向 Surge 返回 `{}`，沿用原响应的正文与头；二进制改写直接返回 `Uint8Array`，保留输入的 `byteOffset` / `byteLength`。

四条 Rule 原文保留，包括 Apple ASN **714 / 6185 + QUIC** 的第四条条件。该条件影响这些 ASN 的 QUIC，不仅限于天气；本轮没有将它扩大为全部 Apple 流量或全局 UDP/443。MITM 使用 `%APPEND%`。本模块不改 DNS、代理组、证书或其它全局设置。Surge 的缓存和诊断仍使用既有 `surge_ios_weather_` 存储前缀，与 Egern 存储分开。

## Egern 安装

[Egern 模块原始链接](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.egern.yaml)

1. 在 Egern 的模块管理中添加以上 URL，启用模块并检查脚本下载结果。
2. 使用支持原生 JavaScript API 与 `env_schema` 的当前 Egern 版本。模块按 2026-11-08 的官方文档编写；不为更旧版本推定兼容性。
3. 启用 MITM，安装并信任 **Egern 当前使用的 CA**。模块只加入 `weatherkit.apple.com`，不携带证书或口令。
4. 停用其它处理 WeatherKit 相同接口的模块，重新打开 Apple 天气。
5. 在模块设置中选择数据源、填写自己的 API 凭据。在脚本列表手动运行“Apple 天气增强诊断 · Egern”，检查是否命中与最近处理结果。

原插件标注 iOS 18 起；上游还面向 iPadOS 18、macOS 15、watchOS 11 的 WeatherKit 接口。此处没有做各平台真机验收，离线测试通过不代表证书、接口覆盖和页面效果均已验证。

## 功能与默认设置

- **可用数据集**：可用性响应改为上游的 11 个数据集，包括空气质量、当前天气、日/小时预报、下一小时降水、天气变化、预警等。这只是请求可用性的声明，不保证每个地点都有全部服务或内容。
- **天气数据源**：默认 `ColorfulClouds`，沿用上游的中国大陆替换范围；`WeatherKit` 表示不替换，另可选 `QWeather`。
- **下一小时降水**：默认彩云；原始数据存在时保留，缺失时按数据源覆盖范围补充。彩云路径沿用上游最多 85 分钟的输出。
- **AQI**：默认 `EU_EAQI`，提供 `None`、`UBA`、`WAQI_InstantCast_US`、`WAQI_InstantCast_CN`、`WAQI_InstantCast_CN_25_DRAFT`。最后一项是上游保留的草案算法，不代表当前生效标准。默认对原 `HJ6332012` 指数或缺失数据进行处理，不无条件覆盖所有国家的空气质量标准。

使用第三方天气数据源时，脚本会把当前查询坐标发送给相应服务，与原插件的数据请求方式一致。

### API 参数

- `API.ColorfulClouds.Token`：彩云 API 令牌。空值沿用 v3.1.0 的公开备用令牌；其额度、权限和持续可用性没有保证。
- `API.QWeather.Host`：和风天气实际分配的主机，只填域名。默认值沿用上游 `devapi.qweather.com`，不代表它现在仍适用于你的账号。
- `API.QWeather.Token`：本版本按上游使用 `X-QW-Api-Key`。不把 JWT 填入后假定成 Bearer 鉴权；所需接口套餐也由和风平台决定。
- `API.WAQI.Token`：保留原参数。v3.1.0 的默认 AQI 路径是本地计算，仅填写 WAQI 令牌不会自动把该路径切换到 WAQI。
- `LogLevel`：控制处理摘要。日志不包含定位、完整 URL、请求头或 API 令牌；两种客户端均不转发上游原始日志。

Surge 使用三个 Script 条目的 `argument`；Egern 在 UI 中填写即可，也可以在主配置的模块引用中传入 `env`：

```yaml
modules:
  - url: https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.egern.yaml
    enabled: true
    env:
      Weather.Provider: ColorfulClouds
      NextHour.Provider: ColorfulClouds
      AirQuality.Calculate.Algorithm: EU_EAQI
      API.ColorfulClouds.Token: TOKEN
      LogLevel: WARN
```

`TOKEN` 换成自己的令牌；不要公开包含真实凭据的主配置。`env_schema.default_value` 在 Egern 中只是界面提示，所以脚本内部也实现了同样的默认值。

## Egern 从 Loon 转换的差异

1. Loon `[Argument]` 改为 Egern `env_schema`；二进制天气响应设置 `binary_body: true` 和 `body_required: true`。
2. 设置只读取当前模块的 `ctx.env`。旧 `Storage`/BoxJs 配置不自动迁移，也不假装能读取另一个客户端的存储。和风公共城市网格缓存保存在独立 Egern 键中。
3. 保留 `weather-analytics-events.apple.com`、`tether.edge.apple`、`tthr.apple.com` 的拒绝规则，以及 ASN **714 / 6185** 的 QUIC 逻辑条件。后者作用于这些 Apple ASN 的 QUIC，不限于天气；没有扩大成全局 UDP/443 拒绝。
4. Egern 官方规则文档列出 `REJECT`，此处使用它，不宣称等同于 Loon `REJECT-DROP` 的静默丢包行为。`protocol` 使用文档化的 `quic`。
5. 新增手动诊断，不添加通知或定时任务。
6. 数据源或上游算法失败时，整份响应恢复为已保存的原始正文，不把部分失败结果当成功响应。HTTP 错误、非目标接口和未知媒体类型不消费正文；读取本身失败时无法承诺重建未读内容。
7. 响应上限 4 MiB，脚本超时 30 秒；单次调用最多 16 个不同的外部请求，单次 HTTP 超时不超过 7 秒，外部请求的启动窗口为 18 秒。相同调用内的重复外部请求合并。

FlatBuffers 模型沿用 v3.1.0。根表检查和异常回退不是完整协议验证器；Apple 今后新增、而该模型尚未认识的字段不能保证在重新编码后保留。出现异常时先停用本模块作对照。

## 来源与固定版本

用户指定：[Kelee Loon 插件](https://kelee.one/Tool/Loon/Lpx/AppleWeatherEnhancer.lpx)。现场直连为 Cloudflare HTTP 403，网页提取也未成功，**没有验证到该地址的当前内容**。

本转换使用：[Moli-X/Tool 固定镜像](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/AppleWeatherEnhancer.plugin)，文件日期 `2026-10-02 13:57:49`，引用 WeatherKit v3.1.0。没有静默升级到 v3.3.x。

- 算法：[NSRingo/WeatherKit v3.1.0](https://github.com/NSRingo/WeatherKit/tree/77d06d5525297ba5f85543934db505aab6ef7547)。
- 上游 `src/proto` 子模块无法公开读取；绑定取自[固定公开提交](https://github.com/wuchunkei/weather-kit/blob/d44877a505308bac9970366fd7c0305257598168/src/proto/apple/wk2.js)，该文件从同一 v3.1.0 原发布包恢复。
- 固定文件与 SHA-256 见 [`vendor/manifest.json`](vendor/manifest.json)。构建前逐一核对；原发布包保存在测试夹具中，用于独立输出对照。
- 原作者：VirgilClyne、WordlessEcho、001。许可和适配修改见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。

## 构建与离线验证

已提交的两个自包含 JS 可以直接运行。所有测试仅需 Node.js 内置模块，不安装 npm 依赖。Egern 的原 [源码](<src/main.mjs>)、[运行时](<src/runtime.mjs>)、[bundle](<apple-weather-enhancer.egern.js>)与 [build.mjs](<build.mjs>) 保持不变。

### Surge：独立最小构建，不重建 Egern

[build-surge.mjs](<build-surge.mjs>) 复用现有完整 Egern bundle，先核对固定来源哈希，仅去掉末尾 ES export 指令，再拼入 [src/surge-adapter.js](<src/surge-adapter.js>)。只写 [Surge JS](<apple-weather-enhancer.surge.js>)，不运行原 build、不安装依赖、不访问网络；`--check` 只做逐字节校验。

```sh
# 仓库根目录，Node.js 20+
node --require ./apple-weather/tests/offline-guard.cjs apple-weather/build-surge.mjs
node --require ./apple-weather/tests/offline-guard.cjs apple-weather/build-surge.mjs --check

# 对应 npm alias；这些命令也无需 npm install
npm --prefix apple-weather run build:surge
npm --prefix apple-weather run check:surge
npm --prefix apple-weather run test:surge
npm --prefix apple-weather run test:egern
npm --prefix apple-weather test
```

### Egern：原源码构建

只有明确要重建 Egern 时才用下面的原构建，它需要固定 esbuild / FlatBuffers npm 依赖，与 Surge 最小构建相互独立。

```sh
cd apple-weather
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run test:egern

# 返回仓库根目录后做 Egern 模块字段检查
cd ..
python3 egern/validate.py
python3 -m unittest discover -s egern -p test_validate.py -v
```

测试使用虚构凭据、合成 FlatBuffers 和模拟 HTTP，不请求真实天气服务。[offline-guard.cjs](<tests/offline-guard.cjs>) 同时拦截真实网络 API。覆盖可用性、已知字段保留、天气替换、降水补充、六种 AQI 算法、原始字节回退、一次性正文读取、跨调用隔离、参数与诊断边界。可用性及九组二进制用例与原 v3.1.0 发布脚本对照，二进制用例逐字节比较。

Surge 迁移前 **48/48**，统一入口保留全部原回归并增加 20 项，迁移后 **68/68**；Egern 原测试文件未改，前后 **52/52**；合跑 **120/120**，失败与跳过均为 0。[本轮离线证据](<tests/README.md>) 记录命令、来源、字节和原范围 Rule；[原 Egern 验证报告](<验证报告.md>) 保留历史结果。GitHub 发布是独立步骤，不由构建脚本或 GitHub Actions 自动执行。

## 官方格式参考

- [Egern JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [模块与 env_schema](https://egernapp.com/docs/configuration/modules/)
- [脚本与二进制正文](https://egernapp.com/docs/configuration/scriptings/)
- [环境变量](https://egernapp.com/docs/configuration/env/)
- [规则、ASN 和逻辑条件](https://egernapp.com/docs/configuration/rules/)
