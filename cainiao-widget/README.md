# 菜鸟取件 · Egern 原生小组件

取件码放大，驿站和快递信息放在下面。支持桌面四种尺寸、浅深色与锁屏三种尺寸；查询失败时保留上次结果和原更新时间。

这是独立的小组件，可以与[菜鸟去广告](../cainiao/README.md)一起使用。无需 MITM 或 CA，不读取短信，不改写菜鸟 App 的响应。

![浅深色与锁屏布局，合成数据离线预览](preview/overview.png)

[错误状态与长文本预览](preview/states-overview.png)。预览由实际组件 DSL 生成，不是 Egern 真机截图。

## 安装

1. 在 Egern **工具 → 模块 → +** 添加[原生模块](https://raw.githubusercontent.com/atopsecret/SurgeScripts/main/cainiao-widget/cainiao-widget.egern.yaml)。
2. 按下文在电脑扫码登录一次，将生成文件里的 Cookie 整行填入模块 Env 的 `CAINIAO_COOKIE`。值只填在自己设备上。
3. 打开 Egern **分析 → 左上角小组件画廊**，找到“菜鸟取件”，检查是否有结果或明确错误提示。
4. 长按 iPhone 主屏幕添加 Egern 小组件，选好尺寸；长按组件 → **编辑小组件**，名称选择“菜鸟取件”。锁屏在锁屏编辑页面添加。

官方安装入口与字段见 [Egern 小组件文档](https://egernapp.com/zh-CN/docs/configuration/widgets/)。客户端需支持模块 `widgets`、`generic` 脚本及原生 DSL；旧版本若没有小组件画廊，先更新 Egern。

## 第一次扫码登录

在电脑下载本仓库，进入仓库目录。Python 3.11+，二维码库仅装到本地虚拟环境：

```sh
python3 -m venv work/cainiao-login-venv
work/cainiao-login-venv/bin/python -m pip install -r cainiao-widget/requirements-login.txt
work/cainiao-login-venv/bin/python cainiao-widget/login.py
```

助手会在本机生成二维码并尝试打开图片。用**手机淘宝**扫码，核对后确认登录；只有登录收尾和账号接口校验成功，才会保存凭据。默认最多等待 180 秒。没有浏览器窗口时可加 `--no-open`，自行打开终端提示的本地二维码图片。

成功后，输出目录内有：

- `cainiao.private.cookies.txt`：复制其中整行，粘贴到 Egern 模块 Env 的 `CAINIAO_COOKIE`。
- `cainiao.private.parameters.yaml`：供手动配置时参考的 `env` 参数；**这是私人参数文件，不是可公开订阅的模块**。
- `cainiao.private.qr.png`：本次登录二维码。

助手新建的目录权限为 `0700`，私人文件权限为 `0600`，已加入 Git 忽略。助手不在终端打印 Cookie，不把二维码内容发送到第三方服务。不要分享这些文件、二维码或含 Env 的配置导出；Egern 参数及本地缓存不承诺独立加密。扫码结束后可自行清理本次私人文件。

如果淘宝要求短信验证、人机验证或重新登录，在官方 App 完成后重新运行助手。本项目不绕过验证，不保证 Cookie 固定有效时长。助手遇到不在已允许淘宝、天猫、菜鸟 HTTPS 域范围内的登录收尾地址会终止；需要实际证据后再兼容，不会把全部凭据发送到未知地址。

## 排版

| 尺寸 | 显示内容 |
| --- | --- |
| 桌面小号 | 待取总数、第一件的大号取件码、驿站、快递及尾号 |
| 桌面中号 | 两件取件卡片及总数 |
| 桌面大号 | 四件；超过可见范围会提示还有多少件 |
| iPad 超大号 | 最多八件 |
| 锁屏圆形、矩形、内联 | 默认仅数量和状态；可显式开启取件码 |

有多件时按有码优先、相同驿站相邻排列。缺码与需短信验证会显示文字提示，不把 `NEEDSMS` 当取件码。完整运单号、收件人姓名、地址、电话和商品图片不进入组件缓存。

点击组件打开[菜鸟官网](https://www.cainiao.com/)。本版没有伪造包裹详情链接，不承诺直接跳 App、点击复制或标记已领取。

## 参数

| 键名 | 默认 | 作用 |
| --- | --- | --- |
| `CAINIAO_COOKIE` | 空 | 登录助手生成的 Cookie 整行，必填 |
| `REFRESH_MINUTES` | `15` | 建议刷新间隔，范围 `5–120` 分钟 |
| `LOCKSCREEN_SHOW_CODE` | `false` | 改为 `true` 才在锁屏展示取件码 |

锁屏展示取件码后，旁人也可能看到。桌面默认展示码；需要隐藏时使用锁屏默认布局。刷新由 iOS 决定，`refreshAfter` 只是建议，不能保证每十五分钟执行，更不保证领取后立即消失。刷新限制见 [Apple WidgetKit 文档](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)。

## 查询失败时

- 未登录：显示扫码接入说明，不显示“没有待取”。
- 登录过期、需验证或暂时断网：保留上次完整结果，明确标注“上次结果”和原更新时间。
- 分页没取全：有旧快照时显示旧快照；没有旧快照时显示已经查到的部分，数量标为“至少”。部分结果不会覆盖完整缓存。
- 响应格式变化：显示接口变化提示，不把未知结构当空列表。
- 切换账号：按账号或会话摘要隔离，旧账号包裹不会带到新账号。
- 超过七天的旧数据：不再展示旧码。清空 `CAINIAO_COOKIE` 并运行一次组件会清除本组件的设备缓存。

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

`core.mjs` 负责签名和规范化，`runtime.mjs` 负责 Egern 请求与缓存，`render.mjs` 返回原生 DSL，构建脚本将其内联为单个 `cainiao-widget.egern.js`。不下载远程运行库。

预览由 `node cainiao-widget/preview.mjs` 根据实际 DSL 生成，所有包裹都是合成数据；离线预览不等于 Egern 真机截图。测试覆盖协议、缓存、分页、账号隔离、隐私和渲染合同，不能代替首次扫码、服务端可用性与手机排版验收。

协议参考两个固定版本的 MIT 项目。来源、哈希和许可见 [sources.json](sources.json) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。没有执行上游技能或运行上游源码。
