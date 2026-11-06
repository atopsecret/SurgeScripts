# Egern 原生模块

七个独立原生模块。响应脚本用 `export default async function(ctx)`，逻辑规则和本地响应采用原生 YAML，不把 Surge 脚本包进兼容壳。

## 安装链接

- [高德地图](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.egern.yaml)：RT 开屏 multipart、旧开屏与八类页面净化。
- [京东](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml)：八类接口、已知导航、精准开屏素材尺寸。
- [闲鱼](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml)：六个网关、新旧开屏和缓存广告引用。
- [拼多多](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.egern.yaml)：双条件素材规则、单域 QUIC 与已知页面净化。
- [红果](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.egern.yaml)：78 条广告/上报条件，不拒绝主配置公共 DNS。
- [戒烟军团](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.egern.yaml)：已知明文 SOAP 响应的客户端标志位。
- [蔚来](https://raw.githubusercontent.com/atopsecret/SurgeScripts/refs/heads/main/weilai/weilai-auto-checkin.egern.yaml?v=3.1.2)：原生凭据捕获、09:00 定时签到、现有响应的当日统计观察和本地诊断；成功通知带表情，凭据提醒精简并按 30 秒合并。

本次按 Egern 2.21 的当前文档检查。先停用同一 App 的旧兼容模块，再添加原生链接，检查资源下载与脚本版本。HTTPS 改写需要启用 MITM、安装并信任 Egern 当前 CA。红果的域名规则、戒烟军团的已知明文接口不依赖证书。

## 原生实现差异

- HTTP 错误、服务端错误和未知正文保守放行。已读出的正文在解析或处理失败时显式返回，不能把被消费的流当成仍可透传。流读取本身失败时，不能承诺重构没有读完的内容。
- 高德 RT 的 multipart 字节、CRLF、边界和响应头与现有版本对应；Map Local 不依赖脚本下载。
- 京东不清空整个 `start`；陌生导航结构保留，普通商品图片不匹配开屏专用尺寸。
- 闲鱼默认静默，不把服务端登录错误或错误 `ret` 伪造成成功。
- 拼多多保留 UA 双条件和单域 QUIC；裸 IP 页面响应必须有精确 API Host，不凭域名子串或 UA 直接认领。保留商品评价图片。已识别的三核心导航仍沿用原来源白名单，可能同时精简其它入口。
- 红果不复制 `dns.alidns.com`、`doh.pub` 拒绝，不解密整个 `snssdk.com`；金币或看广告解锁入口仍可能受阻。
- 戒烟军团只改原有客户端标志，不改变服务端资格，SOAP Fault 不改写。
- 蔚来存储与 Surge 不共享，先重新捕获，再手动运行定时任务验证。Generic 只诊断，不签到。已确认成功的每日记录和短租约减少重复提交，但存储 API 没有 CAS/事务，也不能取消已发送请求，不承诺绝对跨进程互斥。

Egern 签到启用前须停止 Surge 同任务，两个客户端各自的本地去重不能互相协调。模块不带用户 Token、CA、节点或整份私人配置。

## 配置与 Tailscale

普通分流使用独立 [Rules 原生集合](https://github.com/atopsecret/Rules/tree/main/egern)，六份大列表不用内联。私人配置在本地另建，不发布到本仓库。

Egern **2.21.0** 的官方版本说明确认新增 Tailscale/Headscale、出口节点、子网路由和 MagicDNS。然而官网尚未公布新节点的 YAML 字段；此处不放推测字段，也不提供假节点示例。迁移以 Egern 实际导出的原生节点为准，登录状态不从 Surge 复制。使用自建 Headscale 时，还须通过原生设置与导出差异确认控制字段及原控制地址；节点存在、认证密钥有值或任意字段出现相同 URL 都不能单独证明迁移完成。

NAS 原 Surge 网关条件不能从当前公开 Egern 条件策略字段直接复刻；私人配置暂保留手动 `NAS-Relay` / `DIRECT` 选择，不宣称自动切换已经实现。

## 离线检查

需要 Node.js 20+、Python 3.11+ 和 PyYAML 6。命令见[仓库说明](../README.md#离线校验)。`validate.py` 只检查本项目所用官方字段，不是 Egern 官方配置解析器。可用 `--rules-dir` 同时验证本地 Rules 仓库原生集合与原列表的逐条等价性。

2026-11-06 脚本回归 **340/340**，其中 Surge 77 项、原生 263 项；公共静态测试 **17/17**。七个 YAML、六个原生 JS 和 9,980 条公共规则条件检查通过。红果不需要响应脚本，其 78 条条件及 Map Local 边界由静态测试覆盖。

脚本与静态验证均不发送真实业务请求、不启用搜索程序或 GitHub Actions。静态与模拟通过不等于 Egern 真机导入、证书信任、Tailscale 登录或 App 页面验收。

## 参考

- [Egern 原生 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [脚本配置](https://egernapp.com/docs/configuration/scriptings/)
- [模块配置](https://egernapp.com/docs/configuration/modules/)
- [规则与原生集合](https://egernapp.com/docs/configuration/rules/)
- [主配置示例](https://egernapp.com/docs/configuration/example/)
- [Egern 官方版本信息](https://itunes.apple.com/lookup?id=1616105820&country=us)
- [Tailscale 节点认证](https://tailscale.com/kb/1085/auth-keys)

原作者署名、社区来源与各自许可说明保留在各目录；不为整个仓库另行推定统一 MIT 授权。
