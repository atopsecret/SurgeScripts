# 扫描全能王 · Egern 原生 1.0.1

完整重写为 Egern 原生 YAML，使用内置 jq 定点处理 JSON。只有一个模块文件，不加载 NobyDa 的远程脚本，也不依赖 Surge 兼容 API。

## 直接安装

- [一键导入 Egern](egern:/modules/new?name=%E6%89%AB%E6%8F%8F%E5%85%A8%E8%83%BD%E7%8E%8B&url=https%3A%2F%2Fraw.githubusercontent.com%2Fatopsecret%2FSurgeScripts%2Fmain%2Fcamscanner%2Fcamscanner.egern.yaml)
- [模块直链](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/camscanner/camscanner.egern.yaml)
- [查看模块源码](camscanner.egern.yaml)

也可以在 Egern「工具 → 模块 → 添加」中粘贴模块直链。适用于支持原生 `body_rewrites.response_jq` 的 Egern。

已安装的模块手动更新一次，描述显示 **1.0.1** 且到期日期为 **2099-12-31** 即为当前资源；更新后重新打开扫描全能王触发属性查询。

1. 停用处理同一接口的旧兼容模块，再启用本模块。
2. 开启 Egern HTTPS 解密；安装并信任 Egern 当前 CA。已经安装且信任当前 CA 的设备不用重复安装。
3. 关闭并重新打开扫描全能王，进入账户或会员页面，让 App 重新查询会员属性。
4. 在 Egern 请求记录中确认下面的接口命中，再核对实际页面和常用扫描功能。

模块仅追加解密主机，不携带证书、节点、账户信息或登录凭据，不替换整份主配置。

## 会员到期时间

**1.0.1 将会员到期时间改为北京时间 2099-12-31 23:59:59**，写入值为 Unix 秒字符串：

```text
data.psnl_vip_property.expiry = "4102415999"
```

这个值对应 UTC `2099-12-31 15:59:59`。保持接口原有字符串类型，不把秒误写为毫秒；其他响应字段及匹配规则不变。

之前显示 2033 年，是因为 [原 Surge 模块](https://yfamilys.com/module/camscanner.sgmodule) 引用的 [NobyDa 脚本](https://raw.githubusercontent.com/NobyDa/Script/master/Surge/JS/CamScanner.js) 写死 `"2013017600"`，即 `2033-10-15 19:33:20 UTC`，初版沿用了它。当前版本按用户要求只调整到期值，原脚本之外的会员等级和云端配额逻辑不变。

仅匹配两个精确 HTTPS 主机：

```text
api.intsig.net
api-cs.intsig.net
```

接口是 `/purchase/cs/query_property`。支持原有查询参数、空查询串、无查询串和显式 `:443`；不匹配其他端口、接口后缀、子路径、伪装主机、URL 用户信息或片段。

## 重写差异

- 使用 Egern 官方 `body_rewrites.response_jq`，没有额外脚本下载或运行时依赖。
- 原脚本会丢弃整份 JSON。本版只改 `expiry`，保留顶层、`data` 和会员对象的其他字段。
- `data` 是对象时，缺失或为 `null` 的会员对象会被创建；已有会员对象中的其他字段保留。
- 顶层或 `data` 不是对象，或会员对象是未知标量、数组时，保持 JSON 结构，不强行覆盖。
- 缺失 `data` 的错误包不变；不新增或覆盖服务端结果码。原生 jq 规则只处理 JSON，不读取 HTTP 状态，所以不声称按状态码跳过重写。
- MITM 从 `ap*.intsig.net` 收窄为两个实际匹配的主机，不添加全局 QUIC 拒绝。

原生 jq 会解析和重新序列化 JSON；这里保证的是已测试结构与字段语义，不是原始空白或响应字节相同。无效 JSON 在 Egern 内部的异常处理、手机端导入及 App 实际效果仍须客户端验证。

## 离线检查

构建：无需构建。模块运行依赖 Egern 内置 jq；以下本地测试另需 Python 3.11+、PyYAML 6、jq 1.6+。测试只读取本地模块并执行合成 JSON，不连接扫描全能王接口。

```sh
python3 egern/validate.py
python3 -m unittest discover -s egern -p test_validate.py -v
python3 -m unittest discover -s camscanner/tests -p test_camscanner.py -v
```

[模块回归](tests/test_camscanner.py)实际执行 YAML 内的 jq 表达式，覆盖字段保留、缺失值、未知类型、幂等、单输入单输出、URL 边界和导入链接。公共校验器仍是本仓库的字段检查器，不是 Egern 官方解析器。

2026-11-12 按仓库规范迁入独立目录后，本模块回归 **19/19 → 20/20**（新增目录布局检查），公共静态 **47/47**，原有脚本 **1096/1096**；十一份原生 YAML、九个原生 JS 检查通过。迁移前后的改写规则和 MITM 结构完全一致。初次独立复核另通过 43 个 JSON 和 39 个 URL 边界样例。以上是离线结果，不是手机端验收。

1.0.1 到期调整回归：本模块 **21/21**，公共静态 **47/47**，原有脚本 **1096/1096**。新增检查从真实 jq 输出解读 `4102415999`，确认是北京时间 **2099-12-31 23:59:59**，且字段仍为秒级字符串。

## 来源与格式依据

- 原作者：NobyDa；本仓库原生重写：atopsecret。来源及署名保留在模块注释和元信息中。
- [Egern 原生模块文档](https://egernapp.com/docs/configuration/modules/)
- [Egern 原生消息体重写文档](https://egernapp.com/docs/configuration/body_rewrites/)
- [Egern 完整配置示例](https://egernapp.com/docs/configuration/example/)：MITM 使用 `hostnames.includes`。
- [Egern URL Scheme](https://egernapp.com/docs/url-scheme/)
