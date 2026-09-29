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

**2026-09-29 (v0.13.0, RELEASED: tagged, pushed, on npm): two files side by side, and the review of Duet3D/DuetWebControl#517 applied to our own code.**
The maintainer (chrishamm) sent #517 back: every pane transition moved a `v-window-item` between two `v-window` parents, Vue cannot
re-parent a component, so the editor unmounted and remounted (model disposed, file re-downloaded, unsaved edits gone; none of it checked
`dirty`), the URL carried no pane (Back resolved the ordinal in the wrong pane), and it was too big for 3.7's rc phase. Checked against
the PR diff (`v-for group` outside, `v-window` per group, `collapseEmptyGroup` renaming group ids): all accurate. **The same flaw was in
our own `duet-gcode-postprocessor/GcodeWorkspace.vue`** (a per-pane `v-for`), and FL's `ExplorerPanel` had no split at all.

- **`workspace.ts`**: new `collapseEmptyGroup(state)` (a pane with no tabs goes away; only `groupId` changes, never a tab id - hosts
  call it after `moveTab`/`closeTab`, which deliberately still leave an empty pane alone, an existing test pins that). The file's header
  now states the **rendering rule: draw tabs as ONE flat list keyed by `tab.id`, in a fixed (id) order, and place each in its pane with a
  CSS grid column** - never as children of a per-pane element. A keyed `v-for` follows the order it is given by MOVING DOM nodes, and
  measured in real Chrome a removed-and-reinserted node loses `scrollTop` (777 -> 0) while a `grid-column` change keeps node and scroll,
  hence the id sort (`moveTab` reorders `tabs`). 358 tests (was 354), teeth-checked.
- **Hosts (committed and pushed to `main`, pinned `#v0.13.0`, no host tags by instruction)**: `duet-gcode-postprocessor` `GcodeWorkspace.vue` rewritten to the flat grid (5 new tests +
  the old drag test updated: emptying a pane now collapses the split), `Flexible-Layouts` `ExplorerPanel.vue` gains the split
  (`model/explorerPanes.ts` adapts the session's mutable tab objects to `workspace.ts`; new `explorerSplit.test.ts`, 20 tests). Each
  test asserts the SAME slot and `.cm-editor` element survive split / drag / close-split / a pane collapsing, with unsaved text and no
  upload. Mutations that force a remount, drop the id sort, or drop focus-on-click each fail specific tests. FL's URL follows the FOCUSED
  pane's file and resolves by path, so a deep link/Back to a file open in the other pane focuses it (no ordinal, so #517's URL problem
  cannot occur); clicking a tab or focusing an editor focuses its pane (`v-tabs` says nothing for an already-selected tab).
- Both hosts import `collapseEmptyGroup`, so they needed this release; pins bumped to `#v0.13.0` and re-tested on the real install. Full suites: FL 1594 pass, postprocessor 1224;
  `vue-tsc` on both (clean, with an injected error to prove the run had teeth). **Not verified in real Chrome**: the actual Vue
  components (only the grid CSS was, in a static page) - happy-dom has no layout. Not gated: narrow tiles (PR #517 hid the split
  below `lg`; here two panes just share the tile).

