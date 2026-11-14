# 戒烟军团客户端会员标志位改写

本目录包含 Surge 响应脚本，以及独立的 Egern 原生 YAML 与脚本，改写戒烟军团已知接口中的会员标志位。处理的是客户端接收到的响应，不会修改服务端账号、付款记录或会员权限。Surge 1.0.0 已归并到原 [jyjt-member.js](<jyjt-member.js>) 与 [模块](<jyjt-member.sgmodule>)，采用 HTTP 200、完整零值/null、SOAP Fault 和 UTF-8 保护；Egern 资源本次不变。

## 安装

在 Surge 模块管理中添加：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.sgmodule
```

模块启用后，重新打开 App 并检查目标请求是否命中。

已知接口是明文 `http://smoke.nxnresearch.com/webservice510.asmx`，因此当前处理不需要 MITM。归并后的两端 matcher 都仅接受这个 HTTP 主机与完整路径边界；HTTPS 及同前缀未知接口放行，不追加全局解密或证书。

Egern 使用下节的独立 YAML，不导入 Surge 模块或旧脚本。

## Egern 原生版

公开本次变更后，模块地址为：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.egern.yaml
```

[原生脚本](jyjt-member.egern.js) 1.0.0 使用 Egern `ctx` 接口，不依赖 Surge 全局。与原版相比，匹配和错误处理收窄如下：

- 仅处理明文 HTTP 的精确主机与 `webservice510.asmx` 路径边界；查询和版本子路径可匹配，同前缀的未知接口不匹配。没有 HTTPS 或 MITM 自动兼容的承诺。
- 只有 HTTP 200 才读正文；SOAP Fault 原文放行。完整数字零值才替换，`0.5`、`0e0`、`-0`、字符串、已有会员值不改；日期只改完整 `null`。
- XML 与原有空白保留，不对整份 SOAP 执行 `json()`。正文只消费一次，原始 UTF-8 字节保留用于无变化或异常放行；其他声明编码不强转。
- 改写时保持原 XML `Content-Type`，在原 `Headers` 上清除过时长度、压缩及校验头；不枚举重建未知头，也不合并或丢失 Cookie。方法异常时回传原正文，并尝试恢复触及的头。
- 不保存状态、不发通知、不访问业务 API。网络流自身读取失败时无法重建未读完的原文；不二次读取或伪造空正文。持续失效的响应头 API 与流错误需要客户端运行验收。

这些已测试的匹配与字段保护现已迁回 Surge 原文件；两端仍只改变客户端接收到的字段，不改变服务器记录。

16 项离线测试全部使用虚构 SOAP 与响应上下文：

```sh
node --input-type=module --check < jyjt/jyjt-member.egern.js
node --experimental-vm-modules --test jyjt/tests/egern.test.cjs jyjt/tests/canonical.test.cjs
```

测试依赖 Node.js 20+、Python 3 与 PyYAML（只解析公开 YAML）。参考 [Egern 原生脚本 API](https://egernapp.com/zh-CN/docs/javascript-api/) 与[脚本配置](https://egernapp.com/docs/configuration/scriptings/)。YAML 解析和模拟上下文通过，不等于手机已经安装或页面显示已验收。

## 当前实现

根据目录中的接口分析，已知 SOAP 响应为 XML 包裹的 JSON 文本。脚本没有解析整份 XML，而是在响应原文中匹配以下字段：

| 字段 | 匹配值 | 替换值 |
| --- | --- | --- |
| `member_flg` | 数字 `0` | 数字 `1` |
| `user_type` | 数字 `0` | 数字 `1` |
| `member_end_date` | `null` | 字符串 `"2099-12-31"` |

已知接口包括 `process_user_online`、`get_user_info` 和 `get_member_item`。实际脚本按主机与路径匹配，不按 SOAP 方法名分流。

响应中没有 `member_flg` 文本时，脚本直接返回原文。存在该文本时，才执行三类字段替换；字符串形式的 `"0"`、已有非空到期日和其他未知格式不在当前替换规则中。

## 限制与日期处理

- 服务器再次校验会员权限时，专属操作仍可能失败。客户端显示会员，不代表服务器已经授予会员资格。
- `2099-12-31` 是脚本预设值，原分析中的到期日为 `null`，客户端接受的日期格式仍需实际验证。
- 不改写其他字段，不等于没有行为影响：客户端如何使用这些标志位，仍由 App 决定。
- 若响应编码、字段格式、接口路径或连接协议变化，需要重新核对，不能保证正则继续适用。

如果日期显示异常，先停用模块做对照。当前脚本在 `transform()` 中链式替换；若只停用日期处理，移除最后一条针对 `member_end_date` 的 `.replace(...)`，保留前两条零值替换。当前实现没有独立的 `DATE_RULE` 全局。

## 验证与还原

1. 在请求记录中确认 `webservice510.asmx` 命中了本模块。
2. 对照响应中的已知字段和 App 页面，分别确认网络改写与客户端显示。
3. 需要还原时停用模块，重新产生业务请求，让客户端接收未改写的服务端响应。

脚本没有持久写入会员状态，但 App 自己可能缓存页面或响应；停用后未立即刷新，不代表服务端数据发生了修改。

相关文件：[模块](<jyjt-member.sgmodule>)、[脚本](<jyjt-member.js>)。本页只描述已知 SOAP 接口，不推断其它业务接口都采用相同格式。

2026-11-14 原目录归并：原回归 **16/16 → 16/16**；迁回 [canonical 回归](<tests/canonical.test.cjs>) **4/4 → 4/4**，当前本目录 **20/20**。

[返回仓库首页](../README.md)
