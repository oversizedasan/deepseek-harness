---
description: "Bundled homework-grade and wrong-book skills for the document-camera practice path, invoked only through Composer /."
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-skills

English | [中文](README.zh.md)

## Summary

Registers two user-invocable bundled skills (ASCII names `homework-grade`, `wrong-book`) on `ctx.skills` for the document-camera demo. Catalog `description` and skill bodies are Chinese for the classroom demo; the `/` primary row still shows the kebab-case `name` (Chinese identifiers are not valid skill names). Teachers load them with Composer `/` after attaching batch images. There is no chip strip.

## Use this package

Enable via the [doc-scanner bundle](../doc-scanner-bundle/README.md) patch. In the composer, type `/` and pick a skill (Chinese secondary copy), or type `/homework-grade` / `/wrong-book` literally.

## Model Experience

Chinese skill bodies inject on send through `dsh-tool-skill` when the leading `/name` matches. Images must already be draft attachments.
