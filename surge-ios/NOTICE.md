# 来源与修改说明

本目录仅公开功能实现和合成测试，不包含手机配置、订阅、账户存储或证书。

## 通用模块

高德、菜鸟、京东、闲鱼、拼多多、红果和戒烟军团沿用本仓库现用实现与原作者署名。迁移主要是 Surge 运行环境、二进制/错误回退保护和与 Egern 当前范围一致的规则修正。

- 红果不带旧 Surge 候选的公共 DNS 拒绝。
- 拼多多的浮层 URL 限定 `m.pinduoduo.net`。
- 京东 POST 关联默认保持禁用。
- 闲鱼不在失败响应中伪造业务成功。

## 天气

保留原算法核心，去掉 Egern 入口导出并增加 Surge 的请求、响应、HTTP 超时、存储和二进制映射。

- NSRingo/WeatherKit **3.1.0**，提交 `77d06d5525297ba5f85543934db505aab6ef7547`；原作者 VirgilClyne、WordlessEcho、001。
- 本仓库 Egern wrapper **1.0.0**，提交 `5015215c1d0627ac019bd3c657842a83077daffc`。
- Google FlatBuffers JavaScript runtime **24.12.23**。
- 公开 schema 来自 `wuchunkei/weather-kit`，提交 `d44877a505308bac9970366fd7c0305257598168`。

Apache-2.0 全文与保留的上游说明分别见 [Weather 许可证](licenses/Weather-APACHE-2.0.txt)、[FlatBuffers 许可证](licenses/FlatBuffers-APACHE-2.0.txt) 和 [Weather 上游 NOTICE](licenses/Weather-UPSTREAM-NOTICE.md)。

天气脚本中的公开数据源回退值来自原公开核心，不是从用户账户导出的凭据。新的私有 API 参数仍由客户端单独设置。

## YouTube

保留 gholts/Maasea 的现用原生实现和 IBL3ND 的下载、字幕入口，组合为请求与响应 dispatcher，保持 protobuf 与 UMP 二进制格式。

- gholts：`8ac5bd1ad8f10ed7230cc86f7b8f4051a3a150b1`。
- IBL3ND：`4b734bd695edc0200d25110b20cfa2d67ba4b676`。
- Noble 内联依赖的 MIT 版权和许可文字保留在响应脚本。

改动包括补齐下载设置、双语字幕、安全回退和手机正文上限；没有替换为缺少两个入口的简化候选。

## 扫描全能王与蔚来

- 扫描全能王：把现用 jq 语义移成词法定点修改，保留其他响应字节。
- 蔚来：保留本仓库 Egern **3.2.0** 状态机，公开源提交 `1057abdc81da7382a07701df401c4f54541b7de7`；平台入口改为 Surge API。

蔚来新存储键只在用户客户端创建；仓库代码不带现有登录 Token，也不读其他客户端账户存储。

所有来源内容按对应原许可和署名保留；不为整个仓库追加一个笼统统一许可证。
