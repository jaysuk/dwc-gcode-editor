/**
 * G-code syntax highlighting, driven by `dwc-gcode-core`'s real, RRF-faithful `lexLine` rather than
 * a hand-rolled regex tokeniser — the same reasoning `dwc-gcode-postprocessor`'s own `splitCommands`
 * used: `lexLine` already does the real, correct parsing, so this module's only job is mapping its
 * structured spans onto CM6's highlighting tags.
 *
 * Built as a `StreamLanguage` rather than a full Lezer grammar: `lexLine` already parses a whole line
 * at once into spans, so `token()` re-lexes the line exactly once (cached in the stream's own state,
 * keyed on `stream.sol()`) and then just steps through the precomputed ranges — no need for a
 * character-by-character grammar when the real parser already exists and works line-at-a-time.
 *
 * Tag choices verified against `@lezer/highlight`'s own exported `tags` object (its `.d.ts`) rather
 * than guessed — `StreamLanguage`'s token-table (`@codemirror/language`'s `createTokenType`) looks
 * every returned string straight up as `tags[name]`, so an invented name silently highlights nothing
 * and logs a console warning instead of failing a build.
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { lexLine, type LexedLine, type ParamKind } from "dwc-gcode-core";

export interface HighlightRange {
	from: number;
	to: number;
	tag: string;
}

const CONTROL_META_KEYWORDS = new Set(["if", "elif", "else", "while", "break", "continue", "abort", "skip"]);
const DEFINITION_META_KEYWORDS = new Set(["var", "global", "set"]);

/** Root names of RRF's user-variable namespaces (`global.x`, `var.x`, `param.X`, `local.x`) — coloured
 *  like a declaration keyword so a variable reference visibly differs from an object-model path
 *  (`move.axes[0].homed`), which is coloured as a plain property. */
const VARIABLE_NAMESPACES = new Set(["global", "var", "param", "local"]);
/** RRF's expression literals and its read-only special variables — never a function or a path. */
const EXPRESSION_LITERALS = new Set(["true", "false", "null", "pi", "iterations", "result", "line", "input"]);

const NUMBER_RE = /0[xX][0-9a-fA-F]+|0[bB][01]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isIdentStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isIdentPart = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);

/**
 * Tokenise the text of one RRF expression (`raw[from, to)`) — the body of a `{...}` parameter or of
 * a meta line such as `if`/`while`/`var`/`set`/`echo`. `lexLine` deliberately stops at "this span is
 * an expression" (a parameter's `kind: "expression"`, or a meta line's bare keyword), so without
 * this every name inside stayed one flat colour, or (for meta lines) uncoloured entirely.
 *
 * - a name followed by `(` is a function (`exists`, `abs`, `max`, ...) -> `keyword`
 * - `global`/`var`/`param`/`local` -> `definitionKeyword`; each `.name` after any path root -> `propertyName`
 * - other bare paths (`move.axes[0].homed`) -> `propertyName`
 * - `true`/`false`/`null`/`pi`/`iterations`/... -> `atom`; numbers/strings as themselves
 * - `[...]` index expressions are tokenised recursively (`global.list[global.i]`)
 */
export function classifyExpression(raw: string, from: number, to: number, out: Array<HighlightRange>): void {
	let i = from;
	while (i < to) {
		const c = raw[i];
		if (c === '"') {
			let j = i + 1;
			while (j < to) {
				if (raw[j] === '"') {
					if (raw[j + 1] === '"') { j += 2; continue; } // RRF's doubled-quote escape
					j++;
					break;
				}
				j++;
			}
			out.push({ from: i, to: j, tag: "string" });
			i = j;
		} else if (isDigit(c) || (c === "." && isDigit(raw[i + 1]))) {
			NUMBER_RE.lastIndex = i;
			const m = NUMBER_RE.exec(raw);
			const end = m === null ? i + 1 : Math.min(to, i + m[0].length);
			out.push({ from: i, to: end, tag: "number" });
			i = end;
		} else if (isIdentStart(c)) {
			i = classifyPath(raw, i, to, out);
		} else {
			i++;
		}
	}
}

/** One name plus its `.name` / `[index]` continuation; returns the index just past it. */
function classifyPath(raw: string, start: number, to: number, out: Array<HighlightRange>): number {
	let i = start;
	while (i < to && isIdentPart(raw[i])) i++;
	const word = raw.slice(start, i);

	let k = i;
	while (raw[k] === " " || raw[k] === "	") k++;
	if (raw[k] === "(" && k < to) {
		out.push({ from: start, to: i, tag: "keyword" });
		return i;
	}
	if (EXPRESSION_LITERALS.has(word)) {
		out.push({ from: start, to: i, tag: "atom" });
		return i;
	}
	out.push({ from: start, to: i, tag: VARIABLE_NAMESPACES.has(word) ? "definitionKeyword" : "propertyName" });

	for (;;) {
		if (raw[i] === "[" && i < to) {
			let depth = 1;
			let j = i + 1;
			while (j < to && depth > 0) {
				if (raw[j] === "[") depth++;
				else if (raw[j] === "]") depth--;
				j++;
			}
			classifyExpression(raw, i + 1, depth === 0 ? j - 1 : j, out);
			i = j;
		} else if (raw[i] === "." && i + 1 < to && isIdentStart(raw[i + 1])) {
			const nameStart = i + 1;
			i = nameStart;
			while (i < to && isIdentPart(raw[i])) i++;
			out.push({ from: nameStart, to: i, tag: "propertyName" });
		} else {
			return i;
		}
	}
}

