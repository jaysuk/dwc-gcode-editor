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

import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDarkHighlightStyle, oneDarkTheme } from "@codemirror/theme-one-dark";
import { tags } from "@lezer/highlight";

const lightExtension: Extension = syntaxHighlighting(defaultHighlightStyle, { fallback: true });
const darkExtension: Extension = [oneDarkTheme, syntaxHighlighting(oneDarkHighlightStyle, { fallback: true })];

/**
 * A pure-black/pure-white, high-saturation palette for the "Keep (basic)" scope-table row
 * (`screen-reader/ARIA, keyboard nav, high-contrast theme`) — one extra mode alongside light/dark,
 * not a light/dark pair of its own (matching Monaco's most commonly used `hc-black`, not the full
 * `hc-black`+`hc-light` pair, to stay at the "basic" bar the scope table asks for). Every color below
 * is chosen for contrast against `#000000`, not aesthetics: `#ffff00` (keywords/command codes),
 * `#00ffff` (parameter letters), `#00ff00` (numeric values), `#ff8000` (quoted strings), `#ff66ff`
 * (`{expression}` atoms), `#e0e0e0` (comments — dimmer than pure white so it still reads as
 * de-emphasized, but well clear of any minimum-contrast threshold against black). `controlKeyword`/
 * `definitionKeyword`/`lineComment` need no separate rule here for the same reason `theme.ts`'s
 * existing dark-mode comment already relies on: CM6's tag-fallback resolves an unlisted sub-tag to
 * its parent's rule (`tags.controlKeyword`/`definitionKeyword` are `t(tags.keyword)`, `lineComment`
 * is `t(tags.comment)` — `@lezer/highlight`'s own compiled source).
 */
const highContrastHighlightStyle = HighlightStyle.define([
	{ tag: tags.keyword, color: "#ffff00", fontWeight: "bold" },
	{ tag: tags.propertyName, color: "#00ffff" },
	{ tag: tags.number, color: "#00ff00" },
	{ tag: tags.string, color: "#ff8000" },
	{ tag: tags.atom, color: "#ff66ff" },
	{ tag: tags.comment, color: "#e0e0e0", fontStyle: "italic" },
]);

const highContrastChrome = EditorView.theme({
	"&": { color: "#ffffff", backgroundColor: "#000000" },
	".cm-content": { caretColor: "#ffffff" },
	".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffffff", borderLeftWidth: "2px" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#0078d4" },
	".cm-activeLine": { backgroundColor: "#2a2a2a" },
	".cm-gutters": { backgroundColor: "#000000", color: "#e0e0e0", borderRightColor: "#ffffff" },
	".cm-activeLineGutter": { backgroundColor: "#2a2a2a" },
}, { dark: true });

const highContrastExtension: Extension = [highContrastChrome, syntaxHighlighting(highContrastHighlightStyle, { fallback: true })];

/** The theme extension for one mode. Only useful as the *initial* value passed to
 *  `createThemeController` — once a state exists, changing modes has to go through
 *  `ThemeController.setDark`/`setHighContrast` (a plain re-splice into a static extension list does
 *  nothing; CM6 states are immutable once created, which is exactly what `Compartment` exists to
 *  work around). */
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
	/**
	 * Orthogonal to `setDark`: when `enabled`, overrides whatever light/dark mode is currently set
	 * with the high-contrast palette above; when disabled, reverts to the last `setDark` mode. Kept
	 * as a separate toggle rather than a three-way `setDark`/mode replacement so existing callers
	 * (`duet-gcode-postprocessor`'s `GcodeEditor.vue`, `Flexible-Layouts`' `GcodeCmEditor.vue`, both
	 * already calling `setDark(view, dark)` off `settingsStore.darkTheme`) need no change to keep
	 * working exactly as before — high contrast is new, additive surface, not a replacement.
	 */
	setHighContrast(view: EditorView, enabled: boolean): void;
}

/** A theme a host can flip reactively (e.g. from a `watch(() => settingsStore.darkTheme, ...)`) via
 *  CM6's `Compartment` mechanism — the supported way to change an extension after a state already
 *  exists. One controller belongs to exactly one `EditorView`. */
export function createThemeController(initialDark: boolean): ThemeController {
	const compartment = new Compartment();
	let dark = initialDark;
	let highContrast = false;

	function current(): Extension {
		return highContrast ? highContrastExtension : gcodeTheme(dark);
	}

	return {
		extension: compartment.of(current()),
		setDark(view: EditorView, d: boolean): void {
			dark = d;
			view.dispatch({ effects: compartment.reconfigure(current()) });
		},
		setHighContrast(view: EditorView, enabled: boolean): void {
			highContrast = enabled;
			view.dispatch({ effects: compartment.reconfigure(current()) });
		},
	};
}
