# Document scanner (experimental)

English | [中文](doc-scanner.zh.md)

This guide shows how to run the Mock document-scanner demo with a batch tray: capture, attach to the draft, then ask through Composer **`/`** skills; and where CZUR hardgrab stills land. Complete the [basic plugin path](../basic/index.md) and the [three-role capability tutorial](index.md) first if the seam pattern is new.

## Why this shape

Classroom capture needs a document camera without forking the agent loop or burying CZUR WebSockets in Chat UI. The experimental stack follows voice input: Service Definition, replaceable providers, Host Remote, Client UI, and an explicit bundle patch. Connection status is live process state; viewfinder frames use a separate `preview` stream; only stills that later enter a request become durable Session history through attachments. Grading and similar work use the existing Composer `/` skill path — no dedicated chip strip (same shape as the `/` catalog). Decision rationale: [Agent Note](../../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.md). Extension-point map: [architecture](../../../architecture.md#where-new-behavior-goes).

This is **not** a grading appliance. Doubao teacher skills and CZUR AI homework products add subject, layout, and scoring after capture; DSH keeps grading on `/` skills and later consumers of `attachmentId`.

## Package topology

```text
client-ui-doc-scanner  --Typert-->  api-doc-scanner  -->  doc-scanner
     | chip + menu + right tab                           ^
                                              doc-scanner-mock (demo)
                                              doc-scanner-czur (Command + Video WS)
doc-scanner-skills  -->  ctx.skills  (Composer / catalog)
```

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-doc-scanner` | `ctx.docScanner` |
| `@deepseek-ai/dsh-doc-scanner-mock` | Mock provider + preview frames |
| `@deepseek-ai/dsh-doc-scanner-czur` | CZUR Command WS + Video WS provider |
| `@deepseek-ai/dsh-doc-scanner-skills` | Demo skills `homework-grade` / `wrong-book` (`/` only) |
| `@deepseek-ai/dsh-api-doc-scanner` | Remote `docScanner.*` including `preview` and `followStills` |
| `@deepseek-ai/dsh-client-ui-doc-scanner` | Status chip, + menu entry, live preview tab, batch tray and attach |
| `@deepseek-ai/dsh-doc-scanner-bundle` | `--patch` composition |

## Run the Mock demo

```sh
pnpm install
pnpm run build:artifacts
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.patch.yml
```

Teacher path in the Web UI (three layers: **batch album → attachment rail → `/` intent**):

1. Open **Document camera** from the + menu (Add section) or click the composer status chip — the right sidebar tab opens; connect runs when needed. Status copy names the camera (for example **Document camera connected**).
2. Align the page in the live viewfinder (Mock shows a looping demo frame). Use the overlay **Connect and preview** / **Take a photo** shutter on the image; disconnect sits in the corner.
3. Stills land in the overlay **batch strip**; click a thumbnail for a lightbox, and when the batch has more than one still, switch with the side arrows or the arrow keys; delete blurry shots. Host also archives under the **current Session workspace** `Captures/<batchId>/`; **Show in files** opens the latest still.
4. The composer chip shows **Attach batch · N**: click the label to attach the batch images silently onto the attachment rail, insert a folder chip when the editor allows it (teacher-facing label like **Batch scan · Today HH:MM (N)**; archive path `Captures/<YYYY-MM-DD_HHmmss>/`), and focus the input; click the status dot to reopen the document camera (per-message cap matches Composer, default 20). Re-attaching the same batch does not append already-attached stills or insert another folder chip; newly captured stills in the tray still attach as an increment. The rail still supports original-image lightbox; click the folder chip to open a still from that archive when the tray still has one, otherwise open Files and try to list the archive to open an image there. After a page reload, browser-owned draft attachments are gone; when the draft still holds `@Captures/<batchId>/` and the workspace archive remains, the rail previews are restored from disk, and open failures surface an explicit notice.
5. Type `/` in the composer: on an empty query, demo skills **`homework-grade`** / **`wrong-book`** appear first (ASCII `name` on the primary row, Chinese secondary copy); or type `/name`. Edit if needed, then **send** — images become model-visible only then. Nothing auto-sends; there is **no** batch skill chip strip above the composer.

## Connection phases

| Phase | Meaning (UI copy names the document camera) |
|---|---|
| `disconnected` | No active device |
| `connecting` / `opening` | In progress |
| `device_missing` | Runtime reachable but no device (hardware providers) |
| `ready` | Capture and preview allowed |
| `capturing` | Capture in flight |
| `error` | Recoverable failure with detail |

Do not record these phases as Session events. Preview frames are not Session events either.

## Phase 2: CZUR (hardware)

`@deepseek-ai/dsh-doc-scanner-czur` implements Command WS capture and Video WS → `preview()` ([checklist](../../../../packages/experimental/doc-scanner-czur/README.md#phase-2-checklist)). Official flow: `auth.create_session` → `device.list` → `device.open` → `capture.take` ([CZUR Open Platform](https://open.czur.com/docs/reference/sdk-open/)).

This section owns the hardware setup; the package READMEs link here. Before starting, check:

1. A CZUR SDK Runtime listens on `wss://sdk-runtime.localhost:18090`, the default `commandWsUrl`. Its certificate is self-signed, so the bundled patches set `allowInsecureTls: true`; the provider default is `false`.
2. `CZUR_API_KEY` is configured in the credentials store, the launching shell, or the root `.env` file. Never commit it.
3. `pnpm run build:artifacts` has run since the last pull; a stale build fails when the plugin loads.
4. The document camera is connected by USB.

```sh
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.czur.patch.yml
```

| Symptom | Cause |
|---|---|
| Error `CZUR API token is not configured (set credentialRef or CZUR_API_KEY)` | `CZUR_API_KEY` is missing or empty |
| `device_missing`, `No CZUR device is connected` | The Runtime answers but reports no device |
| `error` with a connection failure | Nothing listens on `commandWsUrl`; start the Runtime or change `commandWsUrl` in the patch |

Acceptance: connect reaches `ready` (`device_missing` without USB), preview shows live frames, capture / hardgrab fills the batch tray (with `batchId`, Host archives under `Captures/<batchId>/`), close returns to `disconnected`. Default `autoCapture` enables turn detect. Credentials live in the Config / credentials seam.

## Do not

- Change `agent-loop` for scanner mode.
- Record “connected” or viewfinder frames as Session events.
- Connect the browser directly to CZUR Runtime WebSockets.
- Expect in-package grading overlays or LMS export.
- Put continuous-capture controls in the + menu — it is discovery only.
- Add a batch skill chip strip above the composer (duplicates the `/` catalog).

## Related

- [Bundle DETAIL](../../../../packages/experimental/doc-scanner-bundle/docs/DETAIL.md)
- [Experimental map](../../../../packages/experimental/README.md)
