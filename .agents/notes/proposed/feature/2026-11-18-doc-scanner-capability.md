# Agent Note: Document scanner capability for classroom capture

Status: proposed

English | [中文](2026-11-18-doc-scanner-capability.zh.md)

## Problem

Teachers need a document camera (for example CZUR) to photograph student papers before later grading or filing workflows. That hardware must not force a fork of the agent loop, must not bury vendor WebSocket details inside Chat UI, and must not treat “device connected” as durable Session truth that the model somehow saw. Classroom products (Doubao teacher skills, CZUR AI grading, HoverCam Flex AI) treat capture as input to a task—preview, align, then grade or explain—not as a permanent “device status” gadget alone.

## Proposal

Add an experimental document-scanner capability seam under `packages/experimental/`, composed like the voice-input stack:

| Role | Package | Responsibility |
|---|---|---|
| Service Definition | `@deepseek-ai/dsh-doc-scanner` | `ctx.docScanner`: register providers, `snapshot` / `follow` / `followStills`, `connect` / `capture` / `preview` / `close`; optional batch archival under `Captures/<batchId>/` |
| Mock Provider | `@deepseek-ai/dsh-doc-scanner-mock` | Demo connection state machine, viewfinder frames, and a fixed JPEG capture (manual only) |
| CZUR Provider | `@deepseek-ai/dsh-doc-scanner-czur` | Host CZUR SDK Open Command WS capture, Video WS → `preview()`, `autoCapture` turn detect, hardgrab → `subscribeStills` |
| Demo skills | `@deepseek-ai/dsh-doc-scanner-skills` | Bundled `homework-grade` / `wrong-book` on `ctx.skills` for Composer `/` only |
| Host Remote | `@deepseek-ai/dsh-api-doc-scanner` | Authenticated Typert Remote for the Web Client (`capture` + `followStills` with optional `batchId`) |
| Client UI | `@deepseek-ai/dsh-client-ui-doc-scanner` | Composer status chip (**Attach batch · N**, click attaches images and an archive-folder `@` chip when N≥1); + menu; right-sidebar overlay viewfinder + batch strip — **no** skill chip strip |
| Bundle | `@deepseek-ai/dsh-doc-scanner-bundle` | Explicit `--patch` composition; Mock enabled, CZUR disabled |

Connection state is process-local live state (`follow`). Live viewfinder frames use a separate `preview` stream and never enter Session history by themselves. Hardware stills push through `followStills`. Successful stills may persist through `ctx.attachments`, archive under the Client `batchId`, and return wire bytes for the tray. Teachers attach the batch with **Attach batch · N** (images on the rail plus a time-labeled folder chip whose mention is `@Captures/<YYYY-MM-DD_HHmmss>/` when allowed), then use Composer `/` (existing `dsh-client-ui-skill` + `dsh-tool-skill`) for grading intents. Sending remains a separate user action. This phase does not call `followup()` into the model and does not extend `SessionEventMap` for “connected”.

### Teacher interaction (this phase)

1. Open the right-sidebar **Document camera** tab from the + menu **Document camera** entry (connects when needed) or the composer status chip (when the tray is empty).
2. Align the page in the live viewfinder; use the overlay shutter (**Connect and preview** / **Take a photo**).
3. Stills land in the overlay **batch strip** (manual, CZUR hardgrab / turn detect); delete blurry shots.
4. The batch strip supports lightbox review; Host archives under the Session workspace `Captures/<YYYY-MM-DD_HHmmss>/` with **Show in files**. Click the **Attach batch · N** label to attach tray images to the rail, insert a folder chip with a teacher-facing time+count label (path mention remains `@Captures/<stamp>/`) when the editor allows it, and focus the composer; click the folder chip to open a still from that archive when the tray still has one, otherwise open Files and try to list the archive to open an image; the status dot reopens the camera (respects the per-message image cap).
5. Type `/`: on an empty query, `homework-grade` / `wrong-book` are boosted to the front (ASCII `name`, Chinese description/body); other installed skills remain available. There is no batch skill chip strip above the composer — same shape as the Harness `/` catalog.
6. The teacher sends the turn when ready—images become model-visible only then.

### Harness mindset applied here

