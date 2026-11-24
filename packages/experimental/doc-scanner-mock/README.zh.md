---
description: "用于连接态与拍照演示的 Mock 文档相机提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-mock

[English](README.md) | 中文

## Summary

在 `ctx.docScanner` 上注册类 CZUR 的 Mock 提供方。`connect()` 短延迟后进入 `ready`；`capture()` 返回固定 1×1 JPEG。

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

由[文档扫描仪组合包](../doc-scanner-bundle/README.zh.md)默认启用。无 Config 字段。

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

- JPEG 仅为演示占位，不是试卷图像。
- `preview` 仅以低帧率循环同一小图，供 UI 演示。
