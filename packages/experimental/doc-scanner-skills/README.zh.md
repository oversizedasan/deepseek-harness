---
description: "文档相机实践路径的 homework-grade / wrong-book 随包技能，仅通过 Composer / 调用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-skills

[English](README.md) | 中文

## Summary

在 `ctx.skills` 上注册两个用户可调用的随包技能（ASCII `name`：`homework-grade`、`wrong-book`），供文档相机演示使用。目录 `description` 与技能正文为中文；`/` 主行仍显示 `name`（技能名须为 kebab-case，不能用中文标识符）。教师在附上本批图片后通过 Composer `/` 加载。无芯片条。

## Use this package

经[文档扫描仪组合包](../doc-scanner-bundle/README.zh.md) patch 启用。在输入框输入 `/` 选择技能（副文案为中文说明），或直接键入 `/homework-grade` / `/wrong-book`。

## Model Experience

发送时若行首 `/name` 匹配，由 `dsh-tool-skill` 注入中文技能正文。图片须已是草稿附件。
