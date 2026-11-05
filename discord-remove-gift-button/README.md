# Discord 净化

现有 Surge 模块通过 Map Local 和 URL Rewrite 处理 Discord 推广、商店、任务及遥测路径。它不加载 JavaScript，也没有修改 `premium_type` 的脚本。

## 安装

在 Surge 模块管理中添加：

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/discord-remove-gift-button/discord-remove-gift-button.sgmodule
```

启用 Rewrite 与 MITM，并安装、信任 Surge 当前的 CA 证书。解密主机由模块追加，包括 Discord 和 Sentry 的相关主机。本目录没有 Egern 原生 YAML。

本地安装只需要 [模块文件](discord-remove-gift-button.sgmodule)，不需要下载不存在的 `.js` 文件。

## 处理范围

- 推广活动、收藏品营销、任务等已列出的 API 返回本地空响应。
- 会员试用、订阅、支付来源、权益和商店路径返回预置响应。
- Science、Track、Metrics 及匹配的 Sentry 路径拒绝请求。

这些是网络响应处理，不直接操作 Discord 的页面元素。Gift/Nitro 按钮是否消失仍取决于客户端版本、缓存和当前接口，不承诺每个版本都得到相同页面。

## 影响与验证

空置订阅、支付和权益接口可能影响账号相关页面；任务与商店功能也可能不可用。Sentry 主机规则并不只作用于 Discord，其他使用同一服务的 App 也可能被命中。

1. 检查模块加载日志，确认语法和 MITM 配置被接受。
2. 在请求记录中检查目标路径是否命中 Map Local 或拒绝规则。
3. 对照聊天、登录、订阅、支付及其他需要保留的功能。
4. 如有异常，先停用模块做对照，再停用具体规则。停用不会直接清除 App 自己的缓存。

[返回仓库首页](../README.md)
