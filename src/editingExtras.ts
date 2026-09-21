/**
 * Small, independent, opt-in visual extensions from the scope table's "Word wrap, indent guides,
 * whitespace rendering | Keep (cheap)" row.
 *
 * All three are exported separately, not folded into `editorCore.ts`'s always-on
 * `BASE_EDITING_EXTENSIONS`, because unlike undo/redo or comment-toggling they change how the
 * document *looks* by default and Monaco itself does not enable any of them unconditionally
 * (`wordWrap: "off"`, `renderWhitespace: "selection"`, and indent guides are Monaco's own separate
 * `renderIndentGuides` setting) — a host opts in the same way it already opts into `gcodeLanguage` or
 * `gcodeCompletion()`.
 */

import { highlightTrailingWhitespace, highlightWhitespace } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { getIndentUnit } from "@codemirror/language";

/** Wraps long lines at the viewport edge instead of scrolling horizontally — CM6's own
 *  `EditorView.lineWrapping`, re-exported here so a consumer doesn't need its own `@codemirror/view`
 *  import just for this one flag. */
export const gcodeLineWrapping: Extension = EditorView.lineWrapping;

/** Faint dots for spaces, arrows for tabs (`highlightWhitespace`'s own default rendering), plus a
 *  highlighted `cm-trailingSpace` class on trailing whitespace. Both are CM6 built-ins with no
 *  configuration surface (verified against the installed `@codemirror/view`'s own `.d.ts` — neither
 *  function takes an argument), bundled into one extension since the scope table treats "whitespace
 *  rendering" as a single conceptual toggle. */
export function gcodeWhitespaceRendering(): Extension {
	return [highlightWhitespace(), highlightTrailingWhitespace()];
}

const indentGuideMark = Decoration.mark({ class: "cm-gcodeIndentGuide" });

/**
 * Hand-rolled, not a third-party dependency: none of the installed `@codemirror/*` packages ship a
 * visual indent-guide renderer (checked directly — `@codemirror/language` only exports indent
 * *computation*: `getIndentUnit`, `indentService`, etc., nothing that paints a line), and pulling in
 * an unverified community package would break this family's own rule of only trusting installed,
 * inspected source. Deliberately narrow scope, matching conditional G-code's actual shape (hand-typed
 * `if`/`while`/`elif` blocks, conventionally indented with spaces — RRF itself has no opinion on
 * indentation and G-code motion commands are otherwise flat): marks the first character of every
 * `getIndentUnit(state)`-wide run of LEADING space/tab characters with a class that draws a thin
 * `border-left`, so consecutive lines' guides line up in a monospace font. Blank lines (no content
 * after the leading whitespace) get no guides, matching how most indent-guide implementations treat
 * them. Column counting treats every leading whitespace character (space or tab) as one column for
 * guide-boundary purposes — a real simplification for tab-indented files (a tab's rendered width
 * depends on `EditorState.tabSize`, not 1), accepted because G-code macros in practice are
 * space-indented; a tab-indented file still gets guides, just not perfectly column-aligned ones.
 */
class IndentGuidePlugin {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildIndentGuides(view);
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = buildIndentGuides(update.view);
		}
	}
}

function buildIndentGuides(view: EditorView): DecorationSet {
	const unit = getIndentUnit(view.state);
	const builder = new RangeSetBuilder<Decoration>();
	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			const text = line.text;
			const leadingMatch = /^[ \t]*/.exec(text);
			const leadingLength = leadingMatch !== null ? leadingMatch[0].length : 0;
			if (leadingLength > 0 && leadingLength < text.length) {
				for (let col = unit; col < leadingLength; col += unit) {
					const p = line.from + col;
					builder.add(p, p + 1, indentGuideMark);
				}
			}
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

const indentGuideTheme = EditorView.baseTheme({
	".cm-gcodeIndentGuide": { boxShadow: "-1px 0 0 var(--gcode-indent-guide-color, rgba(128, 128, 128, 0.35)) inset" },
});

/** One vertical guide line per `getIndentUnit(state)`-wide indent level, on lines with actual
 *  leading indentation and non-whitespace content — see `IndentGuidePlugin`'s own doc comment for
 *  what this deliberately does and doesn't handle. */
export function gcodeIndentGuides(): Extension {
	return [
		indentGuideTheme,
		ViewPlugin.fromClass(IndentGuidePlugin, { decorations: (v) => v.decorations }),
	];
}