**2026-09-29 (v0.12.0, RELEASED: tagged and pushed; `npm publish` NOT done - the hosts pin the git tag): Find Code can be dismissed, a check runs on load, live per-line checking, and a shortcuts help panel.**
Three user asks, verified in real Chrome against the demo (Playwright from Flexible-Layouts' `node_modules`) as well as happy-dom.

- **`quickSearch.ts`**: the panel had no way out except Escape while its input still had focus. Now it has a close button,
  closes when focus leaves it (a click in the document, another toolbar button), and `F4` inside it closes it. Two traps:
  the focusout handler ignores a window switch (`relatedTarget` null while `!document.hasFocus()`), and a `gone` flag set by
  the panel's `destroy()` stops the browser's blur-on-removal re-dispatching inside a CM6 update (that throws).
- **`diagnostics.ts`**: `checkDocument(view, {path, firmwareVersion})` (parse + diagnose + `applyDiagnostics`, shared by the
  manual button and the on-load check), `canAutoCheck(view)` and `AUTO_CHECK_MAX_CHARS` (5 MB). Measured against core:
  ~0.27 s/MB synchronous (1 MB 0.34 s, 5 MB 1.3 s, 10 MB 2.7 s), so a bigger file keeps only the manual button.
- **`shortcutsHelp.ts` (new)**: `GCODE_EDITOR_SHORTCUTS` (hand-kept table), `openShortcutsHelp(view, {hide?, mac?})` (toggles,
  self-installs like `openSearchPanel`), `gcodeShortcutsHelp()` (`F1` + Escape), `formatShortcutKeys`. `hide` takes entry ids so a
  host drops what it has not wired (postprocessor: `save`; Flexible-Layouts menu files: `quickSearch`, `completion`,
  `blockComment`). The test cross-checks every CM6-backed entry against the REAL installed `defaultKeymap`/`searchKeymap`/
  `historyKeymap`/`completionKeymap` (it caught `Shift-Mod-l` vs CM6's own `Mod-Shift-l` spelling - modifier order is
  normalised), so a CM6 upgrade that moves a key fails a test. Its Escape binding is `Prec.high` - the base keymap's
  `simplifySelection` claims Escape whenever there is a selection (the first version of that test was vacuous: no base
  keymap in the mount; teeth-checked and rewritten).
- **`liveCheck.ts` (new): `gcodeLiveCheck({getOptions, onChange?, ...delays})`, `diagnoseLine`.** Re-checks the lines being typed on
  instead of the whole file. Read from core first: every single-document rule (`syntax/*`, `dictionary/*`, `objectModel/*`,
  `structure/macro-command-not-last`, `structure/capitalised-meta-keyword`) loops over lines independently, so a line parses and
  diagnoses alone in ~0.01 ms whatever the file size. Three timers: a line the cursor has LEFT (Enter, click elsewhere) after
  100 ms; the line the cursor is ON after 1 s of pause; the whole file after 1.5 s, only up to `fullCheckMaxChars` (500 KB,
  ~0.2 s). The line pass replaces only the diagnostics on the lines it checked (the rest keep their squiggles and move with the
  text). Two things a lone line cannot know, both handled:
  - **Block structure** (`else`/`elif` without `if`, `break`/`continue` outside a loop, mixed indentation): parsed alone,
    `else` is "else without if". `diagnoseLine` filters those `DocumentError` codes (`BLOCK_ERROR_CODES`, mirrors core's
    `isStructural` list minus `t-not-alone`, which IS line-local); they come back from the whole-file pass. A test asserts a
    bare `else`/`elif`/`break`/`continue` alone gives nothing - a new structural code in core would need adding to the list.
  - **`M453` machine mode**: `parseDocument` lexes each line in the mode set by the lines above (`( ... )` is a comment in
    CNC/laser mode). Alone, `G1 X1 (a comment) Y2` gets false unknown-command findings (measured). So the line pass turns
    itself off for any document containing `M453` (scanned lazily on first flush, then any checked line containing it flips
    the flag for good) and the whole-file pass covers it. `M453` takes NO parameters in core's dictionary (my first fixture
    `M453 P2 I0...` produced findings on the M453 line itself and made the tests vacuous).
  - An insertion of whole lines at a line start ends its dirty range on the last inserted line, not the unchanged line below
    (else editing above an orphan `else` would clear its squiggle until the next whole-file pass). Teeth-checked, as were the
    filter, the active-line hold-back, the M453 guard (3 separate paths), keeping other lines' diagnostics, and the size cap.
  - In real Chrome (demo, Playwright): typing shows nothing until the pause, then marks the line; an orphan `else` appears at
    the whole-file pass; on a 30 MB / 2M-line file typing 13 chars took 64 ms with 5 ms event-loop latency and the typed line
    was marked (on-load check correctly skipped over 5 MB). On a file over `fullCheckMaxChars` a block-structure error on an
    edited line stays cleared until the manual check.
- 354 tests (was 326). Demo has Find code / Shortcuts buttons, checks each file on open, and runs `gcodeLiveCheck`.
- **Hosts wired, committed and pushed** (no host tag, by the user's instruction): `Flexible-Layouts/src/widgets/GcodeCmEditor.vue`
  and `duet-gcode-postprocessor/src/components/GcodeEditor.vue` get a keyboard-icon Help button, `gcodeShortcutsHelp()`,
  `checkOnLoad` (deferred one tick, superseded-load guarded, skipped for menu files and over the size cap) and
  `gcodeLiveCheck` (non-menu only; `onChange` keeps the toolbar count current). Both pinned to `#v0.12.0` (the postprocessor
  jumped from `#v0.10.0`, skipping 0.11.0's menu work it has no use for). Host tests plus teeth checks (FL 47 in
  `gcodeCmEditor.test.ts`, postprocessor 132 in `component.test.ts`). `vue-tsc` on the SFCs was NOT run.

**2026-09-29 (v0.11.0, RELEASED: tagged, pushed, on npm): `menuFile.ts` - 12864 menu files get real highlighting and diagnostics.**
Why: Flexible-Layouts previews a menu file on its 12864 emulator, but DWC's Monaco exposes only `save()`/`focus()`, so the
preview could only show the file as saved. Opening menu files in this editor lets the host read the live buffer.

- **`menuLanguage`** (`classifyMenuLine`): built on core's `parseMenu` (per-parameter spans), no grammar of its own. The six
  commands RRF dispatches on are `keyword` (case-insensitive), an unrecognised word is deliberately uncoloured (it is what RRF
  refuses), parameter letters `propertyName`, values `number`/`string`, `{...}` expressions go through `language.ts`'s
  `classifyExpression` (now exported, with `HighlightRange`), `;` is `lineComment` - but only when every argument before it
  parsed, because RRF stops the line at the first bad argument. Existing tags only, so custom/high-contrast themes need nothing.
  `languageForPath` returns it for `FileKind: "menu"`.
- **`menuDiagnostics(text, {siblings, path, ...})` / `menuLiveLinter(getOptions)`**: core's `menu/*` rules are only reachable
  through `diagnoseProject` (`checkMenuDocument` is not exported), so this loads the text as a one-file project plus an empty
  stub per sibling name and keeps the findings for the edited file. **`menu/target-missing` and `menu/image-missing` are switched
  OFF unless `siblings` is given** - "not in the folder" cannot be told from "folder not listed". A sibling stub with the
  file's own name would overwrite its text (`loadProject` keys by canonical path), so it is skipped (the test that caught the
  guard being removable was first written vacuously - it passed with the guard deleted; mutation-checked and rewritten).
  Core's offsets count one character per line break, so pass `
