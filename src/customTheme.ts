/**
 * User-customisable syntax colors + background/foreground — every distinct visual category
 * `language.ts`'s highlighting actually produces, each independently settable, plus the editor's own
 * background and default text color. Built on the same `HighlightStyle`/`EditorView.theme` primitives
 * `theme.ts`'s fixed light/dark/high-contrast palettes already use, not a new mechanism.
 *
 * `controlKeyword`/`definitionKeyword`/`comment`(`lineComment`) are independently colorable here,
 * unlike the fixed light/dark themes which rely on CM6's tag-fallback to inherit them from
 * `keyword`/`comment` — a custom palette gives each its own real rule so a user who wants `if`/`while`
 * to look different from `G1`/`M104`, or wants `;` comments distinct from CNC `(...)` comments, can
 * set that directly instead of only being able to recolor the shared parent.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** Every user-editable color. All values are CSS color strings (`#rrggbb`, `rgb(...)`, a named
 *  color, ...) — this package never validates a value's own syntax, only the shape of the object
 *  carrying them (see `isGcodeColorScheme`). */
export interface GcodeColorScheme {
	background: string;
	foreground: string;
	/** Command codes (`G1`, `M104`, `T0`, ...) and statement keywords with no dedicated category
	 *  below (`echo`). */
	keyword: string;
	/** `if` / `elif` / `else` / `while` / `break` / `continue` / `abort` / `skip`. */
	controlKeyword: string;
	/** `var` / `global` / `set`. */
	definitionKeyword: string;
	/** Parameter letters (`X`, `S`, `P`, ...). */
	propertyName: string;
	/** Numeric and colon-separated list values. */
	number: string;
	/** Quoted string values. */
	string: string;
	/** `{expression}` contents. */
	atom: string;
	/** Both `;` line comments and CNC `(...)` comments — one color for "this is a comment", matching
	 *  how a user thinks about it even though `language.ts` emits two distinct tags for the two
	 *  syntaxes. */
	comment: string;
}

/** Field order used by the settings UI and by `isGcodeColorScheme`'s own shape check — one place so
 *  a host's color-picker list and this package's validation can never silently drift apart. */
export const GCODE_COLOR_SCHEME_KEYS: ReadonlyArray<keyof GcodeColorScheme> = [
	"background", "foreground", "keyword", "controlKeyword", "definitionKeyword",
	"propertyName", "number", "string", "atom", "comment",
];

/** A reasonable, readable light palette — an independent default for this new customisable scheme,
 *  not required to pixel-match `theme.ts`'s fixed `defaultHighlightStyle`-based light theme (that
 *  one stays as CM6's own official default; this is a distinct, user-editable starting point). */
export const DEFAULT_LIGHT_COLOR_SCHEME: GcodeColorScheme = {
	background: "#ffffff",
	foreground: "#292929",
	keyword: "#0000ff",
	controlKeyword: "#af00db",
	definitionKeyword: "#0070c1",
	propertyName: "#267f99",
	number: "#098658",
	string: "#a31515",
	atom: "#a31515",
	comment: "#008000",
};

/** A reasonable, readable dark palette — same independence note as the light default above; not
 *  required to match `theme.ts`'s fixed `oneDark`-based dark theme. */
export const DEFAULT_DARK_COLOR_SCHEME: GcodeColorScheme = {
	background: "#282c34",
	foreground: "#abb2bf",
	keyword: "#c678dd",
	controlKeyword: "#e06c75",
	definitionKeyword: "#61afef",
	propertyName: "#e5c07b",
	number: "#d19a66",
	string: "#98c379",
	atom: "#d19a66",
	comment: "#7f848e",
};

/** Runtime shape check for a value loaded from an untrusted source (a hand-editable JSON file on the
 *  SD card) — every key in `GCODE_COLOR_SCHEME_KEYS` must be present and a string; nothing else about
 *  the string (that it's a real CSS color) is checked, the browser's own CSS engine already tolerates
 *  an invalid value by simply not applying it. */
export function isGcodeColorScheme(value: unknown): value is GcodeColorScheme {
	if (value === null || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return GCODE_COLOR_SCHEME_KEYS.every((key) => typeof obj[key] === "string");
}

/** Perceptual-ish luminance from a `#rrggbb`/`#rgb` hex color, `null` for anything else (a named
 *  color, `rgb(...)`, an invalid value) — used only as a best-effort hint for `EditorView.theme`'s
 *  own `dark` flag below, never to reject or normalise a color a user chose. */
function hexLuminance(color: string): number | null {
	const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
	if (m === null) return null;
	const hex = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
	const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The editor's chrome + syntax highlighting for one user-supplied palette. */
export function gcodeCustomTheme(colors: GcodeColorScheme): Extension {
	// Best-effort hint for CM6's own ambient dark/light behaviour (native scrollbar theming etc) -
	// defaults to treating an unrecognised background format (a named color, rgb(), ...) as light,
	// matching EditorView.theme's own default when `dark` is omitted.
	const luminance = hexLuminance(colors.background);
	const dark = luminance !== null && luminance < 0.5;
	const chrome = EditorView.theme({
		"&": { color: colors.foreground, backgroundColor: colors.background },
		".cm-content": { caretColor: colors.foreground },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: colors.foreground },
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#3a76c4" },
		".cm-gutters": { backgroundColor: colors.background, color: colors.foreground, borderRightColor: "currentColor" },
	}, { dark });
	const highlightStyle = HighlightStyle.define([
		{ tag: tags.keyword, color: colors.keyword },
		{ tag: tags.controlKeyword, color: colors.controlKeyword },
		{ tag: tags.definitionKeyword, color: colors.definitionKeyword },
		{ tag: tags.propertyName, color: colors.propertyName },
		{ tag: tags.number, color: colors.number },
		{ tag: tags.string, color: colors.string },
		{ tag: tags.atom, color: colors.atom },
		{ tag: tags.comment, color: colors.comment },
		{ tag: tags.lineComment, color: colors.comment },
	]);
	return [chrome, syntaxHighlighting(highlightStyle, { fallback: true })];
}
