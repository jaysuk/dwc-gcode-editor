# dwc-gcode-editor — working notes

A CodeMirror-6-based G-code editor core for the DWC plugin family, replacing Monaco for the plugins
that need it. Framework-free in the sense that matters here — **no Vue, Vuetify, or DWC-plugin-API
imports** — but unlike `dwc-gcode-core` it legitimately touches the DOM (CM6's `EditorView` renders
into one), so `tsconfig.json`'s `lib` includes `DOM`, deliberately unlike that sibling package's
`lib: ["ES2021"]`-only restriction. Consumed by thin Vue wrapper components in
`duet-gcode-postprocessor` and `Flexible-Layouts` — same relationship those two repos already have
with `dwc-gcode-core`.

**Read `duet-gcode-postprocessor/docs/gcode-editor-plan.md` first** — the plan this package
implements: why Monaco is being replaced (its whole-file-in-memory model, measured ~3.8 MB bundle
cost, no plugin extension point), the agreed feature scope (keep/skip table), the architecture
decisions, and the stop points already resolved with real measurements (CM6 confirmed viable at a
real 200 MB/5.8M-line fixture — constant-time interaction regardless of size, 94 KB gzipped, but
~2.8× the file's raw size in resident memory once fully loaded — see that document's own stop-point
2 for the numbers and what they mean for this package's viewport design).

## Status

**2026-09-16: repo scaffolded, nothing built yet.** `package.json`/`tsconfig.json`/
`tsconfig.test.json`/`vitest.config.ts`/CI workflows are in place, mirroring `dwc-gcode-core`'s own
conventions where they still apply. Depends on `dwc-gcode-core` (real dictionary/tokeniser/
diagnostics) and CM6's `state`/`view`/`language`/`commands`/`autocomplete`/`lint` packages.

## What this package owns vs. what a host owns

- **This package**: the virtualised viewport/large-file handling, `dwc-gcode-core`-driven syntax
  highlighting and diagnostics-to-marker mapping, a completion source built on `dwc-gcode-core`'s
  dictionary, the workspace-shell *data model* (tabs/groups — ported from
  `Flexible-Layouts/src/widgets/ExplorerPanel.vue` and DWC core PR #517's two-pane extension, kept as
  plain state here so each host renders it with its own `v-tabs`/`v-window` or equivalent), and a
  `flush()` contract every host must call before unmounting/hiding an instance (the exact gap PR
  #517's own implementation notes flagged Monaco as missing).
- **A host** (`duet-gcode-postprocessor`, `Flexible-Layouts`): DOM mounting, keyboard/mouse/IME event
  wiring beyond what CM6 gives for free, the actual tab-strip/split-pane chrome, and G-code-native
  panels wired to plugin-specific state (e.g. `duet-gcode-postprocessor`'s `state.ts`/`analysis.ts`
  feeding a per-line position/step gutter — this package has no opinion on what that gutter shows).

## Rules

1. **Every fact this package states about `dwc-gcode-core`'s own shape (dictionary format,
   diagnostic shape, tokeniser output) is read from that package's real, current source — never
   assumed from memory of an earlier version.** Bump `dwc-gcode-core`'s dependency deliberately, not
   incidentally.
2. **A claim about CM6's own behaviour needs the same discipline this family applies to RRF facts**:
   verify against the installed package's real source/types, or a real, reproducible measurement —
   not general knowledge of the library. The plan doc's stop-point 2 write-up is the model: a real
   200 MB fixture, real Playwright-measured numbers, the `Text` rope structure confirmed against
   `@codemirror/state`'s own compiled source before relying on it.
3. **Every test has teeth**: break the behaviour and watch it fail before trusting it.
4. **A genuinely huge file opened to view/diagnose should not always cost a full CM6 `Text` build.**
   The plan's stop-point 2 refinement — a truly windowed read-only mode paging from the source `Blob`
   — is real scope for this package, not an afterthought; do not let "CM6 handles it" excuse skipping
   this for the largest files.

## Commands

- `npm run typecheck` — the library and its tests.
- `npm test` — vitest, `happy-dom` environment (unlike `dwc-gcode-core`'s plain `node` environment —
  this package's own tests mount real CM6 `EditorView` instances).
- `npm run build` — `tsc` to `dist/`.

## Releasing

Bump `package.json`, commit, `git tag vX.Y.Z && git push origin vX.Y.Z` — the release workflow tests,
then publishes a GitHub Release with the shared changelog. `npm publish` is manual.
