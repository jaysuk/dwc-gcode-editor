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

**2026-09-21 (v0.4.0): four of the scope table's remaining "Keep" gaps closed** — found by re-reading
this package's own five source modules directly against `gcode-editor-plan.md`'s scope table (not by
trusting this file's own prior "outstanding work" summary), as part of a Monaco-feature-parity plan
requested after `dwc-gcode-core` v1.4.0 shipped.

- **Comment toggling.** `defaultKeymap` (already in `editorCore.ts`'s `BASE_EDITING_EXTENSIONS`) binds
  `Mod-/` to `@codemirror/commands`' `toggleComment` — that binding was already live in every consumer,
  just permanently inert with nothing to comment with. `language.ts`'s `gcodeStreamParser` now declares
  `languageData: { commentTokens: { line: ";" } }`, so it actually inserts/removes `"; "`.
- **Auto-close brackets for `{expression}`.** New: `@codemirror/autocomplete`'s `closeBrackets()` +
  `closeBracketsKeymap`, added to `BASE_EDITING_EXTENSIONS`, scoped via the same `gcodeStreamParser`'s
  new `languageData: { closeBrackets: { brackets: ["{"] } }` — deliberately narrower than the
  extension's own default (`( [ { ' "`), since auto-closing a quote would fight typing a quoted
  filename argument (`M28 "file.g"`), never asked for. **Found and fixed a real ordering bug while
  building this, not just adding it**: `@codemirror/view`'s own `buildKeymap` source confirms keymap
  array order is try-order, first command returning `true` wins per key — `closeBracketsKeymap` must
  be listed *before* `defaultKeymap`, not after, or `defaultKeymap`'s unconditional Backspace
  (`deleteCharBackward`) permanently masks `closeBracketsKeymap`'s pair-delete (`deleteBracketPair`).
  The wrong order left every other test green (none exercised Backspace between an auto-closed pair)
  — caught only by deliberately adding a test for that exact case and teeth-checking it.
- **Word wrap, whitespace rendering.** New module `editingExtras.ts`: `gcodeLineWrapping`
  (`EditorView.lineWrapping`, re-exported) and `gcodeWhitespaceRendering()` (`highlightWhitespace()` +
  `highlightTrailingWhitespace()`, no config surface on either per the installed `@codemirror/view`'s
  own `.d.ts`). Both opt-in, not folded into `BASE_EDITING_EXTENSIONS` — unlike undo/redo or comment
  toggling, these change the document's default appearance, and Monaco itself ships both off by
  default (`wordWrap: "off"`, `renderWhitespace: "selection"`).
- **High-contrast theme.** `theme.ts`'s `ThemeController` gains `setHighContrast(view, enabled)`,
  orthogonal to the existing `setDark` (not a breaking three-way replacement — neither host needed a
  code change) — a hand-rolled pure-black/high-saturation `HighlightStyle` + `EditorView.theme()`, the
  "basic" bar the scope table asks for (one mode, matching Monaco's most-used `hc-black`, not a
  light+dark high-contrast pair).
- **Indent guides deliberately NOT done here** — no official `@codemirror/*` package (only the ones
  already installed) ships a visual indent-guide renderer; the community options would be a new,
  unverified dependency. Left as its own open item rather than silently skipped or rushed.

Still outstanding (unchanged by this release): the windowed read-only mode for huge view-only files
(Rule 5), stop point 4 (split-view inside a Flexible-Layouts widget tile — unhit, `GcodeCmEditor.vue`
is still single-pane), and a real in-browser click-through (blocked on tooling, not on anything left to
build). Neither host has bumped its `dwc-gcode-editor` pin past v0.3.0 yet.

**2026-09-17: v0.3.0's theme sync and completion wired into BOTH hosts, the same day** —
`duet-gcode-postprocessor` (`GcodeEditor.vue`, commit `b6483a3`) and `Flexible-Layouts`
(`GcodeCmEditor.vue`, commit `1118c20`) both now read the host's own `useSettingsStore().darkTheme`,
create one `ThemeController` per live instance, and have `gcodeCompletion()` in their
`editorExtensions()`. Real teeth in both: `getComputedStyle(...).backgroundColor` read back on the
actual `.cm-editor` DOM node before/after a live toggle (needs `document.body.appendChild(wrapper
.element)` first — `mountInDwc` doesn't attach by default). Found in `Flexible-Layouts`' own test: a
plain `view.dispatch()` does NOT trigger `@codemirror/autocomplete`'s automatic popup (no "typed
input" annotation) — use `startCompletion(view)` directly, the same command `completionKeymap`'s own
Ctrl-Space binding calls. **Still not clicked through live in a real browser** — no Playwright/
browser tool available in either session so far; only verified via real `EditorView`/mounted-component
instances and computed styles under `happy-dom`. See `[[dwc-gcode-editor]]`'s memory entry for the
full detail if this file is ever out of sync with it again.

**2026-09-17 (v0.3.0, initial ship): theme sync and dictionary-driven completion added to the
package itself**, the two items deferred from the feature-parity gap analysis. `theme.ts` —
`createThemeController(initialDark)` wraps a `Compartment` so a host can flip light/dark live (e.g.
off DWC's `settingsStore.darkTheme`) without recreating the view or losing undo history; dark mode is
`@codemirror/theme-one-dark`'s own official theme, checked against a real gap (its highlight style
has no direct rule for `language.ts`'s `controlKeyword`/`definitionKeyword`/`lineComment` sub-tags)
and confirmed via a real `EditorView`'s computed color, not assumption, that CM6's own tag-fallback
resolves them to the parent rule regardless. `completion.ts` —
`gcodeCompletion()`/`createGcodeCompletionSource()` turn `dwc-gcode-core`'s real 280-entry command
dictionary into command-code and (once a known command is on the line) parameter-letter completions,
positioned entirely off `lexLine`'s own structural output (empirically confirmed to tolerantly lex an
in-progress bare letter as a valueless param, and to extend a command's own `end` through such a
letter or trailing whitespace) — no separate boundary-finding logic, and safe to run on every
keystroke since it only ever lexes the current line, never the whole document. Deliberately does NOT
complete axis letters (`X`/`Y`/`Z`/...) beyond what a command's own `parameters` array lists — the
real allowed-axis-letter set is a private, unexported constant in `dwc-gcode-core`, and duplicating
it by hand would be exactly the "never invent a rule" mistake this family avoids elsewhere. 94 tests
(was 80).

**Outstanding for this package specifically**: the windowed read-only mode for huge view-only files
(Rule 5, never started) and a real, in-browser click-through of the demo/both hosts (blocked purely
on tooling access, not on anything left to build). `dwc-gcode-core`'s v1.3.1 scientific-notation fix
(2026-09-17) needed no change here — this package never re-implements dictionary-shape validation,
it only calls `diagnoseDocument`/`commandSpec` directly, so the fix reached it for free once a host
bumped its `dwc-gcode-core` pin.

**2026-09-17 (v0.2.0): `editorCore.ts` now always includes CM6's undo/redo history and default
editing keymap.** CM6 ships neither by default (unlike Monaco, which has both built in) — this was
found missing from every consumer built so far (`duet-gcode-postprocessor`'s `GcodeEditor.vue`,
`Flexible-Layouts`' `GcodeCmEditor.vue`, this package's own demo), meaning Ctrl+Z silently did
nothing anywhere. Fixed once, at the root, via a new `BASE_EDITING_EXTENSIONS` constant
(`history()` + `keymap.of([...defaultKeymap, ...historyKeymap])`) always prepended in
`createEditorInstance`, so every current and future consumer gets it for free. Also added
`saveKeymap(onSave)`, a `Mod-s` binding matching Monaco's own Ctrl+S behaviour, for hosts to wire up
real save-on-keypress instead of a toolbar-button-only save. 66 tests (was 62), verified with real
teeth (sabotaged `BASE_EDITING_EXTENSIONS` to `[]`, confirmed the new undo/Backspace tests fail,
then restored). Downstream: `duet-gcode-postprocessor` and `Flexible-Layouts` still need their
`dwc-gcode-editor` dependency bumped to pick this up; `Flexible-Layouts`' `GcodeCmEditor.vue` also
still needs `saveKeymap` wired in for real Ctrl+S support.

**2026-09-16: the plan's sequencing step 2 (the package's core) is done, plus a working demo.**
Five modules, 62 tests, all three gates green, CI confirmed on a clean runner after every push:
`workspace.ts` (tabs/split panes, ported from `ExplorerPanel.vue` + DWC core PR #517),
`diagnostics.ts` (`dwc-gcode-core` → `@codemirror/lint`), `language.ts` (`lexLine`-driven syntax
highlighting), `docBuilder.ts` (chunked `Text` construction — found and fixed a real bug along the
way, see Rule 4), `editorCore.ts` (the `flush()` contract). `demo/` (`npm run dev`) wires all five
together into something actually clickable — verified end to end with a real 200 MB file through
the real file picker, tabs, split view, live dirty tracking, and the "Check for errors" button, zero
console errors. Not yet done: the windowed read-only mode for huge view-only files (Rule 5), and
wiring this package into either real host (`duet-gcode-postprocessor`, `Flexible-Layouts` — plan's
sequencing steps 3–4).

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
4. **`Text.append()` inserts NO separator between the two texts it joins** — verified empirically
   (`docBuilder.ts`'s own doc comment): `Text.of(["a","b"]).append(Text.of(["c","d"]))` is
   `"a\nbc\nd"`, fusing `b` and `c`. Any code that builds a `Text` incrementally across more than one
   `Text.of()` call (as `docBuilder.ts` does for a chunked file read) must bridge that seam itself —
   caught this exact way once already (a "flush early vs. flush once" test that only failed on a
   large fixture), so treat a new incremental-build path with the same suspicion.
5. **A genuinely huge file opened to view/diagnose should not always cost a full CM6 `Text` build.**
   The plan's stop-point 2 refinement — a truly windowed read-only mode paging from the source `Blob`
   — is real scope for this package, not an afterthought; do not let "CM6 handles it" excuse skipping
   this for the largest files.

## Commands

- `npm run typecheck` — the library and its tests. `demo/` is deliberately NOT included (it's a dev
  harness, not part of the published package) — sanity-check it by hand with
  `npx tsc --noEmit --strict --target ES2021 --module ESNext --moduleResolution Bundler --lib ES2021,DOM,DOM.Iterable demo/main.ts`
  if it changes.
- `npm test` — vitest, `happy-dom` environment (unlike `dwc-gcode-core`'s plain `node` environment —
  this package's own tests mount real CM6 `EditorView` instances).
- `npm run build` — `tsc` to `dist/`.
- `npm run dev` — the interactive demo (`demo/`), served by Vite directly against `src/` (no build
  step first). Wires every module together: workspace tabs/split panes, a real CM6 editor per tab
  with highlighting + diagnostics, a "Check for errors" button, and a real file picker (exercises
  `docBuilder.ts`'s chunked read against an actual `File`, not just synthetic text). Not part of the
  published package.

## Releasing

Bump `package.json`, commit, `git tag vX.Y.Z && git push origin vX.Y.Z` — the release workflow tests,
then publishes a GitHub Release with the shared changelog. `npm publish` is manual.
