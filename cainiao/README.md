# 菜鸟去广告（Surge / Egern）

当前版本 `1.2.1`（Egern：`eg-native-20261108-1.2.1`）。修正仅用 `QUIC` 协议条件的遗漏，九个精确主机改为 `QUIC 或 UDP` 且仅限端口 `443`；Surge 为这些域名增加 `extended-matching`。最新抓包确认开屏播放的是已缓存视频，同时原生 HTTP/3 仍有成功响应。此版本修正规则条件，尚未证明手机端已阻断这些连接或停止开屏。

规则来自菜鸟 `8.11.1105` 的四次授权 HAR、两次 PCAP 及本地解压的应用日志；原有页面规则保留固定 Kelee 来源。复核证据见 [1.2.1 验证记录](验证记录-1.2.1.md)。

Surge 与 Egern 各自使用原生模块和脚本。页面处理共用 `cainiao-policy.js`，构建时内联为独立文件；客户端不需要下载公共运行时。Surge 模块的规则、Map Local、页面匹配和解密主机从 Egern YAML 生成。

## 安装

Surge：将下面的原地址添加到模块，当前独立包装以 Surge iOS `6.x` / WebView 为目标：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.sgmodule?v=1.2.1
```

Egern：将下面的地址添加到模块：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.egern.yaml?v=1.2.1
```

在所用客户端中安装并信任自己的 CA，开启下面九个主机的 HTTPS 解密。不要同时启用会处理相同菜鸟页面接口的旧模块。

```text
netflow-mtop.cainiao.com
nbcps-mtop.cainiao.com
cn-acs.m.cainiao.com
e2e-mtop.cainiao.com
longquan-mtop.cainiao.com
unet.ucweb.com
p3-sign.douyinpic.com
a1.alibabausercontent.com
ossgw.alicdn.com
```

从旧版本更新时，在所用客户端的模块管理中手动更新整个模块。确认 Surge 描述显示 `1.2.1`，Egern 描述显示 `eg-native-20261108-1.2.1`。只刷新远程脚本不会更新 UDP、Map Local 和素材规则。检查上述主机已加入解密范围。

最新抓包的 `RtbAdsCostTime` 明确记录 `isCache=true`，展示视频与上一轮下载的视频相同。更新代理模块、刷新脚本或重启代理都不会删除菜鸟的本地素材。请先更新整个模块，再使用菜鸟自身的清理缓存功能，完全退出后重新打开。应用内清理是否包含广告 SDK 的全部缓存，仍由 App 决定；不能把清理操作当作网络阻断已经成功的证据。

广告 SDK 的域名拒绝不需要 HTTPS 解密；UC 曝光路径、素材 UA 条件和 Map Local 需要解密。九个精确主机的 UDP/QUIC `443` 条件用于促使重试 TCP；没有修改全局 QUIC、DNS 或其它菜鸟业务主机。Surge 的 `extended-matching` 只使用客户端已经识别到的 SNI，不会凭空还原 IP 直连的域名；Egern 文档没有这个字段，未照搬。未识别出域名的连接仍可能绕过，TCP 回退和最终开屏效果均未真机确认。

Surge 仍使用原目录的 [cainiao-adblock.js](<cainiao-adblock.js>)，响应脚本启用二进制正文、完整响应头与 `webview` 引擎；新增归并后的 generic 入口“菜鸟去广告诊断”只打印本地状态，不发通知、不请求网络、不创建 Widget。Egern 的原生脚本和诊断小组件保持不变。域名与 Map Local 命中仍查请求日志。

## 覆盖范围

### 1.2.1 协议条件修正与缓存复核

第四份 HAR 中，菜鸟模块实际拒绝了 50 条广告 SDK 请求，但没有列出普通 Mtop 广告接口或本次视频下载。解压应用日志后可见 60 条 Mtop 记录，其中 55 条为 `http3`、5 条为 `http2_0rtt_acs`；开屏事件仍指向上一轮视频，且标记为缓存命中。PCAP 中五个目标 Mtop 主机均有大量双向 UDP 数据，不能据此声称旧版 QUIC 拒绝已生效。

