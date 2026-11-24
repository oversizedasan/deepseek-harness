---
description: "文档扫描仪提供方注册表与采集协调。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner

[English](README.md) | 中文

## Summary

`ctx.docScanner` 注册文档相机提供方，发布 live 连接快照，并协调 `connect` / `capture` / `followStills` / `preview` / `close`。连接态是进程本地的；拍照可在已挂载的 `ctx.attachments` 上持久化，并在提供 `batchId` 时归档到 `Captures/<batchId>/`。

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

通过[文档扫描仪组合包](../doc-scanner-bundle/README.zh.md)加载，或与提供方和 [Remote](../api-doc-scanner/README.zh.md) 一起组装。提供方用 `register()` 注册；重复 id 失败。`connect()` 选择唯一提供方或显式 id。`capture({ batchId })` 要求 `phase === 'ready'`，返回预览 base64 与可选 `attachmentId` / `workspacePath`。提供方可实现 `subscribeStills` 推送硬拍；消费者经 `followStills` 读取。

-----

<a id="further-exploration"></a>
## Further Exploration

- [实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md)
- [Agent Note](../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

本阶段无。拍照不会 `followup()`；后续业务工具可将已保存图片附到模型可见消息。

#### KV Cache effect

无直接效果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 同时只跟踪一个活跃提供方连接。
- `preview` 与 `follow` 分离：帧不进入快照或 Session 历史。
- CZUR 硬件支持在 `@deepseek-ai/dsh-doc-scanner-czur`（选用 patch）。
- 消费 `attachmentId` 的教学流程不在本包范围内。
