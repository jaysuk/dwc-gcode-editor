/**
 * Small, self-contained editor actions ported from `MonacoEditor.vue`'s own toolbar, each usable as a
 * standalone function a host wires to its own button (no bundled UI, unlike `search.ts`/`diagnostics.ts`
 * — these have no CM6-native widget of their own to install).
 */

import type { ChangeSpec, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lexLine, type LexedCommand } from "dwc-gcode-core";

/** The command whose code span or trailing param region contains `posInLine` — the same lookup
 *  `completion.ts`'s own private `commandAt` already does for completions, exported here under its
 *  own name for a cursor-context use (unlike a completion source, this reads state once on demand,
 *  not on every keystroke). */
function commandAt(commands: ReadonlyArray<LexedCommand>, posInLine: number): LexedCommand | null {
	return commands.find((c) => posInLine >= c.start && posInLine <= c.end) ?? null;
}

/**
 * The G/M/T-code the cursor (or `pos`, if given) currently sits on or just past, or `null` if the
 * cursor isn't on a command — e.g. `MonacoEditor.vue`'s own `cursorCode`, which it uses to deep-link
 * its docs button into the matching per-code reference page. A host builds the actual reference URL
 * itself (`https://docs.duet3d.com/en/User_manual/Reference/Gcodes/<code>`) — this package doesn't
 * hardcode a documentation site, the same split `MonacoEditor.vue` itself has between `cursorCode`
 * (generic) and `gcodeReferenceUrl` (host-specific URL-building).
 */
export function codeAtCursor(view: EditorView, pos: number = view.state.selection.main.head): string | null {
	const line = view.state.doc.lineAt(pos);
	const lexed = lexLine(line.text);
	const cmd = commandAt(lexed.commands, pos - line.from);
	return cmd?.code ?? null;
}

/**
 * Aligns every line's trailing `;` comment onto a common column (the longest command on any commented
 * line, plus one space) — `MonacoEditor.vue`'s own `indentComments()`/DWC's `utils/display.ts`
 * `indent()`, ported faithfully for its actual algorithm (real source: `DuetWebControl/src/utils/
 * display.ts`) but built on `dwc-gcode-core`'s own `lexLine` for finding each line's real comment
 * start, instead of reimplementing quote/`{}`-aware `;`-scanning by hand (`lexLine`'s `comment` field
 * already does this correctly — the same reasoning `language.ts`'s own module doc comment gives for
 * reusing it rather than a hand-rolled tokeniser).
 *
 * A line whose comment starts at column 0 (a full-line, unindented comment - `lexed.comment.start ===
 * 0`) is left untouched and excluded from the column computation, matching DWC's own `indentIndex > 0`
 * checks exactly - there's no command to align a comment-only line against.
 *
 * **One deliberate deviation from DWC's own implementation**: that version rebuilds the whole file as
 * one string (`lines.join... newResult.trim()`), which as a side effect strips any leading/trailing
 * blank lines from the ENTIRE file - an accidental consequence of how it constructs its return value,
 * not a designed part of "align comments". This version dispatches one CM6 transaction containing only
 * the per-line changes that actually move a comment, so unrelated leading/trailing whitespace is never
 * touched. Still a single undo step, like Monaco's own `executeEdits`+`pushUndoStop`.
 *
 * Returns `false` (and dispatches nothing) if no line's comment actually needs to move - the same
 * `if (editor.getValue() !== indentedFile)` no-op guard `MonacoEditor.vue` itself has, so calling this
 * on an already-aligned file doesn't create an empty undo entry.
 */
export function alignLineComments(view: EditorView): boolean {
	const state: EditorState = view.state;
	const doc = state.doc;

	interface Commented { lineFrom: number; lineTo: number; text: string; commentStart: number; commandLength: number }
	const commented: Array<Commented> = [];
	let maxCommandLength = 0;

	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		const lexed = lexLine(line.text);
		if (lexed.comment === null || lexed.comment.start <= 0) continue;
		const commandLength = line.text.slice(0, lexed.comment.start).trimEnd().length;
		if (commandLength > maxCommandLength) maxCommandLength = commandLength;
		commented.push({ lineFrom: line.from, lineTo: line.to, text: line.text, commentStart: lexed.comment.start, commandLength });
	}

	const changes: Array<ChangeSpec> = [];
	for (const c of commented) {
		const command = c.text.slice(0, c.commentStart).trimEnd();
		const padded = command + " ".repeat(maxCommandLength + 1 - command.length);
		const newText = padded + c.text.slice(c.commentStart);
		if (newText !== c.text) changes.push({ from: c.lineFrom, to: c.lineTo, insert: newText });
	}

	if (changes.length === 0) return false;
	view.dispatch({ changes, userEvent: "input" });
	return true;
}
