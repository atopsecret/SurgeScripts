# 菜鸟取件 · Egern 原生小组件

取件码放大，驿站和快递信息放在下面。支持桌面四种尺寸、浅深色与锁屏三种尺寸；查询失败时保留上次结果和原更新时间。

**1.1.0 改为手机自动连接。默认无需电脑扫码，也不用粘贴 Cookie。** 这是独立的小组件，可以与[菜鸟去广告](../cainiao/README.md)一起使用。捕获只读两个淘宝 H5 网关的请求头，不读取短信，不改写查件响应。

![浅深色与锁屏布局，合成数据离线预览](preview/overview.png)

[错误状态与长文本预览](preview/states-overview.png)。预览由实际组件 DSL 生成，不是 Egern 真机截图。

## 安装

已安装旧版或本地试用版时，先停用旧模块，不要同时启用两份同名组件。远程脚本 URL 的 `?v=1.1.0` 只是缓存更新参数，不会锁定 Git 提交；升级需核对模块描述和 JS 首行。

### 手机安装

1. 在 Egern **工具 → 模块 → +** 添加[原生模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao-widget/cainiao-widget.egern.yaml)。
2. 在手机 Egern 中启用 HTTPS 解密，按客户端指引安装并信任**自己的 Egern CA**。模块只声明 `h5api.m.taobao.com`、`acs.m.taobao.com`，不附带 CA，不修改手机系统设置。
3. 保持 Egern 代理运行，在手机打开[菜鸟官方查件页](https://page.cainiao.com/guoguo/app-myexpress-taobao/)，完成官方登录或验证后刷新包裹列表。已经登录且产生可复用的 H5 请求时，Egern 会保存登录态。
4. 回到 Egern **分析 → 左上角小组件画廊**，找到“菜鸟取件”并运行，检查是否出现包裹或明确错误提示。捕获只是候选，**个人列表查询成功才确认连接**。
5. 长按 iPhone 主屏幕添加 Egern 小组件，选好尺寸；长按组件 → **编辑小组件**，名称选择“菜鸟取件”。锁屏在锁屏编辑页面添加。

官方安装入口与字段见 [Egern 小组件文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)。客户端需支持模块 `widgets`、`generic` 脚本及原生 DSL；旧版本若没有小组件画廊，先更新 Egern。

`CONNECTION_MODE` 保持 `auto`，`CAINIAO_COOKIE` 留空即可。升级时在 Egern 更新模块并重新加载脚本，确认模块描述和 JS 首行均为 **1.1.0**；旧手动参数暂时仍能作为备用。

需要本地测试时，可按交付包根目录的 `开始使用.md`，创建客户端本地脚本 `cainiao-widget-1.1.0.egern.js` 并加载附带的本地 YAML。三个入口须引用同一客户端本地文件名，不能填 Mac 的绝对路径。官方允许[本地脚本路径](https://egernapp.com/zh-CN/docs/configuration/scriptings/)和[本地模块路径](https://egernapp.com/zh-CN/docs/configuration/modules/)；本地导入、跨入口存储及手机登录仍待真机验收。

## 手机连接没有成功时

- **尚未捕获**：先确认 Egern 代理和上述两个主机的 HTTPS 解密开启，再打开官方查件页、登录并刷新。只打开淘宝首页不保证产生所需请求。
- **淘宝或菜鸟内打开仍未捕获**：网页 SDK 可能走 WindVane 原生桥，而不是 H5 Cookie 请求。可在手机浏览器打开同一官方查件页；是否需要再次登录由官方页面决定。组件不会读取其他 App 沙盒，也不会把原生签名请求假装成 H5 登录态。
- **已捕获但未连接**：Egern 已保存候选，个人列表尚未成功。重新运行组件查看具体错误；只获得 `_m_h5_tk` 网关 token 不代表能读取个人包裹。
- **登录过期或需验证**：在官方页面完成登录/验证，重新打开并刷新查件页，再回到 Egern。失效会话不会在每次组件刷新时反复发送相同查询。
- **本机存储异常**：检查 Egern 后重开页面。捕获写入会回读确认；没有写成功不会报“已连接”。账号隔离屏障保存成功后，新候选写入失败也不会恢复旧账号查询。

模块另有 **“菜鸟连接诊断”** 通用脚本，可在脚本入口运行。它只读取本机连接状态和最近捕获结果，不发送个人查询，不显示 Cookie、账号或账号摘要。

自动凭据只保存必要登录 Cookie，包裹缓存只保留展示字段。凭据和缓存保存在本人设备，不承诺单独加密；不要分享含手动 Env 的导出或私人存储内容。

自动捕获、个人接口可用性及同脚本跨入口存储共享仍需用户手机首次验收。上述步骤是实现支持的操作流程，不是已经完成的真机结果。

## 排版

| 尺寸 | 显示内容 |
| --- | --- |
| 桌面小号 | 待取总数、第一件的大号取件码、驿站、快递及尾号 |
| 桌面中号 | 两件取件卡片及总数 |
| 桌面大号 | 四件；超过可见范围会提示还有多少件 |
| iPad 超大号 | 最多八件 |
| 锁屏圆形、矩形、内联 | 默认仅数量和状态；可显式开启取件码 |

有多件时按有码优先、相同驿站相邻排列。缺码与需短信验证会显示文字提示，不把 `NEEDSMS` 当取件码。完整运单号、收件人姓名、地址、电话和商品图片不进入组件缓存。

点击组件打开[菜鸟官方手机查件页](https://page.cainiao.com/guoguo/app-myexpress-taobao/)，未连接时也使用这个入口。不伪造包裹详情链接，不承诺直接跳 App、点击复制或标记已领取。

## 参数

| 键名 | 默认 | 作用 |
| --- | --- | --- |
| `CONNECTION_MODE` | `auto` | `auto` 优先自动捕获；`manual` 只用手动参数；`off` 禁用捕获并在下次组件执行清除本机状态 |
| `CAINIAO_COOKIE` | 空 | 可选手动登录 Cookie；自动模式未捕获时作为备用，不必填写 |
| `REFRESH_MINUTES` | `15` | 建议刷新间隔，范围 `5–120` 分钟 |
| `LOCKSCREEN_SHOW_CODE` | `false` | 改为 `true` 才在锁屏展示取件码 |

锁屏展示取件码后，旁人也可能看到。桌面默认展示码；需要隐藏时使用锁屏默认布局。刷新由 iOS 决定，`refreshAfter` 只是建议，不能保证每十五分钟执行，更不保证领取后立即消失。刷新限制见 [Apple WidgetKit 文档](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)。

## 查询失败时

- 未连接：显示手机查件页接入说明，不显示“没有待取”。
- 登录过期、需验证或暂时断网：保留上次完整结果，明确标注“上次结果”和原更新时间。
- 分页没取全：有旧快照时显示旧快照；没有旧快照时显示已经查到的部分，数量标为“至少”。部分结果不会覆盖完整缓存。
- 响应格式变化：显示接口变化提示，不把未知结构当空列表。
- 切换账号：新账号先建立隔离屏障，再保存候选；新候选写失败也不继续查询已知旧账号。查询途中捕获更新会停止旧任务，不把另一账号的码作为结果返回。
- 并发刷新：每次运行单独记录归属，迟到的旧任务不覆盖较新的完整快照。
- 超过七天的旧数据：不再展示旧码。需要退出时，将 `CONNECTION_MODE` 改为 `off` 并运行一次组件；确认提示已清除，再清空可选的手动 `CAINIAO_COOKIE`。`off` 不会代你修改参数中的原文。

关闭或切换账号后，iOS 已显示的旧 timeline 可能仍保留到下次系统刷新；请主动在组件画廊重新运行，必要时移除桌面旧组件。脚本无法立即擦除系统已经绘制的历史画面。

业务请求限定到 `h5api.m.taobao.com` 的固定个人列表路径；不跟随重定向，单次刷新最多二十页且总预算约十八秒。有效码优先识别驿站代收 `SIGN`，取消、退回、拒收、丢失等状态排除。数据是否及时、是否包含亲友件及是否需要额外验证，取决于服务端当前账号权限。

请求设置原生 HTTP 超时，接受结果前复核总预算。运行环境提供计时器时还会限制异步等待；Egern 官方文档未承诺计时器或可取消读体，极端流挂起仍可能由二十五秒脚本时限终止，不能承诺每种超时都能绘制新的错误提示。

## 开发与离线验证

```sh
node cainiao-widget/build.mjs
node cainiao-widget/build.mjs --check
node --experimental-vm-modules --test cainiao-widget/tests/*.test.cjs
python3 -m unittest discover -s cainiao-widget/tests -p 'test_*.py' -v
python3 egern/validate.py
```

`core.mjs` 负责签名和规范化，`auth.mjs` 负责只读捕获与本机连接状态，`runtime.mjs` 负责请求、归属检查和缓存，`render.mjs` 返回原生 DSL。构建脚本将它们内联为单个 `cainiao-widget.egern.js`，捕获、组件和诊断使用同一个脚本 URL。不下载远程运行库。

预览由 `node cainiao-widget/preview.mjs` 根据实际 DSL 生成，所有包裹都是合成数据。测试覆盖候选与访客区分、原样放行、token 轮换、并发刷新、账号隔离、缓存、分页、隐私和排版，不能代替手机捕获、服务端可用性和 Egern 原生显示验收。原生存储没有公开的事务或跨入口作用域保证，不承诺跨进程绝对互斥。

存储完全不可读写时无法持久记录账号变化，只能提示捕获失败；此时应暂停使用组件，修复存储后重新连接。捕获请求头没有 Cookie 的 Domain/Path 元数据，因此两个固定网关间仅作候选复用，不声称完整重建浏览器 Cookie 作用域。

独立的 Python 登录助手仍保留给已有手动流程和协议开发，默认安装不需要它；旧版使用说明见[1.0.0 历史文档](https://github.com/atopsecret/SurgeScripts/blob/fafc62337f46a4908b99b9d053796b24d1875d70/cainiao-widget/README.md)。

协议参考两个固定版本的 MIT 项目。来源、哈希和许可见 [sources.json](sources.json) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。没有执行上游技能或运行上游源码。
