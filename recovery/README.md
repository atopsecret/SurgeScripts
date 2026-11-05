# 原始 Git 历史恢复包

此目录保存重建候选图之前的原始 Git 对象和核验信息。它不是更早历史的备份：缺失父提交没有被恢复，也没有被伪造。

## 文件

- [source-original-history.bundle](source-original-history.bundle)：原始 22 个可达提交及其树、blob 和 refs。
- [source-original-metadata.json](source-original-metadata.json)：原 refs、symbolic refs、HEAD、原始提交元数据、shallow 字节、缺失父提交与 bundle SHA-256。
- [commit-map.json](commit-map.json)：原 SHA → 重建 SHA 映射，以及每个提交的树、完整消息、作者、提交者和 parent 映射验证。
- [restore_original_history.py](restore_original_history.py)：只向全新 bare 仓库恢复原始对象的完整工具。
- [恢复测试](tests/test_restore_original_history.py)：成功恢复、已有目录保护、元数据及哈希错误等离线测试。

## 恢复原 SHA

需要 Python 3.10+、Git 和 macOS/Linux，不需要第三方 Python 依赖。目标父目录必须存在，目标目录必须不存在。

```sh
python3 recovery/restore_original_history.py --target /ABSOLUTE/NEW.git
```

也可用 `--bundle`、`--metadata` 指定已复制的恢复包。工具先检查元数据与 SHA-256，再创建新的 0700 bare 目录、载入原对象、恢复记录中的 shallow 与 refs，并核对全部原 SHA、提交内容和 `git fsck --full`。

失败时保留本次新目录用于检查。工具没有覆盖、删除、推送或远端获取模式；请使用另一个不存在的目标路径重试。

恢复结果仍是原来的 shallow 图：原 main 为 `102414f4785c7a6feacba4be071579be97dbbec6`，边界提交 `86f8a7f428a8df6cb1de01b7d65ac715b42f26d3` 的真实父 `6a10d6a92a07b15146fd5afa2f29e5e102dc93ff` 依然缺失。原 SHA 可精确还原，不等于更早历史已经完整。

## 离线测试

```sh
python3 -m unittest discover -s recovery/tests -v
node --test amap/tests/cleaner.test.cjs weilai/tests/checkin.test.cjs tests/link-validation.test.cjs
```

Python 测试仅创建新的临时私有目录，不修改原源或恢复包，不发网络请求。用户已于 2026-11-05 确认采用重建历史；源码使用手动发布，GitHub Actions 保持禁用。恢复工具没有推送或自动发布功能。

本地已通过 13 项 Python 恢复测试及原有 79 项 Node 测试。独立原对象恢复验证保留 22 个原 SHA、4 个 refs 和真实 shallow 边界。

[返回迁移说明](../MIGRATION.md)
