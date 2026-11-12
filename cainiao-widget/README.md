# 菜鸟取件 · Egern 数量小组件

显示待取件数量和最近更新时间。连接有效时，无需打开菜鸟 App 就能刷新。采用奶油底色和暖橙数字，支持深色模式、桌面四种尺寸及锁屏三种尺寸。数量为零时显示“暂无待取”。

**当前版本 1.4.0。** 本版只显示数量，不显示包裹摘要、站点或取件码；移除旧诊断和手动 Cookie 设置，并修复多次凭据轮换后撤销列表满导致停止连接的问题。已有连接和永久撤销记录保留。

[在线安装模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao-widget/cainiao-widget.egern.yaml?v=1.4.0) · [简短安装步骤](开始使用-1.4.0.md) · [验证记录](验证记录-1.4.0.md) · [浅深色与状态预览](preview-count.html)

## 安装与升级

不需要 ZIP、电脑、复制源码、HAR 或 Cookie。模块和脚本从 GitHub 下载，查询和凭据保存在自己的手机。

[在 Egern 添加菜鸟取件](egern:/modules/new?name=%E8%8F%9C%E9%B8%9F%E5%8F%96%E4%BB%B6&url=https%3A%2F%2Fraw.githubusercontent.com%2Fatopsecret%2FSurgeScripts%2Fmain%2Fcainiao-widget%2Fcainiao-widget.egern.yaml%3Fv%3D1.4.0)

若阅读器不支持 `egern:`，把上方在线模块地址添加到 Egern。链接采用官方格式 `egern:/modules/new?name=NAME&url=URL`。

1. 已有在线模块时更新原模块和它引用的 JS。已有本地版时，编辑原模块，把来源改成在线模块地址，保持连接开关为 `auto`；不要先设为 `off`，也不要另建第二份同名模块。
2. 保持 Egern 代理运行。已有自己的 HTTPS 解密证书并信任后，不用重装。模块仍使用原有五个精确主机，不增加权限或 CA。
3. 已连接时直接打开 Egern 的“小组件”，刷新现有“菜鸟取件”。模块描述和 JS 首行应显示 `1.4.0`。
4. 首次接入时，保留或添加 **菜鸟 App 自带的小组件**，正常打开本人菜鸟 App 一次，等官方组件实际刷新。Egern 接受同次真实凭据和合法业务参数后，才可独立查询。
5. 在 Egern 运行“菜鸟取件”；关闭菜鸟 App 后，再运行一次，核对数量和更新时间。桌面添加 Egern 小组件并选择“菜鸟取件”即可。

首次接入或会话失效后仍需菜鸟 App。正常刷新不依赖 App 保持打开。实际自动刷新由 iOS 决定，建议间隔默认为 15 分钟，不保证每十五分钟执行或取件后立即更新。

官方资料：[小组件](https://egernapp.com/zh-CN/docs/configuration/widgets/) · [模块](https://egernapp.com/zh-CN/docs/configuration/modules/) · [URL scheme](https://egernapp.com/zh-CN/docs/url-scheme/)。可与[菜鸟去广告](../cainiao/README.md)一起使用，不依赖它。

## 显示和错误状态

- 新查询成功：显示待取数量、更新时间；零件时显示“暂无待取”。数量使用服务端的 `agentSignPackNum`，不使用摘要条目数。
- 暂时断网或更新失败：有有效缓存时保留上次数量和原时间，并标注旧结果。没有有效结果则显示等待更新，不伪造零件。
- 连接已过期：停止重复使用被拒绝的凭据，等待菜鸟重新接入。
- 数据较旧：保留原时间；过旧的零值显示“上次无待取”，避免误认为刚刚查到零件。
- 尚未连接：等待首次连接，不回退旧 H5 或借用手动 Cookie 查询。

## 设置

| 设置 | 默认 | 作用 |
| --- | --- | --- |
| `CONNECTION_MODE` | `auto` | 独立刷新数量。`off` 在下次执行时清除本机连接和缓存，之后需重新接入；永久撤销记录保留。 |
| `REFRESH_MINUTES` | `15` | 建议刷新间隔，范围 5–120 分钟；最终由 iOS 调度。 |

分享上方公开安装链接即可。不要分享包含私人存储的 Egern 配置或登录凭据。退出、切换账号后，已绘制的桌面画面可能保留到下次刷新，可在 Egern 主动重新运行。

## 已验证的范围

手机数量版已经显示新外观，2026-11-11 在未打开菜鸟 App 的本轮操作中显示更新时间 16:17。相同查询逻辑此前已在 App 切换器关闭菜鸟后完成两次独立新请求，原会话和捕获时间不变。

这些结果只覆盖本人手机的手动数量查询。桌面定时刷新、token 到期自动续签和其他设备的接入尚未验收。服务端凭据有有效期，本组件不承诺永久免接入。取件码和完整包裹列表不属于本版功能。

## 实现与开发

模块保留四个入口，共用一个自包含 JS：会话与退出保护、专用凭据响应、官方组件查询参数、数量组件。查询只向固定 `guoguouser.cainiao.com` 接口发送新时间戳的 HTTPS POST，不复用原生签名，不调用第三方签名服务。

凭据、必要业务参数及缓存留在本人 Egern。bearer 绑定不等于 UID 身份已经核实。账号冲突、退出、迟到响应和已撤销 token 的保护继续生效。永久撤销指纹按独立键保存并回读确认；键数量随历史增长，存储配额失败时停止，Egern 未承诺跨进程事务。

```sh
node cainiao-widget/build.mjs
node cainiao-widget/build.mjs --check
node --input-type=module --check < cainiao-widget/cainiao-widget.egern.js
node --experimental-vm-modules --test --test-timeout=60000 cainiao-widget/tests/*.test.cjs
python3 -B -m unittest discover -s egern -p test_validate.py -v
node cainiao-widget/preview-count.mjs
```

需要 Node.js 20+；静态 YAML 验证需要 PyYAML 6。测试只使用合成会话和模拟 HTTP。预览由实际 `count-render.mjs` DSL 生成，数量为合成数据，图标是 SF Symbols 的近似。

`official.mjs` 负责凭据、隔离和独立查询，`count-render.mjs` 只读取总数、状态和时间，`runtime.mjs` 调度。旧 H5 代码保留用于已有状态兼容和回归，本版模块不暴露旧查询或研究入口。

来源和许可见 [sources.json](sources.json) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。[1.3.6 历史说明](历史说明-1.3.6.md)及各版验证记录保留历史结果，不作为当前安装步骤。
