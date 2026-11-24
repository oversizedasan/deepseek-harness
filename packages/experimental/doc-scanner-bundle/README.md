---
description: "Explicit --patch composition for the Mock document scanner."
kind: "bundle"
---

# @deepseek-ai/dsh-doc-scanner-bundle

English | [中文](README.zh.md)

## Summary

Optional experimental composition that inserts the document-scanner seam, Mock provider, CZUR provider (disabled by default), Host Remote, and Client UI (live preview tab and add-to-draft). Enable with `--patch`; it is not part of `dsh-base`.

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

For hardware CZUR, use `cordis.czur.patch.yml` (Mock off, CZUR on) after the checks in the [practice guide](../../../docs/user/develop/practice/doc-scanner.md#phase-2-czur-hardware).

-----

<a id="further-exploration"></a>
## Further Exploration

- [DETAIL](docs/DETAIL.md)
- [Practice guide](../../../docs/user/develop/practice/doc-scanner.md)
- [Agent Note](../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.md)

-----

<a id="model-experience"></a>
## Model Experience

None.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Not listed in the Official plugin manager defaults in this phase.
- Default `cordis.patch.yml` keeps CZUR disabled so keyless demos stay on Mock; use `cordis.czur.patch.yml` for hardware.
