---
description: "CZUR SDK Open 文档扫描仪提供方（Command WS + Video WS）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-doc-scanner-czur

[English](README.md) | 中文

## Summary

在 Host 上实现 CZUR SDK Open 的 `DocScannerProvider`：Command WS 负责会话、设备与拍照；Video WS 帧进入 `preview()`；可选 `autoCapture` 翻页检测，使硬拍静帧经 `subscribeStills` 推送。凭据留在 credentials 缝。

## Table of Contents

- [Use this package](#use-this-package)
- [Phase-2 checklist](#phase-2-checklist)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

出现在[组合包](../doc-scanner-bundle/README.zh.md)。默认 `cordis.patch.yml` 保持本行 `disabled: true`（Mock 演示）。真机请用 `cordis.czur.patch.yml`（关 Mock、开 CZUR），并设置 `CZUR_API_KEY`（或 Config `credentialRef`）。

Config：`commandWsUrl`（默认 `wss://sdk-runtime.localhost:18090`）、可选 `videoWsBaseUrl`（省略时从 Command 推导）、可选 `preferredDeviceId`、可选 `credentialRef`（默认 ambient 名 `CZUR_API_KEY`）、`allowInsecureTls`（默认 `false`；随包 patch 显式设为 `true`，因为本地 Runtime 使用自签名证书）、`autoCapture`（默认 `true`，连接后调用 `device.set_turn_detect`）。

真机配置、启动命令与故障现象见[实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md#phase-2-czur-hardware)。

-----

<a id="phase-2-checklist"></a>
## Phase-2 checklist

已实现的 `DocScannerProvider`：

1. 打开到 `commandWsUrl` 的 Command WS，并调用 `auth.create_session`。
2. 调用 `device.list` / `device.get`；空列表映射为 `device_missing`。
3. 调用 `device.open` 直至 `opened: true`，然后报告 `ready`。
4. 当 `autoCapture` 为 true（默认）时，在 open 后调用 `device.set_turn_detect`。
5. 拍照前确保本连接已 `video.start`；带 profile 调用 `capture.take`；等待 `capture.completed` / `capture.failed` 或轮询 `capture.get`。
6. 优先读 inline base64；否则用 `auth.create_session` 的 `session_token` 以 `Authorization: Bearer` 下载 Asset HTTPS。
7. 硬拍 / 无 waiter 的 `capture.completed` 经 `subscribeStills` 推送。
8. 处理 `device.removed`、`DeviceBusy`（1201）以及 1500ms 采集间隔 / `RateLimited`（1004）。
9. 将 Video WS / `video.start` 帧映射到 `preview()`（JPEG），在设备就绪或拍摄中推送。
10. 在 `apply` 中注册到 `ctx.docScanner`，并在 dispose 时释放设备。

官方参考：[设备接口](https://open.czur.com/docs/reference/sdk-open/device-api)、[采集接口](https://open.czur.com/docs/reference/sdk-open/capture-api)、[设备与视频指南](https://open.czur.com/docs/guide/sdk-open/device-video)。

-----

<a id="further-exploration"></a>
## Further Exploration

- [实践指南](../../../docs/user/develop/practice/doc-scanner.zh.md)
- [Agent Note](../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.zh.md)

-----

<a id="model-experience"></a>
## Model Experience

无。

#### KV Cache effect

无直接效果。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 默认组合包 patch 仍禁用 CZUR，以便 CI 与无密钥演示走 Mock。
- 高级采集 profile（曲面书、选区）未暴露为 Config；翻页检测仅为布尔 `autoCapture`。
- 消费 `attachmentId` 的教学流程（批改叠图）仍延后。
