# Egern 原生模块

十个独立原生模块。响应脚本用 `export default` 异步函数，逻辑规则、本地响应和小组件采用原生 YAML，不把 Surge 脚本包进兼容壳。

## 安装链接

- [Apple 天气增强](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.egern.yaml)：WeatherKit v3.1.0 天气、降水、AQI 和 FlatBuffers；参数使用原生 `env_schema`。
- [高德地图](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.egern.yaml)：2.1.0，RT 开屏 multipart、个人页 v3、十五类页面与内嵌配置净化。
- [京东 2.0.0](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml)：十二类接口、已知导航、精准开屏素材尺寸与原字节回退。
- [菜鸟 1.2.1](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.egern.yaml?v=1.2.1)：九个精确主机改为 UDP/QUIC `443` 条件，保留原有页面和素材规则；最新抓包确认仍在展示本地缓存视频，最终开屏效果未真机确认。
- [菜鸟取件小组件 1.2.4 · 已发布](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao-widget/cainiao-widget.egern.yaml?v=1.2.4)：修复公共时间请求覆盖候选与账号隔离、首次未接通误报失效；沿用原模块，不要求本地文件；[手机更新步骤](../cainiao-widget/开始使用-1.2.4.md)。独立接入仍未完成。
- [闲鱼](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml)：六个网关、新旧开屏和缓存广告引用。
- [拼多多](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.egern.yaml)：双条件素材规则、单域 QUIC 与已知页面净化。
- [红果](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.egern.yaml)：78 条广告/上报条件，不拒绝主配置公共 DNS。
- [戒烟军团](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.egern.yaml)：已知明文 SOAP 响应的客户端标志位。
- [蔚来](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.egern.yaml?v=3.2.0)：原生凭据捕获、09:00 定时签到和本地诊断；累计缺失时先做一次有上限的同接口 POST 统计复查，完成后只通知一次，并保留当日响应观察。

本次按 Egern 2.21 的当前文档检查。先停用同一 App 的旧兼容模块，再添加原生链接，检查资源下载与脚本版本。HTTPS 改写需要启用 MITM、安装并信任 Egern 当前 CA。红果的域名规则、戒烟军团的已知明文接口不依赖证书。

## 原生实现差异

- Apple 天气保留固定镜像引用的 v3.1.0 算法，原插件 URL 本次为 403；原生 HTTP、存储和设置按调用隔离。保留 Apple ASN 的 QUIC 条件，动作使用文档化 `REJECT`；不迁移 BoxJs。API 或编码失败回传保存的原文，模型未知的新字段不保证重编码保留。详情见[独立说明](../apple-weather/README.md)。
- HTTP 错误、服务端错误和未知正文保守放行。已读出的正文在解析或处理失败时显式返回，不能把被消费的流当成仍可透传。流读取本身失败时，不能承诺重构没有读完的内容。
- 高德 RT 的 multipart 字节、CRLF、边界和响应头与现有版本对应；Map Local 不依赖脚本下载。
- 京东不清空整个 `start`；陌生导航结构保留，普通商品图片不匹配开屏专用尺寸。
- 菜鸟包含五类广告空体 404、三组页面清理及 20 条拒绝条件；1.2.1 将九个精确解密主机的协议条件扩展至 UDP/QUIC `443`。提供 [Surge 模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.sgmodule?v=1.2.1)，Surge 为目标域名另启 `extended-matching`；两端页面脚本由共用纯策略构建。未识别域名的 IP 直连仍可能绕过，模块也不能删除 App 缓存。省去 netflow 整包清空规则，保留未知业务结构。
- 菜鸟取件是独立模块，可和菜鸟去广告一起使用，不依赖去广告或另装诊断。1.2.4 将公共时间设为仅观察，仍保留明确身份冲突隔离及正常非公共新账号采集；首次未确认的失败只改显示，原终止和诊断保留。四个精确 H5／GW 主机、有限登录结构、原字节透传及两个互斥响应匹配不扩。同次响应 Cookie＋有效 UID 仍须身份、COUNT 和完整 PDS。旧发送对照不重发、不续窗；凭据只留手机，失败保留旧快照。已有本人 Egern CA 不用重装；本版没有实现 App 原生会话兑换。
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

2026-11-08 加入 Apple 天气后：脚本 **423/423**，其中新模块 **52/52**；静态 **22/22**。八个 YAML、七个原生 JS 通过检查。Apple 天气源码构建需要其目录内固定的 esbuild/FlatBuffers；已构建产物的离线测试不需要 npm 安装。

同日高德更新到 2.1.0 后：全仓脚本 **456/456**，高德 **87/87**，静态仍为 **22/22**。包含个人页 v3、十五类页面、内嵌配置、业务保留和双端一致性检查；没有完成手机真机验收。见[高德验证报告](../amap/验证报告-2.1.0.md)。

2026-11-08 京东 2.0.0 与菜鸟 1.0.0：京东 **44/44 → 82/82**、菜鸟 **17/17**；全仓 **511/511**、静态 **27/27**。九个 YAML、八个原生脚本和京东构建一致性检查通过；细节见[验证记录](验证记录-京东菜鸟-20261108.md)。本轮未做手机导入、CA 信任或页面验收。