| Habit | Application |
|---|---|
| Plugins, not loop changes | Scanner lives beside other plugins; `agent-loop` is untouched |
| Complete capability seam | Definition, providers, and consumers ship together |
| Model-visible means logged | Only captures that later enter a request need Session facts; link status and viewfinder frames do not |
| Compose with overlays | Enable via the experimental bundle patch, not `dsh-base` |
| Defer business workflows | Grading UI / LMS wait; demo grading skills load only through `/` |

### Phase boundary

- **This phase:** batch tray + Attach batch · N attach; demo skills on `/`; Host batch disk + `followStills`; CZUR `autoCapture` / hardgrab; docs. Default patch keeps Mock; CZUR via `cordis.czur.patch.yml`.
- **Later:** richer grading UI that consumes `attachmentId`; draft-from-`attachmentId` without re-upload.

## Alternatives considered

**Patch the agent loop for “scan mode”.** Rejected: loop changes raise the architecture surface for a hardware integration that belongs on a documented extension point.

**Scratch overlay only, outside `packages/`.** Rejected for this work: colleagues need in-repo packages, tests, and the same isolation rules as other experimental capabilities; a scratch tree would force a second migration.

**Record connection status as Session events.** Rejected: reconnect and hotplug are process-local; logging “connected” invents model-visible history the model never used and complicates replay.

**Browser UI talking directly to CZUR Runtime WebSockets.** Rejected: USB and the local Runtime belong on the Host; the Client consumes a typed Remote so provider swaps stay behind `ctx.docScanner`.

**Keep the live viewfinder and five labeled buttons inside `conversation.input.activity`.** Rejected after teacher-UX review: the activity slot is a single compact control (and contends with voice-input); classroom products put large preview in a dedicated pane. Composer keeps a `conversation.input.right` status chip (**Attach batch · N**); the + Add menu offers a one-shot **Document camera** entry; overlay connect / capture / batch strip live on `sidebar.right.pane.tab`.

**Put ask / skill chips inside the right camera pane.** Rejected: dialogue CTAs beside the hardware panel split attention from the composer. Capture stays in the side pane; business intents use Composer `/`.

**Keep a ready-status card or context skill chip strip above the composer.** Rejected: Harness `/` already lists skills without a chip strip; a scanner-owned strip duplicates that catalog and fights product consistency. **Attach batch · N** attaches; `/` loads skills.

**Clone Doubao’s always-on teacher skill shelf and in-composer skill catalog popup.** Rejected: DSH already loads skills via Composer `/` and `dsh-tool-skill`; courseware/lesson-plan shelves belong to a product Preset, not the capture seam.

**Prefer Doubao-style MCP tool scan as the first interaction.** Deferred: MCP fits agent-driven capture; classroom teachers need UI-driven preview and an explicit attach step before the model sees paper. A future optional tool provider can still wrap `ctx.docScanner`.

**Auto-`followup()` after every capture.** Rejected for this phase: teachers must control what enters the model request; privacy and review come before automation.

## Acceptance criteria

- Mock: connect opens or enables the live preview tab; frames stream while ready; capture appends the batch tray and optional `attachmentId` / `workspacePath`.
- No batch skill chip strip on `conversation.input.dock`.
- Composer chip shows **Attach batch · N** when N>0 and attaches on click; teachers use `/` for demo skills; never auto-send.
- CZUR hardgrab / turn detect feed `followStills` when `autoCapture` is on.
- CZUR row stays disabled without crashing the composition.
- Colleagues can learn why/how from the practice guide and this note.
- No agent-loop change; no SessionEvent for link state; no real grading/LMS appliance UI in this phase.

## Risks

- Experimental packages remain opt-in; forgetting `--patch` looks like a missing feature.
- Real CZUR needs a local SDK Runtime and credentials on the Host; Web-only deployments cannot drive USB.
- Attachment persistence depends on `ctx.attachments` being mounted; without it, capture still returns preview bytes for the UI.
- Adding to the draft re-uploads image bytes from the Client even when Host already saved via `attachments` (accepted until a draft-from-`attachmentId` API exists).
- Status chip uses the `conversation.input.right` list seat so it can coexist with voice-input’s activity occupant.
