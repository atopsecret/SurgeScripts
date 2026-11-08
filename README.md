# SurgeScripts

Surge 与 Egern 去广告模块、蔚来自动签到脚本、Apple 天气增强及菜鸟取件小组件。十个模块提供独立 Egern 原生版本；各模块可以单独安装，不需要替换整份客户端配置。

当前仓库：[atopsecret/SurgeScripts](https://github.com/atopsecret/SurgeScripts)。安装入口使用 `main`；蔚来 Egern 脚本固定到完整提交地址。

源码使用手动推送发布，GitHub Actions 保持禁用。`master` 仅保留旧版本历史，不作为当前安装入口。

## 模块索引

- **Apple 天气增强 1.0.0（Egern）**：基于 WeatherKit v3.1.0 的可用数据集、天气替换、降水补充和 AQI 算法；原生入口与二进制响应处理。
  [使用说明](apple-weather/README.md) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/apple-weather/apple-weather-enhancer.egern.yaml)
- **高德地图 2.1.0**：保留 RT 开屏，修复个人页 v3；十五类页面与内嵌配置定点净化。
  [使用说明](amap/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/amap/amap-adblock.egern.yaml)
- **京东 2.0.0**：十二类接口，补全个人页、订单、新品和物流变体；同步双端匹配与正文保护。
  [使用说明](jd/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jd/jd-adblock.egern.yaml)
- **菜鸟 1.2.0（Surge / Egern）**：补 HTTP/3 绕过、广告 API 的 `.cn` 变体、自营开屏视频和备用封面；保留双端页面清理。
  [使用说明](cainiao/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao/cainiao-adblock.egern.yaml)
- **菜鸟取件小组件 1.2.1（Egern 原生，正在发布）**：保留 App 同次真实 Cookie，不用 SID 顶替；首次验证失败不误报 App 登录过期。同一远程模块含采集、独立查询与固定失败阶段，不需要 ZIP、电脑或 HAR。真实个人接入及关闭 App 后更新仍需手机验收。
  [手机安装与升级](cainiao-widget/开始使用-1.2.1.md) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao-widget/cainiao-widget.egern.yaml?v=1.2.1)
- **闲鱼**：新旧开屏接口、缓存广告引用、悬浮策略及指定广告素材。
  [使用说明](xianyu/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-ad-block.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/xianyu/xianyu-adblock.egern.yaml)
- **拼多多**：开屏、多多视频入口、首页及订单页已知推广字段。
  [使用说明](pinduoduo/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/pinduoduo/pdd-adblock.egern.yaml)
- **红果短剧**：广告 SDK、已知插播广告视频主机和部分上报请求。
  [使用说明](hongguo/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/hongguo/hongguo-adblock.egern.yaml)
- **戒烟军团**：改写已知响应中的客户端会员标志位，不改变服务端会员资格。
  [使用说明](jyjt/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/jyjt/jyjt-member.egern.yaml)
- **蔚来自动签到（Surge 2.1.6 / Egern 3.2.0）**：保存已知接口的登录凭据，每日 09:00 使用它签到；成功通知简短并带表情。Egern 在累计缺失时先做一次有上限的同接口 POST 统计复查，再统一通知；保留当日观察和精简凭据提醒。
  [使用说明](weilai/README.md) · [Surge 安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.sgmodule) · [Egern 原生安装](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/weilai/weilai-auto-checkin.egern.yaml?v=3.2.0)

Egern 使用 `.egern.yaml` 和对应原生脚本，不直接运行 Surge 全局变量脚本。完整安装索引、转换差异与验证边界见 [Egern 说明](egern/README.md)。

## 安装、更新与旧账号迁移

### Surge

1. 在模块管理中添加上面的 `.sgmodule` 链接。
2. 启用模块，检查语法、脚本下载和规则加载提示。
3. 需要 HTTPS 响应改写的模块，开启 Rewrite 与 MITM，并安装、信任 Surge 当前使用的 CA 证书。
4. 重新打开目标 App，在请求记录中确认接口命中，再检查页面与常用功能。

模块的远程脚本由客户端下载。同一个 App 不要同时启用多份处理相同接口的模块，排障时先保留一份。

### Egern

