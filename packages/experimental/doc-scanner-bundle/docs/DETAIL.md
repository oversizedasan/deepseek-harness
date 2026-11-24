# Document scanner

Experimental Host and Web composition for a document camera: connect status, live viewfinder in the right sidebar, still capture (batch lightbox / `Captures` archive), and an explicit **Batch N** attach onto the composer attachment rail. Demo grading skills load through Composer `/` (`doc-scanner-skills`; boosted on empty query). Vendor protocols stay behind `ctx.docScanner`.

## Enable

```sh
pnpm dsh web --patch packages/experimental/doc-scanner-bundle/cordis.patch.yml
```

The Mock provider is on; the CZUR row stays `disabled: true` so keyless demos do not need a Runtime.

## Hardware CZUR

Use `cordis.czur.patch.yml` (Mock off, CZUR on) after the checks in the [practice guide](../../../../docs/user/develop/practice/doc-scanner.md#phase-2-czur-hardware). See also the [Agent Note](../../../../.agents/notes/proposed/feature/2026-11-18-doc-scanner-capability.md).