Surge 官方手册明确说明，并非所有 QUIC draft 都能识别；`DOMAIN` 默认也只匹配请求主机名。此版将原条件替换为 `(QUIC 或 UDP) + 443 端口 + 九个精确域名`，Surge 的域名子条件额外使用 `extended-matching`。条件数量仍为 20 条，五类 Map Local、页面清理和素材范围不变。新增测试分别覆盖 UDP 分类、其它端口放行、IP 直连有无可识别 SNI，避免再把离线解析出的域名当作手机客户端已经识别。

48 份可还原的 AMDC 调度响应中没有这些 Mtop 主机，不能凭这份样本确定改写哪个 HTTPDNS 字段会让它们回退。因此未改 AMDC、未硬编码抓包 IP，也未全局封锁 UDP/443。最新 HAR 没有模块版本响应头，只能确认菜鸟模块在处理部分请求，不能证明手机已装载某个具体版本。

### 1.2.0 HTTP/3 与自营开屏

第三次 HAR 里，一段 5 秒天猫双 11 竖屏视频从 `a1.alibabausercontent.com` 成功下载。对菜鸟上传日志做本地 LZ4 解压、Protobuf 解析后，`Page_Screen_Cpm` 的数据、展示与缓存事件同时指向该视频和 `ossgw.alicdn.com` 的独立备用封面。日志确认四个不同的自营素材地址，包括另一个预取素材。

日志中的 65 条 Mtop 记录有 60 条标记为 `http3`。PCAP 的 draft-29 QUIC Initial 握手也能识别 `netflow-mtop`、`cn-acs`、`e2e-mtop`、`nbcps-mtop` 和 `longquan-mtop`；这些接口没有出现在普通 HAR 请求列表里。只核对 HAR 的图片下载不足以验证原生广告请求已被处理。

`1.2.0` 新增三条原生条件，合计 20 条；其中协议条件已由 `1.2.1` 修正：

- 为上面九个需解密的精确主机添加 QUIC 拒绝条件。后续抓包未证明它已阻止目标连接，当前改用上面的 UDP/QUIC `443` 条件。规则同样影响其它 App 对这些主机的该类连接；其它主机和这些主机的 TCP 保留。
- `a1.alibabausercontent.com`：限定 `/prod/feupload/user/7clgu/` 目录、`*.mp4_.mp4` 格式和菜鸟 UA。
- `ossgw.alicdn.com`：限定 `/creatives-assets/prod/feupload/user/7clgu/` 目录、`*.jpg` 格式和菜鸟 UA，覆盖视频的备用封面。

两条素材规则支持目录内 ID 轮换，没有扩大到其它上传目录或整个阿里 CDN。规则不读取图片或视频内容；同一目录、格式和菜鸟 UA 下的其它文件也会被拒绝。

Map Local 同时补齐 `.ads.index.cn`、`.ads.show.cn`、`.ads.mshow.cn`，并新增已确认的 `mtop.cainiao.adx.flyad.getad.cn` 广告接口。详情与验证边界见 [1.2.0 验证记录](验证记录-1.2.0.md)。

### 1.1.1 开屏素材轮换

第二次抓包中，旧模块已拒绝 SSP 请求与 UC 曝光，但新广告图片仍有四次 HTTP `200`。`1.1.0` 仅匹配单张图片 ID，未覆盖新目录 `/tos-cn-p-0051/`。

`1.1.1` 改为同时要求以下条件，支持同格式素材 ID 在两个已确认目录中轮换：

