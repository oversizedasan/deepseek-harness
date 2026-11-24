# 文档扫描仪

实验性 Host 与 Web 组合，用于文档相机：连接状态、右侧栏实时取景、静帧拍照（本批大图 / `Captures` 归档），以及显式 **本批 N** 附上到 Composer 附件轨。演示批改技能经 Composer `/`（`doc-scanner-skills`；空查询置顶）加载。厂商协议留在 `ctx.docScanner` 之后。

## 启用

```sh
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.patch.yml
```

默认启用 Mock 提供方；CZUR 行保持 `disabled: true`，无密钥演示不需要 Runtime。

## 真机 CZUR

在完成[实践指南](../../../../docs/user/develop/practice/doc-scanner.zh.md#phase-2-czur-hardware)中的检查后，使用 `cordis.czur.patch.yml`（关 Mock、开 CZUR）。另见 [Agent Note](../../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.zh.md)。