` text (a CM6 document always is).
- Bumped `dwc-gcode-core` to `^1.29.0` (published; was installed at 1.27.0). 294 tests (was 266), typecheck/build clean.
- **Host work**: Flexible-Layouts wires it (see its own CLAUDE.md) and is pinned to `#v0.11.0`, pushed, CI green.
  `duet-gcode-postprocessor` has no menu files to edit and is still pinned to `#v0.10.0` (nothing to gain from 0.11.0).
  Released the usual way: `git tag v0.11.0 && git push origin main v0.11.0`, then `npm publish` (manual).
  Current published pair: core 1.30.0 (M291 boxes) and this package 0.11.0.

**2026-09-29 (later, same day): all five deferred stepper features built - core 1.29.0 and both hosts, committed
locally, NOT pushed, core NOT tagged/published.** User skipped the real-browser check and the host releases and asked
for every deferred feature ("all of the above" + G1 H1). Nothing in THIS package changed - all five are core + host.

- **`dwc-gcode-core` 1.29.0** (commit `b3e6263`, local; `CHANGELOG.md` has the full entry):
  - `startLine` (`SimulationInputs.startLine`, 1-based; `WalkOptions.startLine`, 0-based). The option already existed
    but was only right for a flat file - a block above the start line was still evaluated and run. Now skipped without
    evaluating; a start inside an `if`/`elif`/`else` arm or `while` body resumes that body ("taken" without evaluating the
    header), then carries on; on an `elif`/`else` line it starts the chain there. `findReferencedInputs(text,
    {startLine})` ignores lines above it and stops counting declarations above it (the walk never runs them, so the
    scenario must supply the value). `execPlainLines` lifts the clamp as soon as it runs a line at/after the start;
    the two post-resume `this.startLine = 0` are what stop a loop's second pass skipping lines when the resumed pass
    ran nothing (teeth-checked with a false `if` as the last body line - stubbing only one of the two clears passes,
    stubbing both fails).
  - `M291` with `{...}` parameters: read from RRF source first (`StringParser::GetQuotedString`'s `{` branch ->
    `AppendAsString`, `GCodes::DoMessageBox`). `parseBlockingMessageBox(cmd, evaluated?)`; the walker evaluates an
    M291 line's params first (per command, so `G1 F{..} M291 F{..}` can't cross), under `evaluateParams` only (without
    it an expression `P` is still "not a box", unchanged). Records the evaluation on the step, so the line view shows
    `M291 P"Layer 7" S2`.
  - `G1 H1`: `EndstopModel` (`end` low/high/none, `min`, `max`, `triggers`) in `InitialMachineState.endstops`. From RRF
    3.7.0-rc.1 `GCodes4.cpp` `waitingForSpecialMoveToComplete`: only `axesToHome & endstopsTriggered` axes get
    `AxisMinimum`/`AxisMaximum` (defaults 0/200 - `Configuration.h`) and `SetAxisIsHomed`; a non-triggering axis ends at
    the move target, unhomed. H2/H3/H4 stay plain moves. **`G28` failing to home is a different code path
    (`homing2` "Failed to home axes") and is NOT modelled.**
  - `stepper/scenarioSet`: `ScenarioSet` of named `SimulationInputs`, add/duplicate/rename/delete/select, JSON that
    reads a file's old bare scenario back as a set of one "Default".
  - 2126 tests (was 2062), typecheck/build/`docs:api` clean. Teeth-checked; the check caught two of my own
    vacuous tests (one asserted `iterations` in a `while` header, which RRF rejects outside a loop; one used a body
    whose last line always cleared the clamp anyway).