- 主机为 `p3-sign.douyinpic.com`，使用 HTTPS。
- 目录为 `/tos-cn-p-0051/` 或 `/tos-cn-p-0051-ce/`。
- 文件名为字母、数字、下划线或连字符组成的 ID，接 `~tplv-noop.image`。
- UA 匹配 `Cainiao4iPhone/*` 或包含 `com.cainiao.cnwireless`。

其它 App 的 UA、普通路径、其它文件格式和主机保留。该规则也会拦截菜鸟内符合相同目录与格式的其它图片；它不逐张识别图片内容。其它投放主机、目录或模板变化仍需新样本核对。详见[1.1.1 验证记录](验证记录-1.1.1.md)。

### 广告 SDK 与 UC 曝光

保留 `1.1.0` 起的 17 条原生拒绝条件，其中图片条件已按 `1.1.1` 的方式修复；`1.2.0` 新增上述三条条件：

- `ssp.iytcdn.com`：广告配置、请求及 SDK 数据，包括本次成功返回广告启用标志的 `/union/sdk/config`。
- 穿山甲的 `pangolin-sdk-toutiao.com`、`pangolin-sdk-toutiao-b.com`、`pangolin-sdk-toutiao1.com` 广告域后缀，以及 `pglstatp-toutiao.com` 广告素材域后缀。
- 广点通 `mi.gdt.qq.com`、`sdk.e.qq.com`；Tanx 的 `ef-dongfeng.tanx.com`、`df.tanx.com`、`bdlog.tanx.com`；优酷广告主机 `ipm.atm.youku.com`。
- 本次出现的广告 SDK 主机 `entry-su1.ubixioe.com`、`adx-cfg-u1.ubixioe.com`、`sdk.1rtb.net`。
- 广告监测专用主机 `admonitor-feedback.cn-hangzhou.log.aliyuncs.com`。
- UC 共用主机仅拒绝完整的 `/v3/ad/show/toutiao` 曝光路径。
- `p3-sign.douyinpic.com` 采用上述素材目录、格式与菜鸟 UA 条件。

广告专用域名规则对设备上使用这些主机的其它 App 同样生效。共享 CDN 没有整域封锁；通用设备安全接口、HTTPDNS、登录接口及普通业务日志保留。

### 原有页面处理

- 五类明确广告请求使用 Map Local 返回空体 `404`，保留拒绝语义：
  - `mtop.cainiao.nbcps.presentation.fetch.cn`
  - `mtop.cainiao.guoguo.nbnetflow.ads.index` / `ads.index.cn`
  - `mtop.cainiao.adkeyword.get.cn`
  - `mtop.cainiao.guoguo.nbnetflow.ads.show` / `ads.mshow`，以及对应 `.cn` 变体；限定 `cn-acs.m.cainiao.com` 或 `netflow-mtop.cainiao.com`。
  - `mtop.cainiao.adx.flyad.getad.cn`，限定 `cn-acs.m.cainiao.com`。
- `mtop.cainiao.app.e2e.engine.page.fetch`：删除已知的 `mainSearch.bizData.searchContents` 与 `operationList`。
- `mtop.cainiao.app.e2e.engine.page.fetch.cn`：在上述字段之外，仅对 `e2e-mtop.cainiao.com` 删除已知的 `banner`、`activity`、`vip`。`cn-acs.m.cainiao.com` 的 `.fetch.cn` 只执行共同字段清理，这是固定活动规则中可确认的主机差异。
- `mtop.com.cainiao.longquan.place.getpageresourcecontent.cn`：只删除 `data.result.placeContentMap["780001"].contentList`。

页面清理保留其它查件、寄件、取件码、订单、包裹导入、钱包、权益、工具和未知字段。不修改 HTTPDNS、登录状态或服务端业务成功码。QUIC 回退是否影响实际业务连接，仍需更新后检查。

## 没有照搬的规则

固定 Kelee 活动插件还包含一条 `netflow` 响应规则：当首项 `materialId` 不是 `39017` 时把整个 `data` 替换为空对象。它缺少逐项广告判据，可能删除未知物流业务，因此本版不迁移。

