# 菜鸟去广告（Surge / Egern）

当前版本 `1.1.1`（Egern：`eg-native-20261108-1.1.1`）。修复开屏图片更换素材 ID 和目录后漏拦的问题，保留广告 SDK、UC 曝光和原有页面清理。规则来自菜鸟 `8.11.1105` 的两次授权抓包核对；原有页面规则保留固定 Kelee 来源。

Surge 与 Egern 各自使用原生模块和脚本。页面处理共用 `cainiao-policy.js`，构建时内联为独立文件；客户端不需要下载公共运行时。Surge 模块的规则、Map Local、页面匹配和解密主机从 Egern YAML 生成。

## 安装

Surge：将下面的地址添加到模块，需 Surge iOS `5.9.0+` / Mac `5.5.0+`：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.sgmodule
```

Egern：将下面的地址添加到模块：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.egern.yaml
```

在所用客户端中安装并信任自己的 CA，开启下面七个主机的 HTTPS 解密。不要同时启用会处理相同菜鸟页面接口的旧模块。

```text
netflow-mtop.cainiao.com
nbcps-mtop.cainiao.com
cn-acs.m.cainiao.com
e2e-mtop.cainiao.com
longquan-mtop.cainiao.com
unet.ucweb.com
p3-sign.douyinpic.com
```

从 `1.0.0` 或 `1.1.0` 更新时，在所用客户端的模块管理中手动更新整个模块。确认 Surge 描述显示 `1.1.1`，Egern 描述显示 `eg-native-20261108-1.1.1`。只刷新远程脚本不会更新素材拦截条件。检查上述主机已加入解密范围，然后完全退出并重新打开菜鸟。

广告 SDK 的域名拒绝不需要 HTTPS 解密；UC 曝光路径和图片的 UA 条件需要解密。已下载到 App 缓存的广告仍可能显示，新规则只能控制后续网络请求。

Surge 响应脚本启用二进制正文、完整响应头与 `webview` 引擎；本地诊断小组件为 Egern 专有入口，Surge 使用请求日志检查命中。

## 覆盖范围

### 1.1.1 开屏素材轮换

第二次抓包中，旧模块已拒绝 SSP 请求与 UC 曝光，但新广告图片仍有四次 HTTP `200`。`1.1.0` 仅匹配单张图片 ID，未覆盖新目录 `/tos-cn-p-0051/`。

`1.1.1` 改为同时要求以下条件，支持同格式素材 ID 在两个已确认目录中轮换：

- 主机为 `p3-sign.douyinpic.com`，使用 HTTPS。
- 目录为 `/tos-cn-p-0051/` 或 `/tos-cn-p-0051-ce/`。
- 文件名为字母、数字、下划线或连字符组成的 ID，接 `~tplv-noop.image`。
- UA 匹配 `Cainiao4iPhone/*` 或包含 `com.cainiao.cnwireless`。

其它 App 的 UA、普通路径、其它文件格式和主机保留。该规则也会拦截菜鸟内符合相同目录与格式的其它图片；它不逐张识别图片内容。其它投放主机、目录或模板变化仍需新样本核对。详见[1.1.1 验证记录](验证记录-1.1.1.md)。

### 广告 SDK 与 UC 曝光

保留 `1.1.0` 起的 17 条原生拒绝条件，其中图片条件已按上述方式修复：

- `ssp.iytcdn.com`：广告配置、请求及 SDK 数据，包括本次成功返回广告启用标志的 `/union/sdk/config`。
- 穿山甲的 `pangolin-sdk-toutiao.com`、`pangolin-sdk-toutiao-b.com`、`pangolin-sdk-toutiao1.com` 广告域后缀，以及 `pglstatp-toutiao.com` 广告素材域后缀。
- 广点通 `mi.gdt.qq.com`、`sdk.e.qq.com`；Tanx 的 `ef-dongfeng.tanx.com`、`df.tanx.com`、`bdlog.tanx.com`；优酷广告主机 `ipm.atm.youku.com`。
- 本次出现的广告 SDK 主机 `entry-su1.ubixioe.com`、`adx-cfg-u1.ubixioe.com`、`sdk.1rtb.net`。
- 广告监测专用主机 `admonitor-feedback.cn-hangzhou.log.aliyuncs.com`。
- UC 共用主机仅拒绝完整的 `/v3/ad/show/toutiao` 曝光路径。
- `p3-sign.douyinpic.com` 采用上述素材目录、格式与菜鸟 UA 条件。

广告专用域名规则对设备上使用这些主机的其它 App 同样生效。共享 CDN 没有整域封锁；通用设备安全接口、HTTPDNS、登录接口及普通业务日志保留。

### 原有页面处理

