---
description: "用显式 --patch 组装 Mock 文档扫描仪。"
kind: "bundle"
---

# @deepseek-ai/dsh-doc-scanner-bundle

[English](README.md) | 中文

## Summary

可选实验组合：插入文档扫描仪 seam、Mock 提供方、CZUR 提供方（默认禁用）、Host Remote 与 Client UI（实时预览标签与加入草稿）。用 `--patch` 启用；不属于 `dsh-base`。

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

```sh
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.patch.yml
```

真机 CZUR 请在完成[实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md#phase-2-czur-hardware)中的检查后，改用 `cordis.czur.patch.yml`（关 Mock、开 CZUR）。

-----

<a id="further-exploration"></a>
## Further Exploration

- [DETAIL](docs/DETAIL.md)
- [实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md)
- [Agent Note](../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

无。

#### KV Cache effect

无直接效果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 本阶段不进入 Official 插件管理器默认列表。
- 默认 `cordis.patch.yml` 仍禁用 CZUR，无密钥演示走 Mock；真机用 `cordis.czur.patch.yml`。
