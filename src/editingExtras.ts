/**
 * Small, independent, opt-in visual extensions — word wrap and whitespace rendering from the scope
 * table's "Word wrap, indent guides, whitespace rendering | Keep (cheap)" row (indent guides are not
 * here: CM6's own core packages, `@codemirror/view`/`@codemirror/language`, have no built-in visual
 * indent-guide renderer — see the package `CLAUDE.md`'s Status entry for where that stands).
 *
 * Both are exported separately, not folded into `editorCore.ts`'s always-on `BASE_EDITING_EXTENSIONS`,
 * because unlike undo/redo or comment-toggling they change how the document *looks* by default and
 * Monaco itself does not enable either one unconditionally (`wordWrap: "off"`,
 * `renderWhitespace: "selection"`) — a host opts in the same way it already opts into `gcodeLanguage`
 * or `gcodeCompletion()`.
 */

import { highlightTrailingWhitespace, highlightWhitespace } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

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