- 四个明确广告请求使用 Map Local 返回空体 `404`，保留原规则的拒绝语义：
  - `mtop.cainiao.nbcps.presentation.fetch.cn`
  - `mtop.cainiao.guoguo.nbnetflow.ads.index`
  - `mtop.cainiao.adkeyword.get.cn`
  - `mtop.cainiao.guoguo.nbnetflow.ads.show` / `ads.mshow`
- `mtop.cainiao.app.e2e.engine.page.fetch`：删除已知的 `mainSearch.bizData.searchContents` 与 `operationList`。
- `mtop.cainiao.app.e2e.engine.page.fetch.cn`：在上述字段之外，仅对 `e2e-mtop.cainiao.com` 删除已知的 `banner`、`activity`、`vip`。`cn-acs.m.cainiao.com` 的 `.fetch.cn` 只执行共同字段清理，这是固定活动规则中可确认的主机差异。
- `mtop.com.cainiao.longquan.place.getpageresourcecontent.cn`：只删除 `data.result.placeContentMap["780001"].contentList`。

其它查件、寄件、取件码、订单、包裹导入、钱包、权益、工具和未知字段保持原样。不会泛封阿里/淘宝共用域名，不修改 HTTPDNS、登录状态或服务端业务成功码。

## 没有照搬的规则

固定 Kelee 活动插件还包含一条 `netflow` 响应规则：当首项 `materialId` 不是 `39017` 时把整个 `data` 替换为空对象。它缺少逐项广告判据，可能删除未知物流业务，因此本版不迁移。

同目录的 `Cainiao_remove_ads.js` 没有被活动 LPX/插件引用。本版不把那份旧脚本的首页白名单、消息筛选或工具处理冒充为当前插件覆盖。

## 正文与错误保护

- 响应正文只用 `arrayBuffer()` 读取一次；严格解码 UTF-8，未知格式、无效字节和解析失败回传原始字节。
- 仅处理完整 HTTP `200`；非 JSON 媒体类型、非 UTF-8 声明、失败 `ret`、陌生 `code` 和显式业务失败不改写。
- 列表字段仅接受数组，运营卡片仅接受对象或数组。未知标量类型保留，不创建缺少的路径。接口路径支持数值版本（如 `/1.0/`），不匹配相似 API 后缀。
- 只有正文发生变化时才清理旧的长度、压缩、缓存和校验头，并设置 JSON UTF-8、`no-store` 与版本头；未触及的多值 Cookie 和业务头保留。
- Surge 在不修改正文时调用 `$done({})` 保留原响应；改写时以 UTF-8 字节返回，并保留完整响应头中的重复 Cookie 顺序。四类 Map Local 的空体与 `404` 和 Egern 一致；Egern 专用 Map Local 版本头不参与业务匹配，Surge 页面响应版本头为 `1.1.1`。
- Egern Generic 入口“菜鸟去广告诊断”显示版本、固定路由计数与最近状态，不发通知、不请求网络、不保存 URL、Cookie、账号或正文。每项计数封顶 `999999`。计数仅包含三组页面响应处理，域名、URL 和 Map Local 拦截请查看请求日志。

## 来源

原站地址本次返回 HTTP 403，不能据此声称核实了原站当前最新版。采用两份固定镜像交叉核对；活动 `[Rewrite]` 与 `[MitM]` 部分一致，元数据不同：

- [Moli-X/Tool 固定插件](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/Cainiao_remove_ads.plugin)，提交 `f4720ca1468bc5d97c7d6fc7771b894acf0770a1`，SHA-256 `5cd55de83ad866ad5a4b3b19dedbcf889e97f2b8a10d78a1696a2bd312861191`。
- [fkingikelee 固定 LPX](https://github.com/fkingikelee/fkikelee/blob/d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0/lpx/Cainiao_remove_ads.lpx)，提交 `d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0`，SHA-256 `43df4ff17af92aae48952d6898f86e66e80348cb603cdad095d5fc98f6ab4bd8`。

原作者、固定镜像和引用关系记录在 [`sources.json`](sources.json)。本目录是独立重写，不为第三方内容推定统一许可证。

`1.1.0` 的 HAR 补充规则独立于上面的固定插件来源。核对样本为 Surge iOS 导出的 169 条请求；原始 HAR、Cookie、设备标识、签名参数和响应正文均未进入仓库。公开记录只包含[主机聚合计数](har-audit-20261108.json)和[验证说明](验证记录-1.1.0.md)。

新增 Surge 版的规则与页面处理来源相同，双端核对数据见[Surge HAR 记录](har-audit-surge-20261108.json)，构建和验证见[Surge 发布说明](验证记录-Surge-1.1.0.md)。

`1.1.1` 使用第二份 156 条请求的 HAR，并复核第一份 169 条请求。聚合结果见[开屏补漏核对记录](har-audit-splash-20261108.json)。原始 HAR、图片正文、Cookie、设备标识和签名参数未上传。

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
