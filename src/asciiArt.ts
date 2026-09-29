/**
 * ASCII-art banners, inserted as G-code comments.
 *
 * The feature request's own reference (`github.com/budavariam/asciiart-text`) turned out, on
 * inspection (its real `package.json`/README, not assumed), to be a small showcase *app* built around
 * a font picker — the actual FIGfont rendering underneath is `figlet` (`patorjk/figlet.js`), a
 * `devDependency` of that showcase. `figlet` is the real, maintained implementation of the FIGfont
 * spec, works in a browser with zero runtime dependency of its own (its one `dependencies` entry,
 * `commander`, is only wired into its Node CLI binary — never imported by the library build this
 * module pulls in, confirmed against its real `package.json` before adding it), and already ships a
 * documented browser recipe (its own README, "Getting Started - Browser with ES modules") this module
 * follows rather than reinventing FIGfont parsing by hand — the same "prefer a real, maintained
 * library over a hand-rolled reimplementation when one genuinely fits" call `theme.ts` already made
 * for `@codemirror/theme-one-dark`.
 *
 * **Only the `"Standard"` font is bundled** (`figlet/fonts/Standard`, parsed once at module load via
 * `figlet.parseFont` — exactly that README recipe). Importing figlet's full `importable-fonts`
 * collection wholesale would drag in dozens of font files this package has no way to know a host
 * wants. `listAsciiArtFonts`/`parseAsciiArtFont`/`preloadAsciiArtFonts` (thin, direct wrappers around
 * figlet's own same-named functions — never letting `this`-binding assumptions leak in, everything
 * below calls back through the `figlet` object explicitly) let a host add more without this module
 * ever deciding to fetch a font over the network itself — matching `diagnostics.ts`'s own established
 * "no background cost the caller didn't ask for" rule.
 *
 * Every rendered line becomes its own full-line `;` comment — `language.ts`'s own
 * `languageData.commentTokens.line`, confirmed there rather than assumed — so the art can never be
 * misread as G-code; FIGlet banners routinely contain `/`, `\`, `|`, `(`, `)`, none of which need
 * escaping inside a comment that runs to end of line. FIGlet pads rows with trailing spaces to a
 * common width — trimmed before the comment marker is added, matching this package's existing
 * distaste for introducing trailing whitespace (`editingExtras.ts`'s own
 * `highlightTrailingWhitespace`); a row that's entirely padding becomes a bare `;`, not `; ` with a
 * dangling space.
 */

import figlet, { type FigletOptions, type FontMetadata, type FontName } from "figlet";
import standardFontData from "figlet/fonts/Standard";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

figlet.parseFont("Standard", standardFontData);

/** Every field `figlet.textSync` itself accepts — `font` defaults to `"Standard"` (this module's own
 *  bundled default) when omitted, everything else is figlet's own default. */
export type AsciiArtOptions = FigletOptions;

/**
 * Renders `text` as a FIGlet banner and wraps every line as its own `;` comment, ready to insert
 * as-is. Pure — no document or DOM access — so it's usable and testable standalone, independent of
 * `insertAsciiArt`.
 */
export function renderAsciiArt(text: string, options: AsciiArtOptions = {}): string {
	const art = figlet.textSync(text, { font: "Standard", ...options });
	return art
		.split("\n")
		.map((line) => {
			const trimmed = line.replace(/\s+$/, "");
			return trimmed.length === 0 ? ";" : `; ${trimmed}`;
		})
		.join("\n");
}

/**
 * Inserts `renderAsciiArt`'s output in place of every current selection range (multi-cursor safe —
 * built on `EditorState.changeByRange`, the documented way to apply one logical edit across several
 * ranges without hand-computing how each earlier insert shifts the ones after it). The block always
 * lands on clean lines of its own: a newline is added before it unless the range already starts at
 * column 0, and one after unless it already ends at a line's end — so inserting mid-line splits that
 * line around the banner instead of fusing text onto its first or last row. The cursor ends up right
 * after the inserted block. No-op (returns `false`, dispatches nothing) on a read-only state or when
 * `text` renders to nothing.
 */
export function insertAsciiArt(view: EditorView, text: string, options: AsciiArtOptions = {}): boolean {
	if (view.state.readOnly) return false;
	const art = renderAsciiArt(text, options);
	if (art.length === 0) return false;

	const doc = view.state.doc;
	const tr = view.state.changeByRange((range) => {
		const lineStart = doc.lineAt(range.from);
		const lineEnd = doc.lineAt(range.to);
		const before = range.from === lineStart.from ? "" : "\n";
		const after = range.to === lineEnd.to ? "" : "\n";
		const insert = `${before}${art}${after}`;
		const changes: ChangeSpec = { from: range.from, to: range.to, insert };
		return { changes, range: EditorSelection.cursor(range.from + insert.length) };
	});

	view.dispatch(view.state.update(tr, { scrollIntoView: true, userEvent: "input" }));
	return true;
}

/** Every font name `figlet` already knows about without fetching anything — the bundled
 *  `"Standard"` plus any a host has already loaded via `parseAsciiArtFont`/`preloadAsciiArtFonts`. */
export function listAsciiArtFonts(): ReadonlyArray<FontName> {
	return figlet.fontsSync();
}

/** Registers a font from its already-loaded `.flf` file contents (a host's own bundled font, the
 *  same way this module bundles `"Standard"`) — synchronous, no network access. */
export function parseAsciiArtFont(font: FontName, data: string): FontMetadata {
	return figlet.parseFont(font, data);
}

/** Fetches and registers one or more fonts by name over the network (figlet's own `preloadFonts`,
 *  against whatever `fontPath` figlet's own `defaults()` is currently set to) — the one function
 *  here that reaches the network, so a host opts into it explicitly rather than this module ever
 *  doing so on its own. */
export function preloadAsciiArtFonts(fonts: ReadonlyArray<FontName>): Promise<void> {
	return figlet.preloadFonts([...fonts]);
}
