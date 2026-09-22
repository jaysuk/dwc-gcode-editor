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

**2026-09-22 (v0.8.0): `currentLine.ts` — a shared "you are here" line-highlight primitive**, the first
piece of the offline file-stepper feature (`duet-gcode-postprocessor`'s own `docs/gcode-editor-plan.md`
scope-table row: "Scrub bar / step-through tied to machine state | Build — new, offline first").
`gcodeCurrentLine()` installs a `StateField`-backed `Decoration.line` highlight (invisible until first
used); `setCurrentLine(view, line, {scroll?})` highlights a 1-based line and, by default, scrolls it
centered into view. Clamps an out-of-range line rather than throwing (a host's own line-number source —
e.g. a scrub bar bound to a stale document length — can legitimately be momentarily out of range around
an edit or reload). The highlight is mapped through unrelated document edits (`deco.map(tr.changes)`)
so it stays on the same physical line's own text, not a fixed line NUMBER, if the user edits elsewhere
while stepping — the same behaviour a real debugger's breakpoint highlight has. 176 tests (was 169),
real teeth on both the clamping and the change-mapping behaviour (both confirmed to fail when stubbed).
One test's own fixture was wrong, not the code: a doc built with a trailing `\n` has an extra, empty
final `Text` line after it (verified directly, not assumed) — a "last line" test using `"G28\nG1
X10\n"` was actually testing the empty line after it, not `G1 X10`; fixed by dropping the trailing
newline in that one fixture rather than changing the clamp logic to compensate for a self-inflicted
off-by-one. The next piece is the actual state-tracking extension (`duet-gcode-postprocessor`'s
`state.ts` gaining X/Y/E position, already started this session) and the stepper UI itself, both host-
level — this package only ever gives a host the primitive to highlight/scroll to a line, never opinions
about what drives it.

**2026-09-22 (v0.7.0): user-customisable syntax colors + background, persisted to a shared SD-card
file.** User ask: "make sure that each part of the colouring of gcodes offered by the editor can be
changed, along with the background... stored on the SD card... site wide."

- **`customTheme.ts` (new)**: `GcodeColorScheme` — 10 independently-settable colors (`background`,
  `foreground`, `keyword`, `controlKeyword`, `definitionKeyword`, `propertyName`, `number`, `string`,
  `atom`, `comment` — the last folds `language.ts`'s two comment tags, `comment`/`lineComment`, into
  one user-facing color, since a user thinks "comment", not "CNC-bracket-comment vs. semicolon-comment").
  `gcodeCustomTheme(colors)` builds the `HighlightStyle`/`EditorView.theme` pair from it, with a
  luminance-based best-effort `dark` hint for CM6's own ambient behaviour. `isGcodeColorScheme` is a
  runtime shape guard (all 10 keys present as strings) for validating an untrusted SD-card file.
  `DEFAULT_LIGHT_COLOR_SCHEME`/`DEFAULT_DARK_COLOR_SCHEME` are independent, freshly-chosen defaults —
  deliberately NOT required to pixel-match `theme.ts`'s existing fixed `defaultHighlightStyle`/
  `oneDark` palettes, which stay exactly as they are for anyone who never opens the settings dialog.
