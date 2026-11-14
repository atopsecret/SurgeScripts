# Apple 天气增强 · 离线回归

日期：2026-11-14（Asia/Shanghai）。Node.js **26.5.0**；纯 Node 内置模块、VM、合成 FlatBuffers 和虚构 API 响应。没有天气实网、真实账号、设备修改或 private 资料访问。

## 本轮前后计数

| 测试组 | 迁移前 | 迁移后 | 失败 / 跳过 |
| --- | ---: | ---: | ---: |
| Surge Weather 原有回归 | 48 / 48 | 48 / 48，全部执行统一入口 | 0 / 0 |
| Surge 新增路由与构建回归 | — | 20 / 20 | 0 / 0 |
| Egern 原有回归 | 52 / 52 | 52 / 52，文件未改 | 0 / 0 |
| 合计 | 100 / 100 | **120 / 120** | **0 / 0** |

[Egern 测试](<egern.test.cjs>) 保留原文；当前文件实际产生 52 项 Node 测试，与 [既有 Egern 验证报告](<../验证报告.md>) 一致。[Surge 测试](<weather.test.cjs>) 的原 48 项没有删除或缩减，来源检查强化为完整 Egern / WeatherKit / FlatBuffers 字节仅嵌入一次。

新增 20 项证明：同一文件按 URL 处理可用性 JSON / 天气 binary；generic 类型优先于已有请求；不依赖脚本名；缺少 `$script` 元数据时仍按 URL 处理；无请求的 generic/手动运行显示诊断；非响应类型与错误 URL 原样放行；参数两种格式、媒体类型不猜测、ArrayBuffer / DataView 精确字节范围、原响应回退及非破坏构建均保持行为。

全部命令都加载 [offline-guard.cjs](<offline-guard.cjs>)，测试 HTTP 也全部为 mock；各测试进程、构建子进程及父进程均输出 `OFFLINE_GUARD {"networkAttempts":0}`。

## 可重现命令

```sh
# 仓库根目录；无需 npm install，也不运行原 Egern build
node --require ./apple-weather/tests/offline-guard.cjs apple-weather/build-surge.mjs
node --require ./apple-weather/tests/offline-guard.cjs apple-weather/build-surge.mjs --check
npm --prefix apple-weather run test:surge
npm --prefix apple-weather run test:egern
npm --prefix apple-weather test
```

[build-surge.mjs](<../build-surge.mjs>) 仅使用 Node 内置模块，先核对 [vendor manifest](<../vendor/manifest.json>) 与 [固定 Egern 来源](<fixtures/surge-source.json>)，再把 [Surge adapter](<../src/surge-adapter.js>) 拼入新的 IIFE。`--check` 逐字节检查现有产物，不写任何文件；普通 build 只写 [Surge JS](<../apple-weather-enhancer.surge.js>)。

## 3 → 1 JS 去重证据

| 文件组合 | 字节 |
| --- | ---: |
| 原可用性 JS | 247,216 |
| 原天气数据 JS | 247,203 |
| 原诊断 JS | 247,212 |
| 原三份合计 | **741,631** |
| [canonical Surge JS](<../apple-weather-enhancer.surge.js>) | **248,424** |
| 节省 | **493,207（66.50%）** |

原三份全文仅第 8 行 Run 注释与第 235 行固定 MODE 调用不同。新的 adapter 显式进行 generic / JSON / binary 路由，而非仅将原天气文件改名。原 Egern 大夹具与现有生产文件完全相同，迁移直接复用生产文件，不保留重复副本；原上游发布包夹具、WeatherKit vendor 与许可均保持原样。

SHA-256：

```text
Surge JS: 451db5fa7807bc94b5db7c7592487d7b622016453a60841766f62cb47cbc7f9c
Egern JS: d37a5d41045bfc58449a1028c86388aa06771a8ec3cd6b8bb32df3a013e54e1e
嵌入完整 Core（仅移除 ES export，237,954 B）:
81f4702aee700cb374b7669f1c0d321ba5fe81d655772e894ca6b49161116eb0
```

## canonical URI 与配置保持

- [Surge sgmodule](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.sgmodule)
- [同一自包含 JS root URL](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.surge.js)

[模块](<../apple-weather-enhancer.sgmodule>) 仅包含四条原 Rule、三个 Script 条目和 MITM hostname append；默认参数不变，无 CA、证书口令或用户令牌。第四条 Apple ASN 714 / 6185 + QUIC 规则的范围不限天气，本次按原文保留并记录待总集成审核，未扩大范围。

本记录只报告本地构建与模拟测试。本轮没有 commit、push 或远程 URI 探测；canonical 链接是否已经同步到远程由发布步骤决定。旧 [Egern 验证报告](<../验证报告.md>) 的 2026-11-08 发布证据保留，不把它当作本轮 Surge 的发布证明。
