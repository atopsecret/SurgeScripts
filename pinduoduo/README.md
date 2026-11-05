# 拼多多去广告

重构自 [Thelongdarkorg/loon-plugins · pinduoduo_splash_ad_block.plugin](https://github.com/Thelongdarkorg/loon-plugins)（2026-10-07 更新版）。

页面改写保留 Loon Hub 的 RuCu6、ZenmoFeiShi、可莉来源署名。Egern 原生版本 `eg-native-20261105-r1` 使用独立 YAML 与原生上下文脚本，旧 Surge 实现不变。

## 安装

### Surge

```
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.sgmodule
```

### Egern 原生

```text
https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.egern.yaml
```

在 Egern 模块管理中添加 YAML；启用 MITM，安装并信任 Egern 自己的 CA。不要重复启用旧 `.sgmodule` 或处理同一接口的其它模块。generic 入口“拼多多去广告诊断”打印本地状态并返回诊断 Widget，不发送通知或网络请求。

## 原理与当前范围

| 层 | 方式 |
|---|---|
| 开屏接口 `api/cappuccino/splash` | Map Local 空体 200，App 判定无开屏直接进主界面 |
| 开屏素材（裸 IP + `/d` 路径直连下发） | URL-REGEX + 拼多多 UA 双条件拦截（`com.xunmeng.pinduoduo`） |
| 开屏接口 QUIC 旁路 | AND 规则阻断该域 QUIC，逼流量走 TCP 让 MITM 生效 |
| 首页、个人中心与会场页面 | 自托管脚本清理已知底栏和推广字段 |
| 订单与搜索页面 | 清理已知营销字段，不重构未知响应 |
| 多多视频浮层与指定运营接口 | 返回空 HTML 或 JSON |

## 处理边界

- 当前不只处理开屏，运营、推荐和签到领券入口可能受影响。功能异常时先停用模块做对照，再缩小到具体规则
- 素材拦截带 UA 限定，不影响其他 App 的同形请求
- 响应脚本最多处理 131072 字节，超过大小或字段结构变化时可能不执行页面改写
- 本模块不自动修改主配置的 IPv6 或 DNS 设置；HTTPS 接口改写依赖客户端实际接管、MITM 与证书信任
- Egern 使用原生 `and.match`：裸 IP 素材必须同时匹配拼多多 UA，QUIC 拒绝只限 `api.pinduoduo.com`；不设置全局 `block_quic`
- Egern 响应脚本先确认精确 API 主机；裸 IP 必须带精确 `Host: api.pinduoduo.com` 或 `api.yangkeduo.com`。只含域名子串或 UA 的请求不视为归属
- 旧来源的底栏白名单仅在首页、聊天、个人三个入口齐全且字段类型已识别时使用；缺少核心入口、陌生协议时保留整份导航
- HTTP 错误、显式业务失败、无效 JSON 与非目标接口不改写；已读取正文的处理失败显式返回原文
- Egern 视频浮层 Map Local 收窄到已知 `m.pinduoduo.net/vlayer_tab_popup.html`，不拦其它网站的同名页面；十九个原有推荐接口分别保留空 JSON

相关文件：[Surge 模块](pdd-adblock.sgmodule)、[Surge 脚本](pdd-ad-block.js)、[Egern 模块](pdd-adblock.egern.yaml)、[Egern 脚本](pdd-ad-block.egern.js)。

## 离线验证

需要 Node.js 20+，无需 npm 依赖。在仓库根目录运行：

```sh
node --input-type=module --check < pinduoduo/pdd-ad-block.egern.js
node --test pinduoduo/tests/egern.test.cjs
```

测试只用内存存储和虚构请求。覆盖六类页面、IPv4/IPv6 裸 IP 与精确 Host、未知导航、错误响应、正文单次消费、十九个推荐接口、素材路径边界和图片 CDN 负例。不访问真实接口；MITM、脚本下载和页面效果需在 Egern 内验收。

[返回仓库首页](../README.md)
