/**
 * Bridge `dwc-gcode-core`'s `Diagnostic`s (from `diagnoseDocument`/`diagnoseProject`) onto CM6's
 * `@codemirror/lint`.
 *
 * `dwc-gcode-core`'s own `Diagnostic.start`/`.end` are already **absolute character offsets into
 * the file's own text** (`diagnostics/schema.ts`'s own doc comment) — the exact same coordinate
 * space as CM6's own `from`/`to` positions. Unlike `toMonacoMarkers` (that package's existing
 * Monaco adapter), which has real work to do converting those offsets into Monaco's 1-based
 * line/column shape, this adapter needs none of that: it is close to a direct field rename. Checked
 * directly against the installed `@codemirror/lint`'s own `.d.ts`: its `Severity` type is exactly
 * `"hint" | "info" | "warning" | "error"`, identical to `dwc-gcode-core`'s own — no severity mapping
 * table needed either, unlike `toMonacoMarkers`'s numeric `MONACO_SEVERITY` table.
 *
 * **Why this module never wraps `diagnoseDocument` in an automatic, on-every-keystroke CM6
 * `LintSource` by default.** `@codemirror/lint`'s own docs are explicit: "Linting is always re-done
 * on document changes" once a `LintSource` is installed — there is no debounce setting that avoids
 * re-running the source, only ones that delay it. Re-running `dwc-gcode-core`'s tokeniser/diagnostic
 * rules across a real 200 MB file on every keystroke is exactly the cost this whole project exists
 * to avoid (`docs/gcode-editor-plan.md`'s stop point 2). The feature this was actually built for —
 * "a button that checks the file for errors" — is a **manual, on-demand** action anyway, not live
 * linting. So the exported building blocks are: `toCmDiagnostics` (the pure mapping), `applyDiagnostics`
 * (push a one-off diagnostic set into the editor — what a "Check for errors" button calls),
 * `gcodeLintUi` (installs the squiggles/gutter/hover machinery with **no** automatic source, safe for
 * files of any size), and `gcodeLiveLinter` (the opt-in, real `linter()`-backed automatic extension,
 * for a host that has already decided a specific document is small enough for live linting to be
 * worth its cost).
 */

import { linter, setDiagnostics, type Diagnostic as CmDiagnostic, type LintSource } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Diagnostic as CoreDiagnostic } from "dwc-gcode-core";

/** Pure field mapping — see the module doc comment for why there is no offset or severity conversion. */
export function toCmDiagnostics(diagnostics: ReadonlyArray<CoreDiagnostic>): Array<CmDiagnostic> {
	return diagnostics.map((d) => ({
		from: d.start,
		to: d.end,
		severity: d.severity,
		message: d.message,
		source: d.rule,
	}));
}

/** Push a one-off set of `dwc-gcode-core` diagnostics into the editor — what a "Check for errors"
 *  button calls. Requires `gcodeLintUi` (or `gcodeLiveLinter`) to already be part of the editor's
 *  extensions, the same way CM6's own `setDiagnostics` requires `linter(...)` to be installed. */
export function applyDiagnostics(view: EditorView, diagnostics: ReadonlyArray<CoreDiagnostic>): void {
	view.dispatch(setDiagnostics(view.state, toCmDiagnostics(diagnostics)));
}

/** Installs the diagnostics UI (squiggly underlines, hover tooltips) with **no** automatic source —
 *  diagnostics only ever appear via `applyDiagnostics`. Safe to install unconditionally, on a
 *  document of any size, since nothing here ever re-runs a linter on its own. `LintConfig` is not
 *  itself exported by `@codemirror/lint`, so its shape is referenced via `linter`'s own second
 *  parameter position rather than duplicated by hand. */
export function gcodeLintUi(config?: Parameters<typeof linter>[1]): Extension {
	return linter(null, config);
}

/**
 * The opt-in, automatic, real `@codemirror/lint` `linter()` extension — re-runs `source` on every
 * document change (after `delay`, default 750 ms per CM6's own default). Only use this once a host
 * has decided a specific document is small enough for that cost to be worth it; see the module doc
 * comment. `source` is a plain, synchronous function rather than CM6's own `LintSource` shape
 * (`(view) => Diagnostic[] | Promise<Diagnostic[]>`) so a caller can supply
 * `() => toCmDiagnostics(diagnoseDocument(parseDocument(view.state.doc.toString()), path, options))`
 * inline without needing to reach for CM6's own view-shaped callback signature.
 */
export function gcodeLiveLinter(source: (view: EditorView) => ReadonlyArray<CmDiagnostic>, config?: Parameters<typeof linter>[1]): Extension {
	const asLintSource: LintSource = (view) => source(view);
	return linter(asLintSource, config);
}
