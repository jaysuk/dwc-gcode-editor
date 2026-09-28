/**
 * `0:/sys/board.txt` (`FileKind: "board-config"`) support: highlighting, diagnostics and key
 * completion. board.txt is the STM32 firmware's per-board settings file - `key = value` and
 * `key = { a, b }`, NOT G-code - so `language.ts`'s `lexLine`-driven grammar would colour it as
 * nonsense (`sdcard.internal.type=1` is not a command). `dwc-gcode-core` (>= 1.26.0) ships the loader
 * port (`parseBoardTxt`) and the key table (`BOARD_TXT_KEYS`) but no tokeniser and no columns on its
 * problems, so this module adds only the missing per-line span walk, mirroring the loader's own
 * scanning (`files/boardTxt.ts`, itself a port of `BoardConfig.cpp` `GetConfigKeys`):
 *
 * - leading blanks, then `/`, `#` or `;` = comment to end of line (the same test after the key or
 *   after `=` ends the line there too);
 * - a key is a run of `[A-Za-z0-9._]`, then blanks, then `=`; a line without `=` is a loader error
 *   and gets nothing but the key colour;
 * - a value is a run of the same characters, a double-quoted string, or a `{ ... }` list of runs
 *   separated by `,`; text after the value is ignored by RRF, so it is only coloured when it is a
 *   comment.
 *
 * Only tags `language.ts` already uses are emitted (`propertyName` known key, `number`, `string`,
 * `atom` for pins/booleans/enumerators, `lineComment`), so `customTheme.ts`'s ten user colours and the
 * high-contrast theme cover board.txt with no new colour keys. An UNKNOWN key is deliberately left
 * uncoloured - it is exactly what the loader skips - and the diagnostics underline it.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion } from "@codemirror/autocomplete";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
	BOARD_TXT_KEYS,
	findBoardTxtKey,
	parseBoardTxt,
	type BoardTxtKey,
	type BoardTxtOptions,
	type BoardTxtProblem,
	type BoardTxtValueType,
} from "dwc-gcode-core";
import { gcodeLiveLinter } from "./diagnostics.js";

interface HighlightRange {
	from: number;
	to: number;
	tag: string;
}

const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";
const isCommentStart = (c: string | undefined): boolean => c === "/" || c === "#" || c === ";";
/** `IsValidChar` (`BoardConfig.cpp:1481-1486`). */
const isValueChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9._]/.test(c);

function skipBlanks(line: string, pos: number): number {
	while (pos < line.length && isBlank(line[pos])) pos++;
	return pos;
}

function valueTag(type: BoardTxtValueType | undefined): string | null {
	switch (type) {
		case "uint8": case "uint16": case "uint32": case "float": return "number";
		case "string": return "string";
		case "pin": case "bool": case "driver-type": case "module-type": return "atom";
		case undefined: return null;
	}
}

/** One board.txt line's highlight ranges in ascending `from` order. Exported so tests can assert on it
 *  without a full `StreamLanguage`/`EditorView`, same as `language.ts`'s `classifyLineForHighlight`. */
export function classifyBoardTxtLine(raw: string): ReadonlyArray<HighlightRange> {
	const ranges: Array<HighlightRange> = [];
	const len = raw.length;
	const comment = (from: number): void => {
		ranges.push({ from, to: len, tag: "lineComment" });
	};

	let pos = skipBlanks(raw, 0);
	if (pos >= len) return ranges;
	if (isCommentStart(raw[pos])) {
		comment(pos);
		return ranges;
	}

	const keyStart = pos;
	while (pos < len && isValueChar(raw[pos])) pos++;
	const entry = findBoardTxtKey(raw.slice(keyStart, pos));
	if (pos > keyStart && entry !== undefined) ranges.push({ from: keyStart, to: pos, tag: "propertyName" });

	pos = skipBlanks(raw, pos);
	if (pos < len && isCommentStart(raw[pos])) {
		comment(pos);
		return ranges;
	}
	if (pos >= len || raw[pos] !== "=") return ranges;

	pos = skipBlanks(raw, pos + 1);
	if (pos < len && isCommentStart(raw[pos])) {
		comment(pos);
		return ranges;
	}
	const tag = valueTag(entry?.type);

	if (raw[pos] === "{") {
		pos++;
		for (;;) {
			pos = skipBlanks(raw, pos);
			if (pos >= len) return ranges;
			if (isCommentStart(raw[pos])) {
				comment(pos);
				return ranges;
			}
			if (raw[pos] === "}") {
				pos++;
				break;
			}
			const start = pos;
			while (pos < len && isValueChar(raw[pos])) pos++;
			if (pos > start && tag !== null) ranges.push({ from: start, to: pos, tag });
			pos = skipBlanks(raw, pos);
			// The loader only accepts ',' or '}' after an entry; anything else discards the whole list.
			if (raw[pos] === ",") pos++;
			else if (raw[pos] !== "}") return ranges;
		}
	} else if (raw[pos] === "\"") {
		const start = pos;
		pos++;
		while (pos < len && raw[pos] !== "\"") pos++;
		if (pos < len) pos++; // the closing quote
		ranges.push({ from: start, to: pos, tag: "string" });
	} else {
		const start = pos;
		while (pos < len && isValueChar(raw[pos])) pos++;
		if (pos > start && tag !== null) ranges.push({ from: start, to: pos, tag });
	}

	// RRF ignores everything after the value; only a comment is worth colouring.
	pos = skipBlanks(raw, pos);
	if (pos < len && isCommentStart(raw[pos])) comment(pos);
	return ranges;
}

