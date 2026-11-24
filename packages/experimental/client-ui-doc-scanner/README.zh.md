---
description: "文档扫描仪状态芯片、叠层取景标签与本批附上到 Composer。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-doc-scanner

[English](README.md) | 中文

## Summary

挂载文档扫描仪 Remote，注册紧凑的 `conversation.input.right` 状态芯片（本批非空时显示 **附上本批 · N**：状态点打开相机，标签区附上图片并插入可点的归档目录 `@` 芯片）、+ 菜单「添加」下的 **文档相机** 入口，以及右侧栏带叠层快门与本批条的 **文档相机** 标签。本批条可看大图、打开归档路径（写入当前 Session 工作区）；空 `/` 查询时把演示技能置顶。批改等业务经 Composer `/` 完成，本包不注册技能芯片条。

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

通过[组合包](../doc-scanner-bundle/README.zh.md)加载。在右侧叠层取景中拍照（缩略图可看大图；**在文件中查看**打开 Session 工作区下 `Captures/...`）；点 **附上本批 · N** 标签静默附上图片到附件轨，并尽量插入 `@Captures/<batchId>/` 目录芯片（点状态点可再开相机）后，在输入框输入 `/`（空查询时 `homework-grade` / `wrong-book` 靠前，副文案为中文）。附上不发送 Session 消息；本批张数受 Composer 单次图片上限约束。目录芯片插入失败时图片仍保留，并给出轻提示。点目录芯片优先打开该批归档中的一张图；本批无匹配时打开 Files，并尽量列出归档目录后打开其中一张图。芯片对人显示「本批扫描 · 今天 HH:MM（N 张）」类文案，底层仍引用 `Captures/<YYYY-MM-DD_HHmmss>/`。同一批重复附上不会再追加已附过的图片，也不会再插目录芯片；本批新增静帧仍只附增量。刷新后若草稿仍有 `@Captures/<batchId>/` 且工作区归档在，会从磁盘重灌附件轨预览。

-----

<a id="further-exploration"></a>
## Further Exploration

- [实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md)
- [演示技能包](../doc-scanner-skills/README.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

仅当教师发送包含该草稿附件的轮次时才对模型可见。

#### KV Cache effect

无直接效果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 无真实批改叠图或 LMS 流程。
- 附上本批时 Client 会再次上传字节，即便 Host 已保存 `attachmentId`。
