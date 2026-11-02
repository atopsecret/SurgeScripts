# 高德地图去广告

基于墨鱼版（[ddgksf2013/Rewrite · AmapAds.conf](https://github.com/ddgksf2013/Rewrite/blob/master/AdBlock/AmapAds.conf)）适配 Surge/Egern：开屏广告、首页信息流、搜索热词、打车页推广、底部角标，共 **18 条规则**（脚本 10 + 拦截 8）。20261102-r1 将开屏处理改为自托管可读脚本，并补充仅针对高德的明文 HTTPDNS 调度处理；静默运行。

## 为什么重做

流传的 Surge 版「高德地图去广告」模块把 URL 模式错误写进了 `script-path` 参数（Shadowrocket 容忍该写法，Surge 不认），在 Surge iOS 5.23 上 **6 条脚本全部报「无效配置」被忽略，模块从未生效**。本模块按 Surge 正确语法重写。

## 安装

Surge iOS：模块 → 安装新模块，粘贴：

```
https://raw.githubusercontent.com/skernelx/SurgeScripts/master/amap/amap-adblock.sgmodule
```

装前先卸载手机上旧的「高德地图去广告」模块。

## 覆盖位置

| 位置 | 方式 |
|---|---|
| 开屏广告（aos / valueadded 双通道） | aos 空体 200；valueadded 自托管脚本清理 `data.ad` |
| 高德明文 HTTPDNS 调度 | 仅 `AMap` User-Agent 命中时替换调度响应，其它 App 放行 |
| 首页底部信息流（main-page / ai_rec） | 脚本 + Map Local |
| 首页顶部推广（msgbox） | 脚本 |
| 首页右中广告（frogserver） | 脚本 |
| 我的页面推广卡片 | 脚本 |
| 搜索框热词 / AI 推荐 | 脚本 |
| 路线规划下方广告卡片 | Map Local |
| 打车页推广 / 订单页 Tip | 脚本 + Map Local |
| 底部 tab 角标 | 脚本 |
| 广告归因上报 / 首页广告 gif | URL Rewrite reject |

## 已知限制

- HTTPS 开屏与其它页面脚本需要 MITM `*.amap.com`，并安装、信任当前客户端的 CA。配置里有证书不等于系统已经信任；Surge 与 Egern 各自使用对应证书
- 若高德日后加证书固定（表现为地图打不开），关掉模块即恢复
- 导航、定位、检索等核心功能域名不拦截，不受影响
- 已带 `http://amdc.m.taobao.com` 调度处理，严格限定 `AMap` User-Agent；明文 HTTP 不需额外解密淘宝域，不处理该主机的 HTTPS 请求
- 开屏响应结构不匹配时原样放行；规则不能直接删除 App 沙盒中的既有广告缓存。电脑端样例检查不等于当前手机广告已消失

## 致谢

规则与脚本全部来自 [@ddgksf2013](https://github.com/ddgksf2013)（墨鱼），按作者要求注明出处。本仓库仅做 Surge 语法适配。
