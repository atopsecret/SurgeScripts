# 高德地图去广告

重构自墨鱼版（[ddgksf2013/Rewrite · AmapAds.conf](https://github.com/ddgksf2013/Rewrite/blob/master/AdBlock/AmapAds.conf)，2025-12 仍在更新）：开屏广告、首页信息流、搜索热词、打车页推广、底部角标，共 **17 条规则**（脚本 9 + 拦截 8）。

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
| 开屏广告（aos / valueadded 双通道） | Map Local 空 JSON + 脚本清字段 |
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

- 脚本（amap.js，墨鱼混淆分发）需要 MITM `*.amap.com`——主配置已含 CA 证书，无需操作
- 若高德日后加证书固定（表现为地图打不开），关掉模块即恢复
- 导航、定位、检索等核心功能域名不拦截，不受影响
- 未带原版的 amdc.m.taobao.com 脚本（需额外 MITM 淘宝域，收益小风险面大）

## 致谢

规则与脚本全部来自 [@ddgksf2013](https://github.com/ddgksf2013)（墨鱼），按作者要求注明出处。本仓库仅做 Surge 语法适配。