同目录的 `Cainiao_remove_ads.js` 没有被活动 LPX/插件引用。本版不把那份旧脚本的首页白名单、消息筛选或工具处理冒充为当前插件覆盖。

## 正文与错误保护

- 响应正文只用 `arrayBuffer()` 读取一次；严格解码 UTF-8，未知格式、无效字节和解析失败回传原始字节。
- 仅处理完整 HTTP `200`；非 JSON 媒体类型、非 UTF-8 声明、失败 `ret`、陌生 `code` 和显式业务失败不改写。
- 列表字段仅接受数组，运营卡片仅接受对象或数组。未知标量类型保留，不创建缺少的路径。接口路径支持数值版本（如 `/1.0/`），不匹配相似 API 后缀。
- 只有正文发生变化时才清理旧的长度、压缩、缓存和校验头，并设置 JSON UTF-8、`no-store` 与版本头；未触及的多值 Cookie 和业务头保留。
- Surge 在不修改正文时调用 `$done({})` 保留原响应；改写时以 UTF-8 字节返回，并保留完整响应头中的重复 Cookie 顺序。五类 Map Local 的空体、`404` 与来源版本头和 Egern 一致；版本头不参与业务匹配，Surge 页面响应版本头仍为 `1.2.1`。
- Egern Generic 入口“菜鸟去广告诊断”显示版本、固定路由计数与最近状态，不发通知、不请求网络、不保存 URL、Cookie、账号或正文。每项计数封顶 `999999`。计数仅包含三组页面响应处理，域名、URL 和 Map Local 拦截请查看请求日志。

## 来源

原站地址本次返回 HTTP 403，不能据此声称核实了原站当前最新版。采用两份固定镜像交叉核对；活动 `[Rewrite]` 与 `[MitM]` 部分一致，元数据不同：