/** One line's highlight ranges, in ascending `from` order (the order callers need to step through
 *  them left to right) — exported mainly so `test/language.test.ts` can assert on it directly
 *  without going through a full `StreamLanguage`/`EditorView`. */
export function classifyLineForHighlight(raw: string): ReadonlyArray<HighlightRange> {
	const lexed = lexLine(raw);
	const ranges: Array<HighlightRange> = [];

	if (lexed.meta !== null) {
		const tag = CONTROL_META_KEYWORDS.has(lexed.meta) ? "controlKeyword"
			: DEFINITION_META_KEYWORDS.has(lexed.meta) ? "definitionKeyword"
			: "keyword"; // "echo" - a statement, neither control flow nor a declaration
		ranges.push({ from: lexed.indent, to: lexed.indent + lexed.meta.length, tag });
		// `lexLine` stops at the keyword; the rest of the line is an expression (or, for `var`/
		// `global`, a name followed by one) that only this module can colour.
		const bodyEnd = lexed.comment !== null ? lexed.comment.start : raw.length;
		classifyExpression(raw, lexed.indent + lexed.meta.length, bodyEnd, ranges);
	}

	for (const cmd of lexed.commands) {
		ranges.push({ from: cmd.start, to: cmd.start + cmd.code.length, tag: "keyword" });
		for (const p of cmd.params) {
			ranges.push({ from: p.start, to: p.valueStart, tag: "propertyName" });
			if (p.kind === "expression") {
				classifyBracedExpression(raw, p.valueStart, p.end, ranges);
				continue;
			}
			const valueTag = paramValueTag(p.kind);
			if (valueTag !== null && p.end > p.valueStart) ranges.push({ from: p.valueStart, to: p.end, tag: valueTag });
		}
		if (cmd.stringArgument !== null && cmd.stringArgument.end > cmd.stringArgument.start) {
			ranges.push({ from: cmd.stringArgument.start, to: cmd.stringArgument.end, tag: "string" });
		}
	}

	for (const c of lexed.bracketedComments) ranges.push({ from: c.start, to: c.end, tag: "comment" });
	if (lexed.comment !== null) ranges.push({ from: lexed.comment.start, to: lexed.comment.end, tag: "lineComment" });

	ranges.sort((a, b) => a.from - b.from);
	return ranges;
}

/** A `{...}` parameter value: braces stay `atom` (as the whole span was before), the inside is
 *  tokenised. Tolerates an unterminated `{` — the user is mid-typing. */
function classifyBracedExpression(raw: string, from: number, to: number, out: Array<HighlightRange>): void {
	if (to <= from) return;
	const closed = raw[to - 1] === "}" && to - 1 > from;
	out.push({ from, to: from + 1, tag: "atom" });
	classifyExpression(raw, from + 1, closed ? to - 1 : to, out);
	if (closed) out.push({ from: to - 1, to, tag: "atom" });
}

function paramValueTag(kind: ParamKind): string | null {
	switch (kind) {
		case "number": case "list": return "number";
		case "string": return "string";
		case "expression": return "atom";
		case "empty": case "other": return null;
	}
}

interface LineCache {
	/** The raw line text this cache was built from — recomputed if a stream somehow sees a
	 *  different line at the same cached position (should not happen in practice, but cheap to
	 *  guard rather than assume). */
	raw: string;
	ranges: ReadonlyArray<HighlightRange>;
}

interface StreamState {
	cache: LineCache | null;
}

const gcodeStreamParser: StreamParser<StreamState> = {
	startState: () => ({ cache: null }),

	/**
	 * `commentTokens` is what `@codemirror/commands`' `toggleComment` (already bound to `Mod-/` by
	 * `defaultKeymap`, which `editorCore.ts`'s `BASE_EDITING_EXTENSIONS` always includes) reads to
	 * know what a line comment looks like — without this, that binding was already live but had no
	 * comment syntax to work with, so it silently did nothing. `closeBrackets` is
	 * `@codemirror/autocomplete`'s own language-data key (`CloseBracketConfig`) for `closeBrackets()`;
	 * scoped to `{` only (not the extension's default `["(","[","{","'",'"']`) because `{expression}`
	 * is the only real bracket syntax in conditional G-code — auto-closing `"` would fight typing a
	 * quoted filename argument (e.g. `M28 "file.g"`), which was never asked for.
	 */
	languageData: {
		commentTokens: { line: ";" },
		closeBrackets: { brackets: ["{"] },
	},

	token(stream, state) {
		if (stream.sol() || state.cache === null || state.cache.raw !== stream.string) {
			state.cache = { raw: stream.string, ranges: classifyLineForHighlight(stream.string) };
		}
		const pos = stream.pos;
		const range = state.cache.ranges.find((r) => pos >= r.from && pos < r.to);
		if (range === undefined) {
			stream.next();
			return null;
		}
		stream.pos = range.to;
		return range.tag;
	},
};

/** A CM6 language usable directly as an editor extension (`gcodeLanguage.extension` or just the
 *  value itself — `StreamLanguage` instances ARE `Extension`s). */
export const gcodeLanguage = StreamLanguage.define(gcodeStreamParser);

// Re-exported so a consumer never needs its own import of dwc-gcode-core just to read this type.
export type { LexedLine };
