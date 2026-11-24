---
description: "Authenticated document-scanner Remote for Web clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-doc-scanner

English | [中文](README.zh.md)

## Summary

Exposes `ctx.docScannerController` as Typert Remote namespace `docScanner` with `snapshot`, `follow`, `followStills`, `connect`, `capture`, `preview`, and `close`. Capture and still streams accept an optional `batchId`. Calls never activate an Agent.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose after `@deepseek-ai/dsh-doc-scanner`. The Client mounts `./remote` through `@deepseek-ai/dsh-client-ui-doc-scanner`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Practice guide](../../../docs/user/develop/practice/doc-scanner.md)

-----

<a id="model-experience"></a>
## Model Experience

None.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- `preview` streams wire JPEG/PNG frames; hardware Video WS mapping lives in `@deepseek-ai/dsh-doc-scanner-czur` Phase-2.
- Grading and LMS workflows are out of scope.
