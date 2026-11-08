# 菜鸟 Surge 1.1.0 验证记录

日期：2026-11-08，时区 Asia/Shanghai。基线提交：`c9a8686f93ff315110bbbd3856d6ffd3fdca5f65`。

## 实现

新增 `cainiao-adblock.sgmodule` 与独立的 `cainiao-adblock.js`。Surge 原生模块包含与 Egern 相同的 17 条广告拒绝条件、四类空体 `404`、页面响应匹配和七个 MITM 主机。

`cainiao-policy.js` 是双端页面路由、业务失败判定、字段清理和严格 UTF-8 解码的共同来源。`node cainiao/build.mjs` 生成 Surge 模块与两端脚本；`--check` 在文件缺失或过期时失败，不覆盖产物。客户端运行时不下载公共依赖。

Egern 的版本、诊断存储键和响应处理语义保留。Surge 使用 `$request`、`$response` 和 `$done`，配置 `binary-body-mode=true`、`full-header-mode=true` 与 `engine=webview`。失败、未知格式和无变化调用 `$done({})`；改写输出 UTF-8 字节并清理旧正文头，保留未触及的重复响应头及其顺序。

四类 Map Local 在两端使用相同 URL 正则、空正文和 `404`。Surge 未复制 Egern 专用本地版本头；页面脚本的版本头为 `X-Cainiao-Cleaner-Version: 1.1.0`。Egern 的诊断小组件没有移植为 Surge 小组件，Surge 查看请求日志。

## 验证

| 检查 | 修改前 | 修改后 |
| --- | --- | --- |
| 菜鸟测试 | 24/24 | 41/41 |
| 全仓 Node.js 回归 | 601/601 | 618/618 |
| 公共 Python 静态回归 | 39/39 | 39/39 |
| 原生静态检查 | 10 模块、9 脚本通过 | 10 模块、9 脚本通过 |

新增 10 项 Surge 测试和 7 项双端一致性及构建测试。包括五个页面路由、数值版本路径、业务字段保留、幂等、失败 JSON、无效 UTF-8、ArrayBuffer 和字节视图、单次完成、异常放行、完整响应头、17 条规则解析一致、四类 `404` 边界、脚本选项和解密主机。

双端脚本都通过语法检查。菜鸟、京东和高德构建一致性、差异空白检查通过。测试无失败、跳过或取消。

复现：

```sh
node cainiao/build.mjs --check
node --experimental-vm-modules --test cainiao/tests/*.test.cjs
node --experimental-vm-modules --test --test-reporter=tap */tests/*.test.cjs
python3 egern/validate.py
python3 -m unittest discover -s egern -p test_validate.py
node --check cainiao/cainiao-adblock.js
node --input-type=module --check < cainiao/cainiao-adblock.egern.js
node jd/build.mjs --check
python3 amap/build.py --check
git diff --check
```

## HAR 核对

同一份用户授权的 169 条 HAR 请求，在离线解析 Surge 模块后逐条比较两端规则：均匹配 `123/169`，判断差异为零。其中 43 条原响应为 HTTP `200`，其余 80 条在原 Surge 配置中已有其它规则处理。其余 46 条保留。

聚合结果见 [HAR 双端记录](har-audit-surge-20261108.json)。没有将原始 HAR、Cookie、设备标识、URL 签名或响应正文放入仓库，也没有向广告或菜鸟服务重放请求。

此轮没有操作手机；参考解析器和离线 VM 不是 Surge 官方客户端。模块导入、CA 信任、实际规则优先级、当前页面和 App 缓存效果仍需真机验收。使用者需要更新整个模块，新增 URL 与 UA 规则依赖相应主机的 HTTPS 解密。
