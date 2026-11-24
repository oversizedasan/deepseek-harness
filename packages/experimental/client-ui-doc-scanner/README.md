---
description: "Document-scanner status chip, overlay viewfinder tab, and batch attach to the composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-doc-scanner

English | [中文](README.zh.md)

## Summary

Mounts the document-scanner Remote, registers a compact `conversation.input.right` status chip (**Attach batch · N** when the tray is non-empty: status dot opens the camera, label attaches images and inserts a clickable archive-folder `@` chip), a + menu **Document camera** entry under Add, and a right-sidebar **Document camera** tab with overlay shutter and batch strip. The tray supports lightbox preview and opening the archived path under the Session workspace; an empty `/` query boosts the demo skills. Grading uses Composer `/`; this package does not register a skill chip strip.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load through the [bundle](../doc-scanner-bundle/README.md). Capture in the right pane (overlay shutter; thumbnail lightbox; **Show in files** opens Session-workspace `Captures/...`); click the **Attach batch · N** label to attach images to the rail and insert `@Captures/<batchId>/` when the editor allows it (status dot reopens the camera), then type `/` (`homework-grade` / `wrong-book` lead an empty query, with Chinese secondary copy). Attach does not send until the teacher submits; batch size follows the Composer per-message image cap. If the folder chip cannot be inserted, the images remain and a light notice is shown. Clicking the folder chip opens a still from that archive when the tray still has one; otherwise it opens Files and tries to list the archive directory to open an image there. The chip shows a teacher-facing label such as **Batch scan · Today HH:MM (N)** while `ref` still points at `@Captures/<YYYY-MM-DD_HHmmss>/`. Re-attaching the same batch does not append already-attached stills or insert another folder chip; new tray stills still attach as an increment. After reload, a surviving `@Captures/<batchId>/` chip restores rail previews from the workspace archive when those files remain.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Practice guide](../../../docs/user/develop/practice/doc-scanner.md)
- [Demo skills package](../doc-scanner-skills/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None until the teacher sends a turn that includes the draft attachments.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- No real grading overlays or LMS workflow.
- Attaching the batch re-uploads Client-side bytes even if Host already stored an `attachmentId`.
