# 菜鸟去广告（Egern 原生）

`eg-native-20261108-1.0.0` 是根据固定的 Kelee 菜鸟活动规则重写的 Egern 原生模块。它不运行 Loon/Surge 兼容层，不加载远程公共运行时，也不访问菜鸟业务接口。

## 安装

将下面的地址添加到 Egern 模块：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.egern.yaml
```

需要在 Egern 中安装并信任自己的 CA，开启下面五个主机的 HTTPS 解密。不要同时启用会处理相同菜鸟接口的旧模块。

```text
netflow-mtop.cainiao.com
nbcps-mtop.cainiao.com
cn-acs.m.cainiao.com
e2e-mtop.cainiao.com
longquan-mtop.cainiao.com
```

## 覆盖范围

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
- Generic 入口“菜鸟去广告诊断”显示版本、固定路由计数与最近状态，不发通知、不请求网络、不保存 URL、Cookie、账号或正文。每项计数封顶 `999999`。

## 来源

原站地址本次返回 HTTP 403，不能据此声称核实了原站当前最新版。采用两份固定镜像交叉核对；活动 `[Rewrite]` 与 `[MitM]` 部分一致，元数据不同：

- [Moli-X/Tool 固定插件](https://github.com/Moli-X/Tool/blob/f4720ca1468bc5d97c7d6fc7771b894acf0770a1/Loon/Plugin/Kelee/Cainiao_remove_ads.plugin)，提交 `f4720ca1468bc5d97c7d6fc7771b894acf0770a1`，SHA-256 `5cd55de83ad866ad5a4b3b19dedbcf889e97f2b8a10d78a1696a2bd312861191`。
- [fkingikelee 固定 LPX](https://github.com/fkingikelee/fkikelee/blob/d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0/lpx/Cainiao_remove_ads.lpx)，提交 `d62650fa4b5d8c03f65f03ff0ec2e8afed3226c0`，SHA-256 `43df4ff17af92aae48952d6898f86e66e80348cb603cdad095d5fc98f6ab4bd8`。

原作者、固定镜像和引用关系记录在 [`sources.json`](sources.json)。本目录是独立重写，不为第三方内容推定统一许可证。

## 离线验证

需要 Node.js 20+、Python 3 与 PyYAML 6（解析公开 YAML）。测试只使用合成响应，不连接菜鸟服务：

```sh
node --input-type=module --check < cainiao/cainiao-adblock.egern.js
node --experimental-vm-modules --test cainiao/tests/egern.test.cjs
```

新增回归 **17/17 通过**，覆盖四个 404 的正负边界、完整 API 名和数值版本后缀、`.fetch.cn` 主机差异、三个响应结构、未知业务保留、HTTP/业务失败、单次正文读取、原字节回退、多值响应头与失败恢复、幂等和静默诊断。完整记录见[本次验证记录](../egern/验证记录-京东菜鸟-20261108.md)。离线通过不等于 Egern 真机导入、CA 信任、当前 App 页面效果或缓存验收。
