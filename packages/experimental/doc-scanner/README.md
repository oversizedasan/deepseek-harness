---
description: "Document-scanner provider registry and capture coordination."
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner

English | [中文](README.zh.md)

## Summary

`ctx.docScanner` registers document-camera providers, publishes live connection snapshots, and coordinates `connect` / `capture` / `followStills` / `preview` / `close`. Connection state is process-local; captures may persist through optional `ctx.attachments` and archive under `Captures/<batchId>/` when a batch id is supplied.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load through the [document scanner bundle](../doc-scanner-bundle/README.md) or compose the service with a provider and the [Remote](../api-doc-scanner/README.md). Providers register with `register()`; duplicate ids fail. `connect()` selects the sole provider or an explicit id. `capture({ batchId })` requires `phase === 'ready'` and returns preview base64 plus optional `attachmentId` / `workspacePath`. Providers may implement `subscribeStills` for hardgrab; consumers read them via `followStills`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Practice guide](../../../docs/user/develop/practice/doc-scanner.md)
- [Agent Note](../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.md)

-----

<a id="model-experience"></a>
## Model Experience

None in this phase. Capture does not call `followup()`; later business tools may attach saved images to model-visible messages.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only one active provider connection is tracked at a time.
- `preview` is separate from `follow`: frames never enter snapshots or Session history.
- CZUR hardware support ships in `@deepseek-ai/dsh-doc-scanner-czur` (opt-in patch).
- Teaching workflows that consume `attachmentId` are out of scope for this package.
