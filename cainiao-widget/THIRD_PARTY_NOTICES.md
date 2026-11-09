# 来源与许可

本组件的 MTOP、PDS 字段，以及保留的独立扫码登录助手参考下列公开实现。1.2.0 按 [Egern 官方 API](https://egernapp.com/zh-CN/docs/javascript-api/)只读采集 App 请求头，候选经过独立个人查询后才确认，不依赖扫码助手。旧助手使用 Python 标准库重写请求、TLS、Cookie 域路径、登录收尾与私有文件输出。没有捆绑或执行上游 skill、Android 应用、SDK 二进制或 qrcode.js。

- mykohuang/kuaidi-skill，固定提交 da8e16247cd83d7f0b0772f383fda011bb4b89bf：[kuaidi.py](https://github.com/mykohuang/kuaidi-skill/blob/da8e16247cd83d7f0b0772f383fda011bb4b89bf/kuaidi.py)、[LICENSE](https://github.com/mykohuang/kuaidi-skill/blob/da8e16247cd83d7f0b0772f383fda011bb4b89bf/LICENSE)。
- polygongfw/pickup-assistant，固定提交 46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338：[Api.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Api.kt)、[Mtop.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Mtop.kt)、[Models.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Models.kt)、[QrLogin.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/QrLogin.kt)、[LICENSE](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/LICENSE)。Cookie 行为也核对同一提交中的 CookieStore.kt、Cookies.kt、SessionStore.kt；二维码状态与收尾测试核对 QrLoginTest.kt。

二维码依赖通过 requirements-login.txt 单独安装，仅供独立助手使用；默认手机流程无需安装。二维码内容只在本机编码，不使用第三方在线二维码服务。接口互操作性来源不等于当前服务端可用性保证；自动捕获的候选必须经个人列表查询成功确认，离线验证不能代替用户手机验收。

1.2.0 的 App 入口另核对 [官方 lib-mtop 2.6.1](https://g.alicdn.com/mtb/lib-mtop/2.6.1/mtop.js)、[官方 lib-login 2.2.3](https://g.alicdn.com/mtb/lib-login/2.2.3/login.js) 与 [官方 myexpress 0.0.8](https://cn.alicdn.com/guoguo/app-myexpress-taobao/0.0.8/index.js) 的调用、身份字段消费和原生桥行为；只作协议参考，不复制或分发上述代码。

1.2.2 的首次无 token 签名另核对 [官方 lib-mtop 2.7.4](https://g.alicdn.com/mtb/lib-mtop/2.7.4/mtop.js)：Cookie 缺失时保留 `undefined` 的字符串拼接语义，已有 token 只取首个下划线前缀。仅重新实现协议行为，不复制或捆绑官方 JS；原地址、字节数和 SHA-256 见 `sources.json`。这不证明 App 原生会话已能用于 H5。

公开固定 SDK 副本来自 [mimicode/albcpackage@e4275a7bb8dfc226490e1f30bb90c5ba3dbb41ab](https://github.com/mimicode/albcpackage/tree/e4275a7bb8dfc226490e1f30bb90c5ba3dbb41ab/libs)。MTOP 的 SID 注册与 alibabauth 的服务端 Cookie 注入是独立路径；没有取得 SID 等价于 `cookie2` 的证明。这是第三方副本，不标为官方认证源，也不能推广为当前 iOS 行为。实现只在本人手机有限试验 native 候选；身份匹配、COUNT 和完整 PDS 都通过才确认兼容。

1.2.3 仅据上述旧 SDK 的三个精确登录 API 名观察固定结构，不复制 SDK 代码、不提取正文凭据、不捆绑二进制。响应 Cookie 按实际来源域和三个 H5 路径重新实现过滤与候选门禁。固定合成发送对照使用公开 `https://postman-echo.com/headers`；该服务不接收本组件的个人登录态，不依赖第三方签名服务。上述依据均不证明手机接入已经成功。

1.2.4 根据本项目独立合成复现修复公共请求采集和首次失败显示，不复制上游实现。新官方 Havana 前端 0.10.38、固定 cddjr/check 登录模型及 PickTool 仅作静态协议／导航核对，没有执行或捆绑其源码；来源、哈希、接口前置条件和未确认的手机行为见 `sources.json` 及[本轮接入核对](接入核对-1.2.4.md)。来源／隔离修复不等于原生会话兑换完成。

1.3.0 的专用小组件通信合同来自[菜鸟官方网站](https://www.cainiao.com/technology-cainiao-app.html)下载入口实际指向的第一方 Android APK（8.11.1105）。只做本机静态分析，重新实现精确 token／JSON RPC 协议、请求归属和摘要过滤；不复制、执行或分发官方 App、反汇编代码或 SDK 二进制。具体来源链、文件 SHA-256 和平台限制见[官方协议核对](官方小组件协议核对.md)及 `sources.json`。Egern `ctx.http.post`、单次读体及原字节透传按[官方 JavaScript API](https://egernapp.com/zh-CN/docs/javascript-api/)实现。Android 的实现不被标为 iOS 实测，也不保证当前服务端接受；专用凭据和个人结果不离开本人手机。

1.3.1 根据本项目复现修复“实际查询已出现，但没有此前签发记录就无法接入”的限制，保留原 UID 签发路径。RPC-only 路径以该次实际 token 与合法业务模板建立 bearer 候选，token 摘要只作会话隔离，不表示已核实 UID。另在本人 iPhone 的现有 Egern 界面核对官方 `WidgetExtension` 发往精确查询端点的 POST 和 JSON RPC 请求头；未读取该次正文、凭据或包裹内容。现场端点证据不等于 iOS 正文、结果结构或独立刷新验收。没有新增第三方源码或许可依赖，不复制或分发官方代码；来源记录只保存协议事实，不含私人标识或原始流量。

以下保留两份上游 LICENSE 的完整原文。

## mykohuang/kuaidi-skill

~~~text
MIT License

Copyright (c) 2026 mykohuang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
~~~

## polygongfw/pickup-assistant

~~~text
MIT License

Copyright (c) 2026 coldbrew

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

────────────────────────────────────────────────────────────────────────────
第三方组件 / 声明

1. app/src/main/assets/qrcode.js
   派生自 davidshimjs/qrcodejs（MIT License，Copyright (c) 2012 davidshimjs），
   并含 makeIcon（二维码中心贴图）扩展。原文件被压缩后丢失了许可头，
   按 MIT 要求在此重新声明。若上游另有约定，以上游为准。

2. 本项目与菜鸟裹裹（Cainiao）、淘宝（Taobao）、天猫（Tmall）及其权利人
   无任何关联，未获其授权或背书。项目中出现的接口名、字段名、协议细节均为
   为个人互操作性研究而逆向得到，不构成对其知识产权的授权。
   使用者应自行遵守目标服务的使用条款与当地法律。
~~~
