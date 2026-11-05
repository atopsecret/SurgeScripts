# SurgeScripts

Surge 去广告模块、蔚来自动签到脚本和代理规则列表。京东、闲鱼另提供 Egern 原生版本，各模块独立安装，不需要替换整份客户端配置。

当前仓库：[atopsecret/SurgeScripts](https://github.com/atopsecret/SurgeScripts)。安装与脚本链接统一使用 `main`。

源码使用手动推送发布，GitHub Actions 保持禁用。`master` 仅保留旧版本历史，不作为当前安装入口。

## 模块索引

- **高德地图 2.0.0**：开屏本地响应、首页和搜索等已知页面推广处理。
  [使用说明](amap/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.sgmodule)
- **京东**：开屏、页面推广、已知底栏导航及短视频组件。
  [使用说明](jd/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml)
- **闲鱼**：新旧开屏接口、缓存广告引用、悬浮策略及指定广告素材。
  [使用说明](xianyu/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml)
- **拼多多**：开屏、多多视频入口、首页及订单页已知推广字段。
  [使用说明](pinduoduo/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.sgmodule)
- **红果短剧**：广告 SDK、已知插播广告视频主机和部分上报请求。
  [使用说明](hongguo/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.sgmodule)
- **Discord 净化**：对推广、商店和遥测等路径返回本地响应或拒绝请求，不加载外部 JavaScript。
  [使用说明](discord-remove-gift-button/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/discord-remove-gift-button/discord-remove-gift-button.sgmodule)
- **戒烟军团**：改写已知响应中的客户端会员标志位，不改变服务端会员资格。
  [使用说明](jyjt/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.sgmodule)
- **蔚来自动签到 2.1.2**：保存已知接口的登录凭据，每日 09:00 使用它签到。
  [使用说明](weilai/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.sgmodule)

只有京东、闲鱼提供 Egern 原生 YAML。其他模块没有对应原生版本，不将 `.sgmodule` 导入成功视为跨客户端兼容验证。

## 安装、更新与旧账号迁移

### Surge

1. 在模块管理中添加上面的 `.sgmodule` 链接。
2. 启用模块，检查语法、脚本下载和规则加载提示。
3. 需要 HTTPS 响应改写的模块，开启 Rewrite 与 MITM，并安装、信任 Surge 当前使用的 CA 证书。
4. 重新打开目标 App，在请求记录中确认接口命中，再检查页面与常用功能。

模块的远程脚本由客户端下载。同一个 App 不要同时启用多份处理相同接口的模块，排障时先保留一份。

### Egern

京东、闲鱼使用对应的 `.egern.yaml`，它们加载独立的 Egern 脚本，不是将 Surge 全局变量脚本直接套入 YAML。HTTPS 改写需要安装、信任 Egern 自己的 CA 证书；诊断入口见各目录说明。

### 从旧地址迁移

旧账号地址不会因为复制源码自动重定向。已经安装的模块需要换成上面的新链接，并刷新远程脚本缓存。高德模块描述应显示 `2.0.0`，蔚来任务日志首行应显示 `脚本版本 2.1.2`。

本次迁移只改变源码托管入口，不导出或迁移客户端登录凭据。原作者署名和本地诊断存储键保留，详见[迁移范围](MIGRATION.md)。

## 规则列表

- [AI.list](AI.list)：AI 服务及相关域名。
- [Telegram.list](Telegram.list)：Telegram 域名、IPv4 和 IPv6 地址段。

在 Surge 主配置的 `[Rule]` 中引用，例如：

```ini
RULE-SET,https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/AI.list,AI
RULE-SET,https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/Telegram.list,Telegram
```

将 `AI`、`Telegram` 换成配置中已经存在的策略名称，放在最终兜底规则之前。`AI.list` 含 Google 相关的较宽规则，不只匹配 Google AI；它不创建策略组，也不自动选择美国节点。

仓库没有独立的 Google AI 路由模块。旧说明中的该模块安装入口已移除，没有用占位文件代替。

## 行为边界

- 高德、京东、闲鱼、拼多多的 HTTPS 改写依赖客户端解密；具体主机和脚本入口由模块定义。
- 红果的域名拒绝不依赖解密，广告接口空响应需要 MITM；附带的 DoH 拒绝规则可能与主配置 DNS 设置冲突。
- Discord 当前是本地响应与拒绝规则，不包含修改 `premium_type` 的脚本。空置订阅、支付和权益接口也可能影响相关页面。
- 戒烟军团的已知业务接口使用明文 HTTP。客户端显示被改写，不代表服务器授予了会员权限。
- 蔚来从已知 HTTPS 请求头提取凭据，结果以接口实际返回为准。手动验证请在客户端运行定时任务；旧网页触发入口已移除。

模块不能直接清除 App 自己的缓存，网络命中也不等于所有版本和账号分组都显示相同页面。出现业务异常时，先停用模块做对照，再缩小到具体规则。

## 旧配置与抓包辅助

新安装优先使用当前模块。闲鱼的 [旧手动配置](xianyu/xianyu-ad-block.conf) 不等同于最新模块；[抓包配置](xianyu/xianyu-capture.conf) 仍引用去广告脚本，使用前要校正为[抓包脚本](xianyu/xianyu-capture.js)，不能直接当纯记录工具使用。

抓包辅助会输出请求、响应片段。不要公开客户端存储、未脱敏 HAR、Token、Cookie 或完整请求头。

## 离线校验

需要 Node.js 20+，不需要额外 npm 依赖。测试只使用本地文件、虚构凭据和模拟 HTTP，不执行真实签到或目标 App 请求。

```sh
node --test amap/tests/cleaner.test.cjs weilai/tests/checkin.test.cjs tests/link-validation.test.cjs
```

高德、蔚来原有 69 项测试覆盖响应处理与执行边界；链接测试另外检查新账号路径、现有文件和完整模块索引。语法检查可以使用 `node --check`；Egern 的 `.egern.js` 是 ES module，检查时需要按模块语法解析。

离线通过不代替 Surge/Egern 真机配置加载、接口匹配与页面验收。

## 反馈与来源

在 [Issues](https://github.com/atopsecret/SurgeScripts/issues) 中提供客户端、目标 App、系统版本、模块链接，以及脱敏的命中记录或诊断输出。

第三方来源和原作者署名保留在对应说明与源码中。仓库没有统一的 `LICENSE` 文件，不将所有内容笼统标为 MIT；引用内容的授权范围以各来源项目的许可证为准。