- **`colorSchemeStorage.ts` (new)**: `GCODE_EDITOR_COLORS_SD_PATH = "0:/sys/dwc-gcode-editor.colors.json"`
  — one fixed path both hosts read/write, chosen over DWC's own `useSettingsStore().registerPluginData`
  (real source checked first: that rides inside `0:/sys/dwc-settings.json`, per-plugin-scoped, and only
  reaches the SD card when the user's own `settingsStorageLocal` toggle is off) in favour of
  `Flexible-Layouts`' own already-proven direct-file pattern (`src/model/sdBackup.ts`) — genuinely
  site-wide and guaranteed-SD regardless of that toggle. `parseColorSchemeFile`/`serializeColorSchemeFile`
  round-trip a self-tagged (`kind`/`schemaVersion`) file; parsing returns `null` (not a thrown error)
  for anything not recognisably this package's own file, so a host falls back to
  `DEFAULT_COLOR_SCHEME_FILE` rather than propagate a parse failure for a file a user could have
  hand-edited badly. This module has NO `machineStore` import — the actual SD read/write I/O is each
  host's own job, done consistently because both call the same parse/serialize functions.
- **`theme.ts`**: `ThemeController` gains `setCustomColors(view, {light, dark} | null)`, orthogonal to
  `setDark`/`setHighContrast` (neither existing method's behaviour changes) — a custom scheme still
  respects the existing dark/light toggle (switches between the user's own two palettes exactly as
  `setDark` already switches the fixed ones), and `setHighContrast` wins when both are active (checked
  first in `current()`) — a user who explicitly turns on the accessibility mode wants its guaranteed
  contrast regardless of what custom colors happen to be saved, not a possibly-poor-contrast custom one.
- 169 tests (was 148). Real teeth specifically on the precedence logic (`setHighContrast` before
  `setCustomColors` before the fixed `setDark` palette — reverting the check order broke 5 tests at
  once, confirming the ordering is actually load-bearing) and on `parseColorSchemeFile`'s validation
  (skipping it broke exactly the malformed-input tests, not the valid ones). One test-writing lesson
  repeated from earlier sessions: happy-dom's `getComputedStyle` reports colors in their original
  `#rrggbb` form, not normalised to `rgb(...)` — caught immediately by running the tests, not assumed.
- **Not yet wired into either host** — no toolbar settings icon, no settings dialog UI, no SD read/write
  call, in either `duet-gcode-postprocessor` or `Flexible-Layouts` yet. Real, separate follow-up: each
  host needs a shared, reactive, module-level "current color scheme" (loaded once, read by every open
  editor instance's `editorExtensions()`) so saving from any one tab's settings dialog updates every
  other open tab live — the same live-external-data-via-closure pattern `duet-gcode-postprocessor`'s
  own `lineStateGutter(() => lineIndex)` already established, applied to this new use.

**2026-09-22 (v0.6.0): the F4 code/expression quick-picker — the actual `mdi-tag-search` feature
deferred from v0.5.0.** Two new modules, package-level only (not yet wired into either host).

- **`quickSearchData.ts`**: pure, host-agnostic data functions. `isInsideExpression` and
  `flattenObjectModel` are ported faithfully from `@duet3d/monacotokens`'s real `providers.ts` (read
  its actual compiled source, not guessed) — `flattenObjectModel` was already generic over `unknown`
  there, which is exactly why this package can use it without taking on a machine-object-model
  dependency: a host passes its own live model in as plain `unknown`, flattened into dotted paths
  (`[0]` for every array's one representative element). `gcodeQuickSearchEntries` uses
  `dwc-gcode-core`'s own dictionary (`COMMANDS`), not `@duet3d/monacotokens`'s separate `gcodeData`
  table. `localVariableNames` scans the current document for `var`/`global` declarations using
  `lexLine`'s own `meta` field to confirm a real RRF declaration (case-sensitive, properly terminated)
  before extracting the name — deliberately on-demand (scanned once when the picker opens), not
  monacotokens' own continuously-debounced background scanner, matching this package's established
  "no background cost for a manual action" rule (`diagnostics.ts`'s own reasoning).
- **`quickSearch.ts`**: the UI, built on CM6's `Panel` mechanism (the same primitive `search.ts`'s
  `gcodeSearch()` already wraps via `@codemirror/search`) rather than a hand-rolled cursor-anchored
  overlay matching Monaco's own DOM widget pixel-for-pixel. **Deliberate UX deviation**: a `Panel`
  docks to the top of the editor, not floating near the caret — chosen because `Panel` is this
  package's real, already-shipped mechanism for "text field drives a live-filtered, keyboard-navigable
  list, dismiss on accept/Escape", and a cursor-anchored overlay would need a second, bespoke
  positioning system this package doesn't otherwise have. `gcodeQuickSearchKeymap(getObjectModel?)`
  binds `F4` and switches modes off `isInsideExpression`, exactly like `@duet3d/monacotokens`'s own
  `addGcodeSearchAction`. `getObjectModel` is a thunk (`() => unknown`), not a static value, so a host
  can supply an always-current live machine model without reconfiguring the extension every time it
  changes — the same live-data-via-closure pattern `duet-gcode-postprocessor`'s own
  `lineStateGutter(() => lineIndex)` already uses. `openGcodeQuickSearch`/`openExpressionQuickSearch`
  are also exported standalone (e.g. for a toolbar button) and self-install their own `StateField` on
  first use via `StateEffect.appendConfig` if `gcodeQuickSearchKeymap()` was never included — the same
  lazy-enable mechanism `@codemirror/search`'s own `openSearchPanel` uses, verified by reading its real
  compiled source (`searchState`'s `provide: f => showPanel.from(f, val => val.panel)`) before copying
  the pattern rather than assuming it.
- 148 tests (was 112), several real teeth checks on the CM6-mechanism-sensitive pieces specifically
  (the F4 mode-switch branch, and `accept()`'s selection-replace behaviour — both confirmed to fail
  when stubbed, not just trusted). One test's own first-draft assertion was wrong, not the
  implementation: `flattenObjectModel` correctly does NOT emit an `[0]` sub-path for a primitive array
  element (`tools[0].active[0]` when `active: [200]`) — only object-valued children ever get a path of
  their own, matching the real monacotokens algorithm exactly; caught by running the test and reading
  the real diff rather than trusting the hand-written expectation.
- **Not yet wired into either host** — `duet-gcode-postprocessor`'s `GcodeEditor.vue` and
  `Flexible-Layouts`' `GcodeCmEditor.vue` still only have v0.5.0's Search/Docs-link/Align-comments/
  Revert(/Run). Wiring this in needs a live object-model source per host (`machineStore.model`) passed
  through `gcodeQuickSearchKeymap`'s `getObjectModel` thunk — real, small, separate follow-up work.

**2026-09-22 (v0.5.0): three of MonacoEditor.vue's five missing toolbar actions closed at the package
level — search, docs-link lookup, and indent-comments alignment.** Triggered by the user asking
directly "does the editor now have all icons DWC Monaco has? search, run file etc" — read
`MonacoEditor.vue`'s real toolbar (`src/components/editor/MonacoEditor.vue`) end to end rather than
assuming, which surfaced that its `mdi-tag-search` button is NOT plain find/replace at all: it's an F4
cursor-anchored quick-picker (`@duet3d/monacotokens`'s `duet.searchGcode`/`showGcodeSearch`/
`showObjectModelSearch`) that lists G/M-codes, or, inside a `{expression}`, the live object model
flattened into searchable paths. That overlay is real, separate, larger scope — deferred for the same
reason `completion.ts` already defers object-model-aware axis completion (it needs live machine
object-model data this package has never consumed) — and NOT what shipped here.

- **`search.ts` (new): `gcodeSearch()`.** Plain Ctrl+F find/replace, genuinely missing before this
  (no `@codemirror/search` dependency existed at all) and arguably table-stakes on its own regardless
  of the F4 feature. Wraps `@codemirror/search`'s own `search()` extension + `searchKeymap`
  (`Mod-f`/`F3`/`Mod-g`/etc.), re-exports `openSearchPanel` so a host's toolbar button is a single
  import, matching `saveKeymap`'s own precedent. Opt-in, not in `BASE_EDITING_EXTENSIONS`.
- **`editorActions.ts` (new): `codeAtCursor(view, pos?)` and `alignLineComments(view)`.**
  `codeAtCursor` is the same `lexLine`-based command lookup `completion.ts`'s private `commandAt`
  already does, exported standalone for a host's docs-link button (mirrors `MonacoEditor.vue`'s own
  `cursorCode` — this package deliberately does NOT hardcode a docs URL, a host builds that itself,
  the same split Monaco's own component has between `cursorCode` and `gcodeReferenceUrl`).
  `alignLineComments` ports DWC's own real `utils/display.ts` `indent()` algorithm faithfully (read
  its actual source, not guessed) but rebuilt on `lexLine`'s already-correct, quote/`{}`-aware comment
  detection instead of reimplementing that scanning by hand, and dispatches only the per-line changes
  that actually move (one undo step) rather than DWC's own whole-file string rebuild — which, as a
  documented, deliberate deviation, also silently trims the file's leading/trailing blank lines as a
  side effect of its construction method; that accidental behaviour is NOT reproduced here.
- **Revert and Run were scoped but deliberately NOT added at this package level** — both are pure
  host-level concerns (snapshot-and-restore for Revert; `machineStore.sendCode`/`M98` for Run) with no
  reusable CM6-native primitive this package should own. Run additionally needed a real decision before
  any implementation: `duet-gcode-postprocessor`'s own docs state it "deliberately has no sendCode
  today" as a safety boundary — user confirmed (2026-09-22) Run ships in `Flexible-Layouts` only,
  respecting that boundary rather than relitigating it.
- 112 tests (was 97), all three gates green, several real teeth checks this round (a search test
  first tried faking a DOM `input` event on the panel's own field — didn't work reliably; switched to
  the documented `setSearchQuery`/`SearchQuery` state-effect API instead, the same "don't fight CM6's
  DOM with synthetic events, use the real programmatic API" lesson `completion.ts`'s own
  `startCompletion` gotcha already taught). `alignLineComments`' padding math was hand-computed first
  and wrong twice (off-by-one on spaces; and two of its own test fixtures turned out to already be
  aligned, so the first call was a legitimate no-op, not a bug) — both caught by actually running the
  tests and correcting against real output rather than trusting the arithmetic.

Still outstanding toward full Monaco toolbar parity: the F4 code/expression quick-search overlay
(the actual `mdi-tag-search` feature, separate from plain find/replace), and Run/Revert at the host
level (next).

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
**2026-09-21 (v0.4.1): indent guides added — the last of the four remaining scope-table items,
hand-rolled rather than skipped.** No official `@codemirror/*` package (only the ones already
installed) ships a visual indent-guide renderer, and a community package would be a new, unverified
dependency this family's own discipline argues against — so `editingExtras.ts` gained
`gcodeIndentGuides()`, a small `ViewPlugin` built entirely from already-installed primitives
(`@codemirror/state`'s `RangeSetBuilder`, `@codemirror/view`'s `Decoration`/`ViewPlugin`,
`@codemirror/language`'s `getIndentUnit`). Marks the first character of every `getIndentUnit(state)`-
wide run of LEADING whitespace with a `border-left`-styled span, skipping blank lines and the line's
own deepest level (a depth-1 line gets zero guides — nothing to mark as an ancestor boundary). Column
counting treats every leading space/tab as one column (not real tab-width-aware), a deliberate
simplification since G-code macros are conventionally space-indented. 5 new tests, all mounted against
a real `EditorView` and read back from the live DOM (`.cm-gcodeIndentGuide` element count), not
assumed — including one that caught the loop's actual boundary behaviour was "N-1 guides for an
N-level indent, skipping column 0 and the deepest level" rather than the "one guide per level"
first guess. Teeth-checked (core loop stubbed to a no-op, both depth-dependent tests failed, restored).

Still outstanding: the windowed read-only mode for huge view-only files (Rule 5), stop point 4
(split-view inside a Flexible-Layouts widget tile — unhit, `GcodeCmEditor.vue` is still single-pane),
and a real in-browser click-through (blocked on tooling, not on anything left to build). Neither host
has bumped its `dwc-gcode-editor` pin past v0.3.0 yet.

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
