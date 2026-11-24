---
description: "CZUR SDK Open document-scanner provider (Command WS + Video WS)."
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-czur

English | [中文](README.zh.md)

## Summary

Hosts the CZUR SDK Open `DocScannerProvider` on the Host: Command WS for session, device, and capture; Video WS frames for `preview()`; optional `autoCapture` turn detect so hardgrab stills push through `subscribeStills`. Credentials stay in the credentials seam.

## Table of Contents

- [Use this package](#use-this-package)
- [Phase-2 checklist](#phase-2-checklist)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Present in the [bundle](../doc-scanner-bundle/README.md). The default `cordis.patch.yml` keeps this row `disabled: true` (Mock demo). For hardware, use `cordis.czur.patch.yml` (Mock off, CZUR on) and set `CZUR_API_KEY` (or Config `credentialRef`).

Config fields: `commandWsUrl` (default `wss://sdk-runtime.localhost:18090`), optional `videoWsBaseUrl` (derived from Command when omitted), optional `preferredDeviceId`, optional `credentialRef` (default ambient name `CZUR_API_KEY`), `allowInsecureTls` (default `false`; the bundled patches set `true` because the local Runtime uses a self-signed certificate), `autoCapture` (default `true`, calls `device.set_turn_detect` after open).

Hardware setup, the launch command, and failure symptoms: [practice guide](../../../docs/user/develop/practice/doc-scanner.md#phase-2-czur-hardware).

-----

<a id="phase-2-checklist"></a>
## Phase-2 checklist

Implemented `DocScannerProvider` that:

1. Opens Command WS to `commandWsUrl` and calls `auth.create_session`.
2. Calls `device.list` / `device.get`; maps empty lists to `device_missing`.
3. Calls `device.open` until `opened: true`, then reports `ready`.
4. When `autoCapture` is true (default), calls `device.set_turn_detect` after open.
5. Ensures `video.start` on this connection, then calls `capture.take` with a profile; waits for `capture.completed` / `capture.failed` or polls `capture.get`.
6. Prefers inline base64; otherwise downloads Asset HTTPS with `Authorization: Bearer` from `auth.create_session` `session_token`.
7. Hardgrab / unmatched `capture.completed` stills emit through `subscribeStills`.
8. Handles `device.removed`, `DeviceBusy` (1201), and the 1500ms capture interval / `RateLimited` (1004).
9. Maps Video WS / `video.start` frames into `preview()` (JPEG) while the device is ready or capturing.
10. Registers on `ctx.docScanner` from `apply` and releases the device on dispose.

Official references: [device API](https://open.czur.com/docs/reference/sdk-open/device-api), [capture API](https://open.czur.com/docs/reference/sdk-open/capture-api), [device and video guide](https://open.czur.com/docs/guide/sdk-open/device-video).

-----

<a id="further-exploration"></a>
## Further Exploration

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

- Default bundle patch keeps CZUR disabled so CI and keyless demos stay on Mock.
- Advanced capture profiles (curved book, selected area) are not exposed in Config; turn detect is the boolean `autoCapture` only.
- Teaching workflows that consume `attachmentId` (grading overlays, multi-page trays) remain deferred.