使用对应的 `.egern.yaml`。需要 HTTPS 改写的模块，安装、信任 Egern 自己的 CA 证书；不要把 Surge CA 或存储搬进公开模块。原生脚本的诊断默认不抓正文，不输出凭据；入口见各目录说明。

蔚来需在 Egern 重新捕获登录凭据；启用 Egern 签到前先停止 Surge 同名任务。红果原生版不带旧版两条公共 DNS 拒绝规则。

### 从旧地址迁移

旧账号地址不会因为复制源码自动重定向。已经安装的模块需要换成上面的新链接，并刷新远程脚本缓存。高德模块描述应显示 `2.1.0`，京东应显示 `2.0.0`，菜鸟 Surge 应显示 `1.2.0`、Egern 应显示 `eg-native-20261108-1.2.0`；Surge 蔚来任务日志应显示 `脚本版本 2.1.6`，Egern 原生蔚来模块描述应显示 `3.2.0`。

旧账号迁移不导出或迁移客户端登录凭据。原作者署名和原有本地诊断存储键保留，详见[迁移范围](MIGRATION.md)。Egern 原生重写使用独立存储，行为差异见 [Egern 说明](egern/README.md)。

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
- 红果的域名拒绝不依赖解密，广告接口空响应需要 MITM；Surge 版附带的 DoH 拒绝可能与主配置 DNS 冲突，Egern 原生版已省去这两条。
- 菜鸟解密九个精确主机，并在这些主机上拒绝 QUIC 以促使重试 TCP；素材同时限定主机、目录、格式与菜鸟 UA。HTTPDNS 和登录接口保留，协议回退及实际业务连接仍需手机验证。
- 戒烟军团的已知业务接口使用明文 HTTP。客户端显示被改写，不代表服务器授予了会员权限。
- 蔚来从已知 HTTPS 请求头提取凭据，结果以接口实际返回为准。手动验证请在客户端运行定时任务；旧网页触发入口已移除。

模块不能直接清除 App 自己的缓存，网络命中也不等于所有版本和账号分组都显示相同页面。出现业务异常时，先停用模块做对照，再缩小到具体规则。

## 旧配置与抓包辅助

新安装优先使用当前模块。闲鱼的 [旧手动配置](xianyu/xianyu-ad-block.conf) 不等同于最新模块；[抓包配置](xianyu/xianyu-capture.conf) 仍引用去广告脚本，使用前要校正为[抓包脚本](xianyu/xianyu-capture.js)，不能直接当纯记录工具使用。

抓包辅助会输出请求、响应片段。不要公开客户端存储、未脱敏 HAR、Token、Cookie 或完整请求头。

## 离线校验

需要 Node.js 20+，运行已构建脚本的测试不需要额外 npm 依赖。测试只使用本地文件、虚构凭据和模拟 HTTP，不执行真实签到或目标 App 请求。Apple 天气的源码重建另需其目录内的固定依赖。

```sh
node --experimental-vm-modules --test --test-reporter=tap \
  amap/tests/cleaner.test.cjs weilai/tests/checkin.test.cjs \
  amap/tests/egern.test.cjs amap/tests/policy.test.cjs jd/tests/*.test.cjs \
  xianyu/tests/egern.test.cjs pinduoduo/tests/egern.test.cjs \
  jyjt/tests/egern.test.cjs weilai/tests/egern.test.cjs \
  apple-weather/tests/egern.test.cjs cainiao/tests/*.test.cjs \
  cainiao-widget/tests/*.test.cjs
```

当前候选发布树脚本测试共 **737 项**：菜鸟取件小组件 193 项、京东 82 项、菜鸟 50 项、高德 87 项、Apple 天气 52 项，其余模块 273 项。相比最新公开基线 **688/688 → 737/737**，本轮新增小组件 49 项，不包含本地保留的旧诊断。测试在各模块目录，不恢复已删除的根 `tests/`。字段、匹配和来源子集另有 **40 项** Python 测试，依赖 PyYAML 6：

```sh
python3 egern/validate.py
python3 -m unittest discover -s egern -p test_validate.py -v
```

Egern 的 `.egern.js` 是 ES module，单文件语法检查使用 `node --input-type=module --check < 文件名`。上述检查不执行模块业务请求，也不调用真实签到。