- **Both hosts** (commits `86b85e6` duet-gcode-postprocessor, `b458c59` Flexible-Layouts, local, the four stepper SFCs still
  byte-identical): scenario selector with new/duplicate/rename/delete (delete asks first unless the scenario is empty),
  the active name in the accordion title, a "Start line" field plus "start at the cursor line" button, a collapsible
  "Endstops for G1 H1 homing moves" section (per-axis end/min/max/never-triggers), and the accordion opens itself when
  the walk pauses on a value it has a field for (only on a NEW pause; a collapsed panel stays collapsed for the same
  path; a computed-index path with no field is left to the alert). `simulationScenario.ts` is now `loadScenarioSet`/
  `saveScenarioSet` (same localStorage key - the value is self-tagged, so old and new shapes read apart). Host tests:
  postprocessor 1214 pass (the old `preheatStep` CRLF failure did not show this run), Flexible-Layouts 1446 pass/1
  skip (one unrelated `fullPage.test.ts` timing flake once under full-suite load, passes alone). `vue-tsc` clean on
  both **and it found a real error of mine** (a union event name passed to `emit`) - the scratch-tsconfig recipe in
  memory needs one fix: do NOT put `baseUrl` in it (TS 6 rejects it with TS5101 and vue-tsc then reports nothing,
  which looks like a pass; the teeth check caught this).
- **(Superseded 2026-09-29, later: core 1.29.0 and 1.30.0 are tagged, pushed and on npm; Flexible-Layouts is bumped and pushed;
  the postprocessor pins core ^1.29.0. The text below is the state at the time.)** **Blocked on the user, deliberately**: core is not tagged, pushed or `npm publish`ed, so both hosts still pin
  `dwc-gcode-core` ^1.27.0/^1.28.0 and their lockfiles are untouched; they were tested against a real `npm pack`
  tarball installed with `--no-save`. Order when authorised: push core + tag `v1.29.0` + `npm publish` (poll `npm view`),
  then in each host bump the pin to ^1.29.0 and `npm install`, rerun gates, push, and check CI. The hosts still have not been
  through their own release (`node scripts/release.mjs`) and the real-browser check is still not done.
- Still unbuilt: `G28` modelled as running the homing macros; `move.axes[n].min/max` and `sensors.endstops[]`
  answered from the endstop model (they fall through to "ask" today).

**2026-09-29 (v0.10.0): ASCII-art banners + a real per-command parameter hoverbox for completions,
released.** Two independent user asks, built the previous session and released this one.

