---
description: "面向 Web 客户端的认证文档扫描仪 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-doc-scanner

[English](README.md) | 中文

## Summary

将 `ctx.docScannerController` 暴露为 Typert Remote 命名空间 `docScanner`，提供 `snapshot`、`follow`、`followStills`、`connect`、`capture`、`preview`、`close`。拍照与静帧流可带可选 `batchId`。调用不会激活 Agent。

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

在 `@deepseek-ai/dsh-doc-scanner` 之后组装。Client 通过 `@deepseek-ai/dsh-client-ui-doc-scanner` 挂载 `./remote`。

-----

<a id="further-exploration"></a>
## Further Exploration

- [实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

无。

#### KV Cache effect

无直接效果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `preview` 推送线上 JPEG/PNG 帧；真机 Video WS 映射在 `@deepseek-ai/dsh-doc-scanner-czur` 第二阶段。
- 批改与 LMS 流程不在本包范围。
