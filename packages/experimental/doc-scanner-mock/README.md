---
description: "Mock document-camera provider for connection-state and capture demos."
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-mock

English | [中文](README.zh.md)

## Summary

Registers a mock CZUR-like provider on `ctx.docScanner`. `connect()` reaches `ready` after a short delay; `capture()` returns a fixed 1×1 JPEG.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Enabled by default in the [document scanner bundle](../doc-scanner-bundle/README.md). No Config fields.

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

- The JPEG is a demo stub, not a paper image.
- `preview` loops the same small JPEG at a low frame rate for UI demos only.