2026-11-06 在 Node.js 26.5.0、Python 3.14.3、PyYAML 6.0.3 下运行：脚本 **340/340**、Python **17/17**，无失败或跳过。蔚来包含 Surge 48 项和 Egern 76 项，覆盖带表情的成功通知、简短凭据提醒及合并、累计字段兼容、同日统计观察与原字节回传。另对 Rules 仓库六份原生集合做了 **9,980 条**条件等价检查；两份 LAN 辅助集合各 14 条。

离线通过不代替 Surge/Egern 真机配置加载、接口匹配与页面验收。

2026-11-08 Apple 天气转换：新增 52/52；全仓脚本 423/423，静态测试 22/22；八个 YAML 与七个原生 JS 字段、引用和语法检查通过。详情见 [Apple 天气验证报告](apple-weather/验证报告.md)。原插件 URL 本次抓取为 403，实际采用固定公开镜像，不声称核实了原站当前内容。

2026-11-08 高德 2.1.0：高德回归 54/54 → 87/87，全仓脚本 423/423 → 456/456，静态 22/22；补全十五类页面与内嵌配置处理，保留 RT 开屏契约。详情见[高德验证报告](amap/验证报告-2.1.0.md)。未做手机真机验证。

2026-11-08 京东 2.0.0 与菜鸟 1.0.0：京东 **44/44 → 82/82**，菜鸟新增 **17/17**，全仓 **456/456 → 511/511**，静态 **22/22 → 27/27**；九个原生 YAML、八个原生脚本检查通过。京东补四接口并统一双端正文保护，菜鸟迁移固定 LPX 的明确广告规则，省去整包清空未知业务的规则。来源、取舍与验证边界见[本次验证记录](egern/验证记录-京东菜鸟-20261108.md)；未做手机验收。

2026-11-08 菜鸟取件小组件 1.1.0：手机登录态捕获、账号隔离及并发回写检查通过；小组件 **44/44 → 83/83**、全仓 **555/555 → 594/594**、静态 **35/35 → 38/38**，49 个同源布局样例无问题。默认无需扫码助手；未做手机验收，见[1.1.0 验证记录](cainiao-widget/验证记录-1.1.0.md)。

2026-11-08 菜鸟去广告 1.1.1：开屏素材改用目录、格式与菜鸟 UA 条件，支持素材 ID 轮换；第二份 HAR 双端规则匹配 **98/156 → 102/156**，原样本保持 **123/169**。菜鸟 **43/43**、全仓 **620/620**、静态 **39/39**，未做更新后的手机验收，见[开屏补漏验证记录](cainiao/验证记录-1.1.1.md)。

2026-11-08 菜鸟去广告 1.2.0：HAR、PCAP 与压缩应用日志确认 HTTP/3 和自营视频路径；补 QUIC 条件、广告 `.cn` API 与视频备用封面。菜鸟 **47/47**、全仓 **624/624**、静态 **40/40**。客户端协议识别、TCP 回退和缓存仍待手机验收，见[1.2.0 验证记录](cainiao/验证记录-1.2.0.md)。

2026-11-08 菜鸟取件小组件 1.2.0 已发布：App 会话采集和独立查询已集成同一组件，新增 App 回归 **57/57**、主组件 **83/83 → 144/144**、全仓 **624/624 → 685/685**、静态 **40/40**，58 个同源布局零问题。十三个公开资源 HTTP 200，版本和哈希一致。原生会话兼容与关闭 App 后的新查询尚未手机验收，见[小组件 1.2.0 验证记录](cainiao-widget/验证记录-1.2.0.md)。

2026-11-08 菜鸟取件小组件 1.2.1 正在发布：保留同次实际 Cookie、严格验证 UID 和完整列表，修正首次失败文案及弱流量账号屏障；主组件 **144/144 → 193/193**、最新远程全仓 **688/688 → 737/737**、静态 **40/40**，58 个布局零问题。公开资源回读尚未完成，手机接入未验收，见[小组件 1.2.1 记录](cainiao-widget/验证记录-1.2.1.md)。

## 反馈与来源

在 [Issues](https://github.com/atopsecret/SurgeScripts/issues) 中提供客户端、目标 App、系统版本、模块链接，以及脱敏的命中记录或诊断输出。

第三方来源和原作者署名保留在对应说明与源码中。仓库没有统一的 `LICENSE` 文件，不将所有内容笼统标为 MIT；引用内容的授权范围以各来源项目的许可证为准。
