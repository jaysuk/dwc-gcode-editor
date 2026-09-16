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

interface HighlightRange {
	from: number;
	to: number;
	tag: string;
}

const CONTROL_META_KEYWORDS = new Set(["if", "elif", "else", "while", "break", "continue", "abort", "skip"]);
const DEFINITION_META_KEYWORDS = new Set(["var", "global", "set"]);

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
	}

	for (const cmd of lexed.commands) {
		ranges.push({ from: cmd.start, to: cmd.start + cmd.code.length, tag: "keyword" });
		for (const p of cmd.params) {
			ranges.push({ from: p.start, to: p.valueStart, tag: "propertyName" });
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