2026-11-08 新增菜鸟取件原生小组件 1.0.0：小组件 **44/44**、全仓脚本 **555/555**、公共静态 **35/35**，十个模块与九个自包含脚本通过。扫码助手离线 **32/32**，同源布局预览 **45 个**通过。未执行真实登录或手机验收，见[小组件验证记录](../cainiao-widget/验证记录-1.0.0.md)。

2026-11-08 菜鸟取件小组件 1.1.0：手机登录态捕获、账号隔离屏障与并发归属已实现；小组件 **83/83**、全仓 **594/594**、静态 **38/38**，49 个同源布局检查通过。未执行真机登录，见[1.1.0 验证记录](../cainiao-widget/验证记录-1.1.0.md)。

2026-11-08 菜鸟去广告 1.1.0：授权 HAR 的规则匹配 **0/169 → 123/169**，补上 43 条此前返回 HTTP 200 的广告相关请求；菜鸟 **17/17 → 24/24**、全仓 **594/594 → 601/601**、静态 **38/38 → 39/39**。原始抓包未上传，详见[去广告验证记录](../cainiao/验证记录-1.1.0.md)。真机效果待模块更新后验收。

2026-11-08 菜鸟去广告 1.1.1：修复开屏图片目录与 ID 轮换漏拦，两份 HAR 双端判断一致；第二份规则匹配 **98/156 → 102/156**，第一份保持 **123/169**。菜鸟 **43/43**、全仓 **620/620**、静态 **39/39**。旧模块已有命中日志，更新后的手机效果待验收，见[开屏补漏验证记录](../cainiao/验证记录-1.1.1.md)。

2026-11-08 菜鸟去广告 1.2.0：根据第三份 HAR、PCAP 和解压应用日志补 HTTP/3、广告 `.cn` 变体及自营开屏素材；菜鸟 **47/47**、全仓 **624/624**、静态 **40/40**。规则覆盖三份 HAR 无回退，客户端协议识别、TCP 回退和缓存仍待验收，见[验证记录](../cainiao/验证记录-1.2.0.md)。

2026-11-08 菜鸟取件小组件 1.2.0 已发布：新增 App 回归 **57/57**、主组件 **83/83 → 144/144**、全仓 **624/624 → 685/685**、静态 **40/40**、旧登录助手 **32/32**，58 个同源布局零问题；十三个公开资源的原地址回读、版本和哈希均通过。原生候选兼容和关闭 App 后的新查询尚未手机验收，见[小组件 1.2.0 记录](../cainiao-widget/验证记录-1.2.0.md)。

2026-11-08 菜鸟去广告 1.2.1：第四份抓包确认缓存视频继续展示、原生 HTTP/3 仍有双向传输；修正九个精确主机的 UDP/QUIC `443` 条件，Surge 另补 SNI 扩展匹配。菜鸟 **47/47 → 50/50**、全仓 **685/685 → 688/688**、静态 **40/40**。没有真机验证最终开屏效果，见[1.2.1 验证记录](../cainiao/验证记录-1.2.1.md)。

2026-11-08 菜鸟取件小组件 1.2.1 已发布：保留同次实际 Cookie，首次验证失败不误报 App 登录过期，旧终止态不被 SID-only 流量复活；新回归 **49/49**、主组件 **193/193**、全仓 **737/737**、静态 **40/40**、58 个布局零问题。十三个公开原地址的版本及哈希一致，手机接入未验收，见[小组件 1.2.1 记录](../cainiao-widget/验证记录-1.2.1.md)。

2026-11-09 菜鸟取件小组件 1.2.3 已发布：同模块发送对照、响应候选和有限登录结构已集成；主组件 **232/232 → 384/384**、全仓 **776/776 → 928/928**、静态 **40/40 → 41/41**、旧助手 **32/32**。独立接入复核 **203/203**，58 个同源布局零问题；十四个公开原地址同字节，上线不等于手机登录已接通，见[1.2.3 记录](../cainiao-widget/验证记录-1.2.3.md)。

2026-11-09 菜鸟取件小组件 1.2.4 已发布：新增来源／隔离回归旧版 **7/12**、本版 **12/12**，工作区及实际树主组件 **396/396**、全仓 **940/940**、静态 **41/41**、旧助手 **32/32**；独立源码复核 **76/76**、实际范围 **58/58**，58 个同源布局零问题。实现提交 `2a80663` 普通推送，十四个公开原地址同字节；独立个人查询仍未接通，见[1.2.4 记录](../cainiao-widget/验证记录-1.2.4.md)。

## 参考

- [Egern 原生 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)
- [原生小组件与 DSL](https://egernapp.com/zh-CN/docs/configuration/widgets/)
- [脚本配置](https://egernapp.com/docs/configuration/scriptings/)
- [模块配置](https://egernapp.com/docs/configuration/modules/)
- [规则与原生集合](https://egernapp.com/docs/configuration/rules/)
- [主配置示例](https://egernapp.com/docs/configuration/example/)
- [Egern 官方版本信息](https://itunes.apple.com/lookup?id=1616105820&country=us)
- [Tailscale 节点认证](https://tailscale.com/kb/1085/auth-keys)

原作者署名、社区来源与各自许可说明保留在各目录；不为整个仓库另行推定统一 MIT 授权。
