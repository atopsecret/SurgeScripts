# 高德开屏问题与重写验证

## 结论

2026-11-04 的开屏请求漏过了旧版正则，而且响应直接包含图片文件。修复不能只增加素材 CDN 拦截。

## 抓包证据

- 时间范围：09:11:10 至 09:11:17，共 183 条记录。
- `/ws/aos/alimama/splash_screen_rt` 返回 200，multipart 正文 210971 字节。
- `jsonData.data.custom_list` 有一条广告；另有一个 PNG 和一个 JPEG 部分，图片不依赖后续 CDN 下载。
- 旧开屏正则要求 `splash_screen` 之后是斜杠、问号或结尾，无法匹配 `_rt`。
- 同一包里 26 个广告素材主机请求已经被其他规则集拒绝，RT 接口仍正常返回素材。
- 捕获时启用了全域 MITM 覆盖；这证明该次请求能被解密，不证明日常配置已经正确开启模块自身的解密。

## 新模块

版本 2.0.0。原模块文件整体替换，新建可读页面脚本；不再在线调用第三方 JavaScript，也不再改写阿里明文 HTTPDNS。

RT 开屏使用本地 multipart 响应，保留已观察到的成功状态、响应版本和 jsonData 部分；广告列表为空，不附带图片。该格式仅用于已确认的 aos RT 通道。旧 aos/valueadded 普通入口返回空广告 JSON。普通入口与页面处理基于已知接口约定，未在本次抓包中全部出现。

页面部分覆盖八个既有端点，精确处理已知字段，不用“只保留两种卡片”或宽泛 `ai_` 匹配删除未知业务。其他广告专用接口由 Map Local 或拒绝规则处理。

## 可重复验证

```sh
node --check amap/amap-cleaner.js
node --test amap/tests/cleaner.test.cjs
python3 amap/tests/check_har.py /path/to/capture.har
```

RT 契约检查结果：原响应一条广告、两张内嵌图片；替代响应零广告、零图片。该检查只比较结构和成功字段，不证明 App 已接受本地响应或清除了旧缓存。

未把 HAR、图片、账号或定位信息加入仓库；未访问抓包中的接口。所有测试均离线执行。真机更新后还需核对 Map Local 命中、版本头及开屏表现。

## 页面字段参考

八个历史页面端点和部分字段名称参考 [ddgksf2013/Rewrite](https://github.com/ddgksf2013/Rewrite/blob/master/AdBlock/AmapAds.conf) 与 [ddgksf2013/Scripts](https://github.com/ddgksf2013/Scripts/blob/master/amap.js)。新脚本实现、分流、错误处理和诊断在本仓库重新编写，不包含上游混淆脚本，不复制整份外部实现。
