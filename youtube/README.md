# YouTube 增强

Surge iOS 使用本目录两个自包含脚本，覆盖9个请求/响应入口。沿用当前去广告、后台/PiP、画质、Shorts/上传入口、小游戏/竖屏直播、Jump Ahead、原生下载和双语字幕设置。

- [Surge 模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/youtube/youtube-enhancer.sgmodule)
- [请求处理](youtube-request.js)
- [响应处理](youtube-response.js)

模块参数以当前默认值展开，适合直接安装或分段引用；避免与其它同 URL 的旧模块重复加载。两条 QUIC/UDP 限制仅用于 YouTube相关域名，不全局关闭QUIC。

## 验证

```sh
node --check youtube/youtube-request.js
node --check youtube/youtube-response.js
node --require ./youtube/tests/offline-guard.cjs youtube/tests/youtube.test.mjs
```

原28项 protobuf、UMP/AES/HMAC/gzip、下载开关、JSON3/VTT/XML字幕、缓存和回退断言保持；所有网络为合成替身，真实网络尝试为0。

较大响应使用WebView；主API响应上限8MiB，UMP保持4MiB，请求正文/下载动作保持1MiB，字幕保持2MiB。2026-11-14手机出现4,201,460字节的主API响应，超过旧4MiB上限；本次只提高这个响应入口，仍保持有限缓冲，未改变请求或其他入口。超限响应保留原文，超限请求由宿主终止。原生下载是客户端实验功能，不生成服务端没有提供的媒体资源。

双语字幕把当前字幕文本发送到翻译服务；失败时保留原字幕。原“屏蔽选段按钮”只有源参数声明、没有对应源码实现，本模块未虚构该功能。

## 来源

保留 gholts/Maasea 与 IBL3ND 的对应来源实现；固定来源分别为 `8ac5bd1ad8f10ed7230cc86f7b8f4051a3a150b1`、`4b734bd695edc0200d25110b20cfa2d67ba4b676`。Noble内联依赖的MIT版权与许可全文保留在响应脚本。测试中原始基线只是协议编码对照，不作为另一个运行版本；不为所有上游代码笼统指定统一许可证。
