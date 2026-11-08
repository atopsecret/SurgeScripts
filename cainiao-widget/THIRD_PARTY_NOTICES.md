# 来源与许可

本组件的 MTOP、PDS 字段，以及保留的独立扫码登录助手参考下列公开实现。1.1.0 默认按 [Egern 官方 API](https://egernapp.com/zh-CN/docs/javascript-api/)只读捕获手机官方查件页的 H5 请求头，保存待验证登录态，不依赖扫码助手。旧助手使用 Python 标准库重写请求、TLS、Cookie 域路径选择、登录收尾及私有文件输出。没有捆绑或执行上游 skill，也没有捆绑 Android 应用或 qrcode.js。

- mykohuang/kuaidi-skill，固定提交 da8e16247cd83d7f0b0772f383fda011bb4b89bf：[kuaidi.py](https://github.com/mykohuang/kuaidi-skill/blob/da8e16247cd83d7f0b0772f383fda011bb4b89bf/kuaidi.py)、[LICENSE](https://github.com/mykohuang/kuaidi-skill/blob/da8e16247cd83d7f0b0772f383fda011bb4b89bf/LICENSE)。
- polygongfw/pickup-assistant，固定提交 46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338：[Api.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Api.kt)、[Mtop.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Mtop.kt)、[Models.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/Models.kt)、[QrLogin.kt](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/app/src/main/java/com/coldbrew/pickupassistant/data/QrLogin.kt)、[LICENSE](https://github.com/polygongfw/pickup-assistant/blob/46406c53c40c3fbd8b3ee6f5f899eda9ebb0e338/LICENSE)。Cookie 行为也核对同一提交中的 CookieStore.kt、Cookies.kt、SessionStore.kt；二维码状态与收尾测试核对 QrLoginTest.kt。

二维码依赖通过 requirements-login.txt 单独安装，仅供独立助手使用；默认手机流程无需安装。二维码内容只在本机编码，不使用第三方在线二维码服务。接口互操作性来源不等于当前服务端可用性保证；自动捕获的候选必须经个人列表查询成功确认，离线验证不能代替用户手机验收。

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
