# Surge iOS 离线回归测试

## 唯一完整入口

```sh
node surge-ios/tests/run.mjs
# 需要完整原始 TAP/YouTube 日志时：
node surge-ios/tests/run.mjs --verbose
```

需要 Node.js 24+，当前验证使用 Node.js 26.5.0。只用内置模块，没有安装步骤、网络下载或产品构建。所有生产 JS 和模块直接读取发布目录；不重新生成脚本，不修改有限 body caps，也不改发布 manifest。

## 原套件来源与保留数量

| 原套件 | 当前入口 | 预期原测试数 |
| --- | --- | ---: |
| Common（六类 JSON/SOAP 功能及七模块结构） | [common.test.cjs](<./common.test.cjs>) | 75 |
| Apple Weather（真实 FlatBuffers 与同版本 Egern parity） | [weather.test.cjs](<./weather.test.cjs>) | 48 |
| CamScanner | [camscanner.test.cjs](<./camscanner.test.cjs>) | 42 |
| NIO（原捕获/统计/并发/重试/诊断 mock） | [nio.test.cjs](<./nio.test.cjs>) | 71 |
| CamScanner/NIO 模块结构 | [module-structure.test.cjs](<./module-structure.test.cjs>) | 10 |
| YouTube（原 protobuf、加密 UMP/HMAC/gzip、字幕 mock） | [youtube.mock-tests.mjs](<./youtube.mock-tests.mjs>) | 28 |
| **原断言合计** | | **274** |

这些是原迁移工程的已有测试，不是重新实现的替代测试。功能断言、假身份、模拟响应和原 codec 都保留。改动仅涉及路径、远程引用结构断言、最小 fixture metadata 和测试报告输出。YouTube 第一项同时核对真实发布模块与原 matcher 快照，不只测试 fixture 自身。

另有 [publish-integrity.test.cjs](<./publish-integrity.test.cjs>) 的 12 项新增静态检查，单独统计，不冒充原 274 项。覆盖 14 个 JS、11 个模块、28 个 active entries、1 个 JD opt-in entry、13 个默认被引用脚本、GitHub raw URL、manifest 哈希、CA/个人路径/凭据特征，以及 active body caps。

## 严格结果语义

[run.mjs](<./run.mjs>) 分套件解析实际 TAP 或原 YouTube JSON summary；任意失败、缺失摘要、数量变化、取消、跳过、todo、超时、非零退出码或真实网络 API 尝试都会退出非零。结尾的 `SURGE_IOS_TEST_SUMMARY` JSON 是本次真实统计，而非复制的旧报告。

[offline-guard.cjs](<./offline-guard.cjs>) 在每个子进程阻断 Node HTTP/HTTPS/TCP/TLS/UDP/DNS、fetch 和 WebSocket。原 Surge/Egern `$httpClient` 与 NIO 通知/存储仍全部是 mock。入口比较执行前后的生产脚本、模块和发布 manifest 的 SHA-256；它们应完全不变。

Weather 原二进制 before/after 证据只写系统临时目录，套件结束后清理。YouTube 原来对旧 manifest 和报告的写入已移除，JSON summary 改为 stdout。重复运行默认不在 repo 留下报告或生成文件。

`node --test surge-ios/tests/*.test.cjs` **没有运行非 node:test 的 YouTube 28 项**；完整回归必须使用上面的统一入口。独立调试时也可用：

```sh
node --require ./surge-ios/tests/offline-guard.cjs --test surge-ios/tests/weather.test.cjs
node --require ./surge-ios/tests/offline-guard.cjs surge-ios/tests/youtube.mock-tests.mjs
```

## fixture 与检查边界

必要静态基线和最小 metadata 位于 [test-fixtures](<../test-fixtures/README.md>)，来源、哈希和原测试文件哈希见 [provenance.json](<../test-fixtures/provenance.json>)。不复制个人配置、证书、真实订阅 UUID、真实账户令牌或私有参数。

公开固定 WeatherKit 中的 ColorfulClouds fallback 已有来源证据，保留为公开上游常量；不会把这个常量或 `fixture-*` 假令牌报成个人凭据泄露。新增凭据扫描检查具体可识别特征和字面量，不宣称证明任意未知编码串都不是 secret，也不测试真实 API、登录、签到、播放或下载。

完整入口不执行 Surge CLI、现有 build、任何 HTTP probe、git commit 或 git push。