- [Moli-X/Tool 固定插件](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/Cainiao_remove_ads.plugin)，提交 `f4720ca1468bc5d97c7d6fc7771b894acf0770a1`，SHA-256 `5cd55de83ad866ad5a4b3b19dedbcf889e97f2b8a10d78a1696a2bd312861191`。
- [fkingikelee 固定 LPX](https://github.com/fkingikelee/fkikelee/blob/d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0/lpx/Cainiao_remove_ads.lpx)，提交 `d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0`，SHA-256 `43df4ff17af92aae48952d6898f86e66e80348cb603cdad095d5fc98f6ab4bd8`。

原作者、固定镜像和引用关系记录在 [`sources.json`](sources.json)。本目录是独立重写，不为第三方内容推定统一许可证。

`1.1.0` 的 HAR 补充规则独立于上面的固定插件来源。核对样本为 Surge iOS 导出的 169 条请求；原始 HAR、Cookie、设备标识、签名参数和响应正文均未进入仓库。公开记录只包含[主机聚合计数](har-audit-20261108.json)和[验证说明](验证记录-1.1.0.md)。

新增 Surge 版的规则与页面处理来源相同，双端核对数据见[Surge HAR 记录](har-audit-surge-20261108.json)，构建和验证见[Surge 发布说明](验证记录-Surge-1.1.0.md)。

`1.1.1` 使用第二份 156 条请求的 HAR，并复核第一份 169 条请求。聚合结果见[开屏补漏核对记录](har-audit-splash-20261108.json)。原始 HAR、图片正文、Cookie、设备标识和签名参数未上传。

`1.2.0` 增加第三份 147 条请求的 HAR、11,844 个包的 PCAP，以及其中可解压的应用日志。仅解析 QUIC Initial 的 ClientHello，没有解密 QUIC 应用正文。公开记录只保留[聚合结论](capture-audit-20261108-201845.json)，不包含原始捕获、完整日志、IP、账号或定位信息。

`1.2.1` 复核第四份 135 条请求的 HAR、11,260 个包的 PCAP 与应用日志，确认缓存视频继续展示及 HTTP/3 双向传输。公开记录只保留[聚合证据](capture-audit-20261108-204459.json)，不上传原始日志和抓包。官方协议与 SNI 匹配文档链接见 [1.2.1 验证记录](验证记录-1.2.1.md)。

## 当前原目录归并

模块地址与响应脚本名称不变，Rule、Map Local、Script 与 MITM 只归属本模块；主配置不再重复维护同一组广告规则。二十条规则、五条 Map Local 的状态/正文/头和九个精确解密主机保持校正来源语义，不新增全局 DNS 或证书。

2026-11-14：原回归 **50/50 → 50/50**；迁回 [canonical 回归](<tests/canonical.test.cjs>) **9/9 → 9/9**，当前本目录 **59/59**。原 Egern、共用策略和历史聚合记录字节不变。

## 离线验证

需要 Node.js 20+、Python 3 与 PyYAML 6（解析公开 YAML）。测试只使用合成响应，不连接菜鸟服务：

```sh
node cainiao/build.mjs --check
node --check cainiao/cainiao-adblock.js
node --input-type=module --check < cainiao/cainiao-adblock.egern.js
node --experimental-vm-modules --test cainiao/tests/*.test.cjs
python3 egern/validate.py
python3 -m unittest discover -s egern -p test_validate.py -v
```

菜鸟回归 **17/17 → 24/24**，新增广告主机边界、UC 完整路径、素材对象与 UA 双条件、解密范围、业务请求保留及诊断版本检查。全仓脚本 **594/594 → 601/601**，静态测试 **38/38 → 39/39**。

同一份 HAR 的离线匹配 **0/169 → 123/169**，包括 43 条此前返回 HTTP 200 的广告相关请求。这是规则覆盖数量，不代表手机已经拦截成功；真机效果还取决于模块更新、CA、规则顺序和 App 缓存。详见[1.1.0 验证记录](验证记录-1.1.0.md)。

新增 Surge 版后，菜鸟测试 **24/24 → 41/41**，包含 10 项 Surge、7 项双端一致性与构建测试；全仓脚本 **601/601 → 618/618**，静态测试保持 **39/39**。同一份 HAR 两端均匹配 **123/169**，逐条判断差异为零。手机端仍待验收。

`1.1.1` 菜鸟测试 **41/41 → 43/43**，全仓脚本 **618/618 → 620/620**，静态测试 **39/39**。第二份 HAR 双端匹配 **98/156 → 102/156**，新增覆盖四次成功下载的广告图片；第一份保持 **123/169**，两份逐条双端差异与覆盖回退均为零。更新后的手机开屏效果仍待验收。

`1.2.0` 菜鸟测试 **43/43 → 47/47**，全仓脚本 **620/620 → 624/624**，静态测试 **39/39 → 40/40**。第三份 HAR 的双端匹配 **69/147 → 70/147**，新增覆盖成功下载的视频；日志确认的四个自营素材地址 **0/4 → 4/4**。按 PCAP SNI 与协议离线判断，24 条可识别 QUIC 连接中有 9 条进入拒绝范围，其余 15 条保留。前两份 HAR 仍为 **123/169** 和 **102/156**。这些统计不能代替客户端对 draft-29 的识别、TCP 回退和开屏验收。

`1.2.1` 菜鸟测试 **47/47 → 50/50**，全仓脚本 **685/685 → 688/688**，静态测试 **40/40**。全仓基线已包含另一个任务发布的小组件测试。九个目标域名的合成输入在 `udp` 分类下匹配 **0/9 → 9/9**；缺失可识别 SNI 的 IP 直连仍不匹配。四份 HAR 覆盖无回退，最新 HAR 保持 **65/135**；此轮没有增加 HTTP 素材匹配。Surge/Egern 是否识别这些连接的域名、TCP 是否回退以及缓存是否清除，均未真机确认。