- **`asciiArt.ts` (new): `renderAsciiArt`/`insertAsciiArt`.** The user's linked reference
  (`budavariam/asciiart-text`) turned out on inspection to be a small showcase app, not a reusable
  library — its real `package.json` lists `figlet` as a `devDependency`. Took that as the actual
  ask (a FIGlet-style ASCII-art-to-comment feature) and added `figlet` (patorjk/figlet.js) as a real
  dependency instead: verified first, not assumed, that its one `dependencies` entry (`commander`) is
  CLI-only and never reaches the library import, and that its browser build + bundled `"Standard"`
  font together are ~70KB raw (`figlet-*.js` ~39KB + `importable-fonts/Standard.js` ~31KB) — a real
  number checked against the actual installed files, not a guess, and small next to the 94 KB gzipped
  figure `gcode-editor-plan.md` already established as this package's own budget. Only `"Standard"` is
  bundled (parsed once at module load via `figlet.parseFont`, following figlet's own README browser
  recipe exactly); `listAsciiArtFonts`/`parseAsciiArtFont`/`preloadAsciiArtFonts` are thin wrappers so
  a host can add more fonts itself without this module ever fetching one over the network on its own.
  `renderAsciiArt(text, options)` wraps every rendered row as its own full-line `;` comment (RRF's
  real line-comment token, confirmed against `language.ts`'s `commentTokens`, not assumed) and trims
  FIGlet's own trailing-space padding first (a wholly-blank row becomes a bare `;`, not `; ` with a
  dangling space). `insertAsciiArt(view, text, options)` is multi-cursor safe (built on
  `EditorState.changeByRange`, not hand-rolled offset math) and keeps the banner on clean lines of its
  own — a newline is added before/after only when the cursor isn't already at that line's start/end,
  so inserting mid-line splits the line around the block instead of fusing text onto its first/last
  row. 12 new tests, real teeth on the read-only guard and the before/after newline logic specifically
  (both confirmed to fail when stubbed to always-empty). **Not wired into either host** — needs a
  toolbar button + a text-input prompt in `duet-gcode-postprocessor`'s `GcodeEditor.vue` and
  `Flexible-Layouts`' `GcodeCmEditor.vue`, same as every other package-level action this package has
  shipped ahead of host wiring (`editorActions.ts`'s `alignLineComments`, `quickSearch.ts`, etc.).
- **`completion.ts`: parameter completions now carry a real hoverbox `info` panel.** User report: the
  parameter suggestions after a command (`G1 `'s `F`/`H`/etc.) were single, non-wrapping list rows —
  fine for a short description, but `@codemirror/autocomplete`'s own base theme ellipsis-clips a long
  one (`overflowX: hidden; textOverflow: ellipsis` on every `<li>`, verified against its real compiled
  source, not assumed), and a command with several parameters at once needed scrolling a cramped
  10em-tall list to see them all. Fix: each parameter completion's `info` now builds a real
  `.cm-completionInfo` panel (CM6's own documented "info" mechanism, a genuine `.cm-tooltip`, not a
  hand-rolled overlay — the same "boxed, positioned, escapes ancestor clipping" primitive
  `tooltipPlacement.ts` already mounts at `document.body`) listing **every** parameter the current
  command accepts, one per row, full text, never truncated — the square, Monaco-suggest-widget-style
  hoverbox asked for. The row matching the completion the box is attached to is bolded, mirroring how
  Monaco's own parameter-hint widget highlights the active parameter. New export
  `gcodeParamInfoTheme` styles it and widens `.cm-completionInfo`'s own fixed 400px default; bundled
  into `gcodeCompletion()` automatically, and documented as something a host composing
  `createGcodeCompletionSource()` into its own `autocompletion()` call needs to add itself. 2 new
  tests, teeth-checked (stubbing the `info` field away fails both new tests, restored).
- Both changes: full suite green (266 tests, was 252), `npm run typecheck` clean, `npm run build`
  clean. **Released as v0.10.0** (minor bump — a new dependency, a new module, and a real
  completion-UI change, not a fix): `package.json`/`package-lock.json` bumped, committed, tagged
  `v0.10.0`, pushed, and published to npm (`npm publish`, manual per this file's own Releasing
  section — the GitHub Actions release workflow only cuts the GitHub Release from the tag, it does
  not touch npm). **Not done**: wiring either feature into a host — `duet-gcode-postprocessor` and
  `Flexible-Layouts` are still pinned to `dwc-gcode-editor` v0.9.0 and need their own bump plus real
  toolbar work (an ASCII-art button + text prompt; the parameter hoverbox needs no host change at all,
  it's automatic wherever `gcodeCompletion()` is already wired in).

**2026-09-28 (later same session): first real-browser feedback on the stepper UI - toolbar decluttered,
`StepperReadout` compacted, in both hosts.** User sent a real-browser screenshot of `GcodeCmEditor`/
`GcodeStepperPanel` open on `homex.g` in Flexible-Layouts (the toolbar's icon order pinned it to that
host, not `duet-gcode-postprocessor`'s own `GcodeEditor.vue` toolbar) with two things circled: the readout
between the scrub bar and the "Scenario" accordion taking too much vertical space, and a redundant
filename label at the toolbar's far right. Both are host-level, not this package's own files - fixed
directly in `duet-gcode-postprocessor/src/components/` and `Flexible-Layouts/src/widgets/`, kept
byte-identical the same way the 2026-09-28 scenario-panel redesign already was:

- **Toolbar filename label removed** (`GcodeEditor.vue`'s trailing `{{ path }}` span,
  `GcodeCmEditor.vue`'s `<v-spacer />` + `{{ basename(filename) }}` span) - it duplicated the open tab's
  (`duet-gcode-postprocessor`) or tile's (`Flexible-Layouts`) own title. The `*`-for-dirty it also carried
  is not lost: both hosts' Revert button is already `:disabled="!dirty"`, the same state visible a
  different way, so nothing was added back for it.
- **`StepperReadout.vue` compacted**: the "Line N" caption now sits inline with the source line instead
  of on its own row (`.now-line`, flex + `min-width: 0` so a long line still wraps rather than
  overflowing the row); axis cards shrank (`min-height` 4.25rem → 3rem, smaller letter/value/delta fonts,
  tighter grid gap); every section's `mb-2` became `mb-1`.
- **`GcodeStepperPanel.vue`**: the "Scenario" `v-expansion-panel`'s own title/text padding is Vuetify's
  default, sized for a standalone accordion, not a collapsed-by-default strip under an already-dense
  readout - added scoped `:deep()` overrides (`min-height: 2.25rem`, tighter padding) so the closed row
  costs one compact line.
- **Found and fixed while verifying, not left for later**: `Flexible-Layouts/src/__tests__/gcodeCmEditor.test.ts`'s
  "shows a load error rather than throwing when the download fails" test was asserting `wrapper.text()`
  contained `"missing.g"` - which passed only because the now-removed toolbar span rendered
  `basename(filename)` unconditionally, never because the load-error alert's own text actually contained
  it (its i18n key comes back untranslated in this test environment, confirmed against this same file's
  own established pattern of asserting on raw untranslated keys elsewhere, e.g. the `...gcodeEditor.colors`
  checks). Rewrote it to assert on the load-error alert's own raw i18n key instead of the incidental
  filename text next to it - a real gap the toolbar cleanup exposed, not a test loosened to match the change.
- All three edited files stayed content-identical between the two hosts (diffed post-edit, ignoring each
  repo's own CRLF/LF line-ending convention, to confirm). Full suites green: `Flexible-Layouts` 1377
  passed/1 pre-existing skip; `duet-gcode-postprocessor` 1179 passed/1 failed - the same pre-existing
  Windows CRLF `preheatStep` fixture issue already on record above, untouched by this change.
- **Not done**: the `vue-tsc` host-SFC check (the scratch-tsconfig-in-the-DWC-checkout recipe used
  2026-09-28 for the scenario-panel redesign) - skipped as low-risk given these are template/CSS-only
  edits with no new script identifiers on either side, but it's still the one gate this entry didn't run.
  Neither host has been released past its `main` push (no `node scripts/release.mjs <version> --push` in
  either) - this was a same-session fix on top of the unreleased v0.9.0 host work, not a version bump of
  its own.

**2026-09-28 (v0.9.0): the offline stepper as a macro-testing tool - this package's part is the line as
evaluated under the current line.** Ask: step through system files and macros (not print files) from a chosen
starting position, see each computed line as evaluated, see coordinates prominently, and test how code reacts
to different object-model values. Most of it is NOT here - it spans three repos:

- **`dwc-gcode-core` (released 1.27.0, tagged and on npm; this package now depends on ^1.27.0)**: `stepper/simulation` - `SimulationInputs` (start position
  for X/Y/Z **and any other axis**, homed, tool, G91/M83; object-model paths and `param.*`; preset `global`s/`var`s;
  M291 answers), `runSimulation`, `describeStep`, `renderEvaluatedLine`, `axisReadouts`, `findReferencedInputs`,
  pure edit helpers. `walkExecution({recordEvaluation})` records each step's evaluated `{...}` params, `if`
  outcome, assignment, `echo`/`M117` text and the variables. **A caller-supplied value now beats the tracked
  one** (was the reverse) - see its CHANGELOG.
- **This package**: `currentLine.ts` - `setCurrentLine(view, line, { annotation })` draws a block widget
  under the highlighted line from `{text, kind: "source"|"value"|"result"}` segments (the shape core's
  `renderEvaluatedLine` returns; this package does not import core for it). Every call replaces the previous
  annotation, so a step with nothing to show never inherits the last one. 252 tests (was 245), teeth on
  widget placement and annotation replacement. **Not verified in a real browser** - happy-dom only.
- **Both hosts** (`duet-gcode-postprocessor`, `Flexible-Layouts`, byte-identical copies): `GcodeStepperPanel`
  now composes `StepperReadout` (source line + evaluated line, big per-axis cards with deltas, variable watch)
  and `StepperScenarioPanel` (start position, and a field per value the file reads). Scenario is saved per
  file (`...stepperScenario.<path>`), migrating the two old keys; editing the buffer re-runs the walk
  (debounced). Pins bumped to core ^1.27.0 and this package `v0.9.0`.
- **Scenario panel redesigned for real screens (2026-09-28, later same session)**: a real-browser look on a
  1920x1080 laptop found the panel overflowed even a maximised expansion panel - one stacked field+checkbox
  per axis, two multi-line help paragraphs, one full-width table row per referenced value. Prototyped a
  compact layout first as an interactive Design artifact, then ported it into `StepperScenarioPanel.vue` /
  `ScenarioValueField.vue` / `GcodeStepperPanel.vue` in both hosts: axes/tool/feedrate/G91/M83 became one
  two-row strip (axis capsules with a home icon-toggle instead of checkbox+label; tool/feed/extruder as
  small stat fields; G91/M83 as toggle buttons), the long help text moved into `v-tooltip`s off an `(i)`
  icon, and "values this file reads" became a filterable, multi-column, height-capped
  (`max-height`+`overflow-y:auto`) CSS grid instead of one table row per entry - so however many values a
  file references, only that list scrolls and nothing below it is ever pushed off screen. "Add a value" is
  now a one-line disclosure. `ScenarioValueField` gained `variant`/`hideDetails` props (default unchanged)
  so the compact fields don't each draw their own outlined box. Every `aria-label`/`data-scenario-*` string
  the tests depend on was kept exactly, so no test changed. `vue-tsc` clean on both hosts' SFCs (see this
  package's own memory for the scratch-`tsconfig` recipe used, since `dwc-plugin-typecheck` can't resolve a
  host's own deps).
- **Done 2026-09-28**: all four repos committed; core 1.27.0 tagged, pushed and on npm; this package tagged
  `v0.9.0` and pushed; both hosts bumped and `npm install`ed (real copies, no overlays), suites rerun,
  `vue-tsc` clean on both hosts' SFCs; the scenario-panel redesign above committed and pushed to both hosts'
  `main` (not tagged - these two repos don't tag per change, only on their own releases). Postprocessor's
  `preheatStep` failure is a pre-existing Windows CRLF-fixture issue, not this work.
  **Outstanding jobs for the simulator, in order:**
  1. **Real-browser check (started 2026-09-28, later same session - a real screenshot, not a systematic
     pass)** - happy-dom has verified the DOM shape but nothing about real layout/rendering. The user's own
     screenshot of `StepperReadout`/`GcodeStepperPanel` on a real screen found two real defects, both fixed
     directly in both hosts (see this file's own dated entry below) - a toolbar filename label duplicating
     the open tab/tile's own title, and the readout costing more vertical height than the scrub bar, axis
     cards and collapsed "Scenario" row need. The systematic pass below is still outstanding:
     - `StepperReadout`: axis-card grid wrapping, the evaluated-line block widget under the current line in
       light mode, dark mode and a custom color scheme, the "now" highlight.
     - The scenario panel redesign specifically: axis capsules and their home-icon toggle, the tool/feed/
       extruder mini stat fields, the G91/M83 toggle buttons, the `(i)` tooltips, the values grid's
       multi-column wrap AND its internal scroll once entries exceed `max-height` (16rem), the filter box
       (appears past 5 entries), and the "Add a value manually" one-line disclosure.
     - `Tab` focus order through the scenario fields (axis inputs → home toggle → remove → next axis →
       tool/feed/extruder → G91/M83 → filter → values grid → add-value link) - never checked, and the
       redesign changed the DOM order enough that it's worth re-verifying, not assuming it still reads well.
     - The expansion panel's own collapse/expand and the "Scenario" / count summary.
   2. **Release the two hosts as real plugin versions** once the browser check is clean - this session only
      pushed the work to each host's `main`; neither has been through its own `node scripts/release.mjs
      <version> --push` (bumps `plugin.json`+`package.json`, tags, triggers the release build). Decide a
      version number for each first (suggest a minor bump in both, since this is new user-visible
      functionality, not a fix).
   3. **Deferred stepper features** (design decisions not yet made, none started):
      - `startLine` - begin the walk mid-file instead of always from line 1.
      - Evaluate `M291` message-box parameters in the line-as-evaluated view (currently only `{...}`
        expressions, assignments and `echo`/`abort`/`M117` are shown evaluated).
      - Model `G1 H1` homing moves (a move that only completes if it hits an endstop - the simulator has no
        endstop model at all right now).
      - Named/saved scenarios per file - currently exactly one scenario per file, no way to keep several
        (e.g. "cold start" vs "already primed") and switch between them.
      - A "needs a value" auto-expand of the scenario panel when the walk pauses on an unresolved input,
        so the user doesn't have to notice the alert and open the accordion by hand.
- **Gotcha that cost a repair**: never `npm install --no-save ../dwc-gcode-editor` (or `../dwc-gcode-core`) into a
  host to test unreleased work. npm symlinks it, then extracts the lockfile's pinned version THROUGH the symlink
  and overwrites this repo's working tree (it reverted ~20 files to v0.8.1 and lost uncommitted edits). Pack
  tarballs (`npm pack`) and install those instead - real copies, and they share the host's `@codemirror/state`.

**2026-09-28 (unreleased): `dwc-gcode-core` ^1.26.0, `board.txt` support, Tab and comment-selection.**

- **`boardTxt.ts` (new)**: `board.txt` is the STM32 fork's `key = value` / `key = { a, b }` file, not G-code,
  so `gcodeLanguage` mis-coloured it. Core 1.26.0 has `parseBoardTxt`/`BOARD_TXT_KEYS` but no tokeniser and
  problems carry a LINE, not columns, so this adds: `boardTxtLanguage` (`classifyBoardTxtLine` walks a line the
  way the loader's `GetConfigKeys` does - comment starts `/ # ;`, key run, `=`, scalar / quoted / `{}` list, text
  after a value only coloured if it is a comment; known key `propertyName`, unknown key deliberately
  UNcoloured, values by table type; existing tags only, so custom/high-contrast themes need nothing),
  `boardTxtDiagnostics(text, options)` (each problem underlines its whole line's content; `empty-array` is
  `info`, the rest `warning` - RRF just skips the line), `boardTxtLiveLinter`, `boardTxtCompletion` (key names
  only, inserts `= ` / `= {}` with the cursor inside the braces). `fileLanguage.ts`'s `languageForPath(path)`
  picks it via core's `classifyFile` (`board-config` -> board.txt, `syntax: "gcode"` -> `gcodeLanguage`, else
  `null`). All 48 real `rrfboot.txt` files from core's corpus give zero diagnostics (checked ad hoc, not a
  committed test - it reads a sibling repo). **Not wired into either host** - a host must call
  `languageForPath` where it now hard-codes `gcodeLanguage`.
- **Comment a selection**: `Mod-/` already line-commented every selected line. "Block comment" needed a
  decision: `lexLine` reads `(...)` as a comment **only in CNC mode**, so a `block: {open:"(",close:")"}`
  token (tried first) would wrap FFF printer files in a non-comment - reverted. `Shift-Alt-a` now falls back
  to `toggleComment` (`;` per line) via `blockCommentFallback`, listed AFTER `defaultKeymap` so a language
  that does declare a block token still gets a real one.
- **Tab**: CM6 binds no Tab by default, so a selection could not be indented. `indentOrInsertTab` (in
  `BASE_EDITING_EXTENSIONS`): selection -> `indentMore` on every touched line, bare cursor -> insert one
  `indentUnit` AT the cursor (not `insertTab`'s hard-coded `\t`, not `indentWithTab`'s indent-the-whole-line),
  `Shift-Tab` -> `indentLess`; read-only refuses. This traps Tab for keyboard-only users - CM6's `Ctrl-m`
  toggles it off. 245 tests (was 203); teeth on the Tab, fallback, unknown-key and list-separator paths.

**2026-09-28 (unreleased): `viewState.ts` - per-file cursor + scroll persistence, ported from Fluidd's
`FileEditor.vue`** (Monaco `saveViewState`/`restoreViewState`, keyed per file, `local`/`session`/`off`
setting, saved on unmount/file change). Read its real source first. `captureViewState`/`restoreViewState`
store `{anchor, head, topLine, scrollLeft}` - scroll as the top visible LINE, not pixels (pixels break
under different font/wrap/width); everything clamped on restore since the file may have changed.
`gcodeViewStatePersistence({key, store})` restores on creation (one microtask - a plugin can't dispatch
from its constructor), saves debounced on selection/scroll and always on destroy, and never writes before
the restore ran (else a fresh view at line 1 overwrites what it was about to restore).
`createWebStorageViewStateStore` keeps ONE JSON map with LRU eviction (`maxEntries` 200) instead of
Fluidd's never-expiring per-file keys; all storage access try/catch'd, corrupt data = empty.
`viewStateStoreForMode("local"|"session"|"off")` is the settings-UI one-liner. **No fold state** - this
package has no folding (Monaco's blob had it). Not wired into either host (`key` = file path, mode from
each host's own setting - needs a host settings toggle). Scroll is only spy-tested (`lineBlockAtHeight` /
`scrollIntoView`) - happy-dom has no layout, so no real browser check yet. 203 tests; 3 teeth checks.

**2026-09-28 (unreleased, on top of v0.8.1): expression highlighting + tooltip placement.** User
report: `exists`/`global` weren't coloured correctly, and tooltips fell off the top/bottom of the page.

- **`language.ts`**: `lexLine` returns only the bare keyword for a meta line (`if`/`while`/`var`/`set`/
  `echo`…) and a flat `kind: "expression"` span for `{...}` params - verified by running it - so
  everything inside was uncoloured or one flat `atom`. New `classifyExpression` scans those bodies:
  `name(` -> `keyword` (`exists`, `abs`…), `global`/`var`/`param`/`local` -> `definitionKeyword`, `.name`
  segments and other object-model paths -> `propertyName`, `true`/`null`/`iterations`… -> `atom`,
  numbers/strings (doubled-quote escape) as themselves, `[...]` indices recursed into, meta-line body
  stops at `lexed.comment.start`. Reuses only existing tags, so `customTheme.ts`/high-contrast need no
  new colour keys.
- **`tooltipPlacement.ts` (new)**, always included by `createEditorInstance`: `tooltips({parent:
  document.body, position: "fixed"})` so a `transform`ed / `overflow:hidden` host ancestor (Vuetify
  dialog, Flexible-Layouts tile) can't clip or mis-anchor it, plus a max-height/scroll on the lint
  tooltip. CM6's own flip/resize logic already measures against the window (read its `writeMeasure`);
  the defect was the container, not the flip. **Not verified in a real browser** - only that the tooltip
  DOM lands under `document.body` (happy-dom). 186 tests; both fixes teeth-checked.

**2026-09-22 (v0.8.1): `completion.ts`'s parameter-letter completion now fires automatically right
after a known command, not just on explicit (Ctrl+Space) invocation.** User report, with a Monaco
screenshot: typing `M280 ` in DWC's own Monaco editor pops up `P`/`S` unprompted; this package's
equivalent position (`paramLetterCompletions`' "nothing typed yet" branch) required
`context.explicit`, so the popup silently disappeared after the command-code match ended and nothing
replaced it until the user manually invoked completion. The gate was deliberate (a dedicated test
asserted it), just wrong relative to Monaco's own real behaviour - removed the `context.explicit &&`
condition so the branch fires on ordinary as-you-type completion too, same as the sibling
"typing a bare letter after the command" branch already did. 177 tests (was 176); the old test
(`"excludes a parameter letter already used earlier on the same command"`) updated to assert the
automatic (non-explicit) call now returns the filtered list directly, plus a new test pinned to the
user's own `M280` repro.

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