interface BoardTxtStreamState {
	raw: string | null;
	ranges: ReadonlyArray<HighlightRange>;
}

const boardTxtStreamParser: StreamParser<BoardTxtStreamState> = {
	startState: () => ({ raw: null, ranges: [] }),
	// The loader's own comment starts are `/`, `#` and `;`; `;` is what every real board file uses.
	languageData: { commentTokens: { line: ";" } },
	token(stream, state) {
		if (stream.sol() || state.raw !== stream.string) {
			state.raw = stream.string;
			state.ranges = classifyBoardTxtLine(stream.string);
		}
		const pos = stream.pos;
		const range = state.ranges.find((r) => pos >= r.from && pos < r.to);
		if (range === undefined) {
			stream.next();
			return null;
		}
		stream.pos = range.to;
		return range.tag;
	},
};

/** A CM6 language for `board.txt` (and `rrfboot.txt`, which the same loader reads). */
export const boardTxtLanguage = StreamLanguage.define(boardTxtStreamParser);

/** Start offset of each physical line, splitting on `\r\n`, `\r` or `\n` like the loader. */
function lineStarts(text: string): Array<number> {
	const starts = [0];
	const terminator = /\r\n|\r|\n/g;
	for (let m = terminator.exec(text); m !== null; m = terminator.exec(text)) starts.push(m.index + m[0].length);
	return starts;
}

function problemSeverity(problem: BoardTxtProblem): CmDiagnostic["severity"] {
	// Every problem is a line RRF skips (debug output only reaches USB serial) - a warning, except an
	// empty `{}` which is legal and merely sets nothing.
	return problem.kind === "empty-array" ? "info" : "warning";
}

/**
 * `parseBoardTxt`'s problems as CM6 diagnostics. `dwc-gcode-core` reports a 1-based LINE, not a
 * column, so each diagnostic underlines that line's content (leading blanks excluded). A document
 * that ends without a newline still has its last line; a problem past the end is dropped rather
 * than clamped onto the wrong line.
 */
export function boardTxtDiagnostics(text: string, options: BoardTxtOptions = {}): Array<CmDiagnostic> {
	const starts = lineStarts(text);
	const out: Array<CmDiagnostic> = [];
	for (const problem of parseBoardTxt(text, options).problems) {
		const lineStart = starts[problem.line - 1];
		if (lineStart === undefined) continue;
		const lineEnd = problem.line < starts.length ? starts[problem.line]! : text.length;
		let end = lineEnd;
		while (end > lineStart && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
		let from = lineStart;
		while (from < end && isBlank(text[from])) from++;
		if (from === end) from = lineStart; // never emit an empty range
		out.push({ from, to: Math.max(end, from), severity: problemSeverity(problem), message: problem.message, source: problem.kind });
	}
	return out;
}

/** Live linting for a board file - small by nature (a few hundred lines at most), so unlike
 *  `diagnostics.ts`'s note about G-code, re-parsing on every change is fine. */
export function boardTxtLiveLinter(options: BoardTxtOptions = {}): Extension {
	return gcodeLiveLinter((view: EditorView) => boardTxtDiagnostics(view.state.doc.toString(), options));
}

function describeKey(entry: BoardTxtKey): string {
	return entry.count > 1 ? `${entry.type} list (max ${entry.count})` : entry.type;
}

const KEY_COMPLETIONS: ReadonlyArray<Completion> = BOARD_TXT_KEYS.map((entry) => ({
	label: entry.key,
	type: "property",
	detail: describeKey(entry),
	// Insert the assignment operator too, in the shape the key wants (cursor inside a list's braces).
	apply: (view: EditorView, _completion: Completion, from: number, to: number): void => {
		const insert = entry.count > 1 ? `${entry.key} = {}` : `${entry.key} = `;
		view.dispatch({
			changes: { from, to, insert },
			selection: { anchor: from + (entry.count > 1 ? insert.length - 1 : insert.length) },
			userEvent: "input.complete",
		});
	},
}));

/** Key-name completion at the start of a line (before any `=`). Values are not completed. */
export function boardTxtKeySource(context: CompletionContext): CompletionResult | null {
	const line = context.state.doc.lineAt(context.pos);
	const before = line.text.slice(0, context.pos - line.from);
	if (before.includes("=")) return null;
	const word = /[A-Za-z0-9._]*$/.exec(before)![0];
	if (before.slice(0, before.length - word.length).trim() !== "") return null;
	if (word === "" && !context.explicit) return null;
	return { from: context.pos - word.length, options: KEY_COMPLETIONS as Array<Completion>, validFor: /^[A-Za-z0-9._]*$/ };
}

/** Completion of `board.txt` key names, with `= ` / `= {}` filled in. */
export function boardTxtCompletion(): Extension {
	return autocompletion({ override: [boardTxtKeySource] });
}
