/**
 * Light/dark theme sync for the editor's own chrome and syntax highlighting.
 *
 * DWC's `useSettingsStore().darkTheme` is the single reactive boolean every consumer already reads
 * (`MonacoEditor.vue` itself switches between Monaco's `"vs"`/`"vs-dark"` off this exact flag) — this
 * module gives `dwc-gcode-editor` an equivalent light/dark pair a host can swap reactively, without
 * this package itself importing anything from DWC, Vue, or any store. A host wires it up with its own
 * `watch(() => settingsStore.darkTheme, (dark) => controller.setDark(view, dark))`.
 *
 * **Dark chrome + highlighting comes from `@codemirror/theme-one-dark`** — the official CodeMirror
 * team package — rather than hand-rolled colors, matching this package's own Rule 2 (a claim about
 * CM6's behaviour needs the installed package's real source, not general knowledge). One real gap
 * checked directly rather than assumed: `oneDarkHighlightStyle`'s own rule list (read from its
 * compiled source) only targets "root" tags like `tags.keyword` and `tags.comment` — it has no rule
 * naming `controlKeyword`, `definitionKeyword`, or `lineComment`, the specific tags `language.ts`
 * emits for meta keywords and end-of-line comments. That is not a gap in practice: `@lezer/highlight`'s
 * own compiled source defines each of those as a genuine sub-tag of its parent
 * (`controlKeyword: t(keyword)`, `definitionKeyword: t(keyword)`, `lineComment: t(comment)`), and
 * CM6's own tag-matching already falls back from a sub-tag to its parent's rule — confirmed by
 * dispatching a real edit through a real `EditorView` in this module's own tests and reading back
 * the computed color, not just trusting the tag hierarchy exists on paper.
 *
 * **Light mode is `@codemirror/language`'s own `defaultHighlightStyle`** — exactly what every
 * consumer's own `editorExtensions()` already wires in today (`GcodeCmEditor.vue`,
 * `GcodeEditor.vue`) — with no `EditorView.theme()` chrome override, so light mode's chrome is
 * unchanged from what ships today. Switching to dark is the only actual new behaviour.
 */

import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDarkHighlightStyle, oneDarkTheme } from "@codemirror/theme-one-dark";

const lightExtension: Extension = syntaxHighlighting(defaultHighlightStyle, { fallback: true });
const darkExtension: Extension = [oneDarkTheme, syntaxHighlighting(oneDarkHighlightStyle, { fallback: true })];

/** The theme extension for one mode. Only useful as the *initial* value passed to
 *  `createThemeController` — once a state exists, changing modes has to go through
 *  `ThemeController.setDark` (a plain re-splice into a static extension list does nothing; CM6
 *  states are immutable once created, which is exactly what `Compartment` exists to work around). */
export function gcodeTheme(dark: boolean): Extension {
	return dark ? darkExtension : lightExtension;
}

export interface ThemeController {
	/** Include this once among the extensions passed to `createEditorInstance` — it's the
	 *  compartment's live slot, not a fixed value. */
	readonly extension: Extension;
	/** Swap the live theme without recreating the view or losing the document, selection, or undo
	 *  history — the whole reason this goes through a `Compartment` instead of a full remount. */
	setDark(view: EditorView, dark: boolean): void;
}

/** A theme a host can flip reactively (e.g. from a `watch(() => settingsStore.darkTheme, ...)`) via
 *  CM6's `Compartment` mechanism — the supported way to change an extension after a state already
 *  exists. One controller belongs to exactly one `EditorView`. */
export function createThemeController(initialDark: boolean): ThemeController {
	const compartment = new Compartment();
	return {
		extension: compartment.of(gcodeTheme(initialDark)),
		setDark(view: EditorView, dark: boolean): void {
			view.dispatch({ effects: compartment.reconfigure(gcodeTheme(dark)) });
		},
	};
}
