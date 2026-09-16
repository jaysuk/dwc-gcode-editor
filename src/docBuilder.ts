/**
 * Build a CM6 `Text` incrementally from a stream of already-decoded text chunks — productionising
 * the pattern verified in `docs/gcode-editor-plan.md`'s stop-point-2 spike: never concatenate the
 * whole file into one JS string, matching `duet-gcode-postprocessor`'s own chunked-Blob-reader
 * shape (`transfer.ts`) rather than Monaco's `createModel(value: string)`, which requires exactly
 * that concatenation to have already happened before it is ever called.
 *
 * Host-agnostic on purpose: takes a plain `AsyncIterable<string>` of decoded chunks, not a `Blob`,
 * `ReadableStream`, or fetch `Response` — a host adapts whatever it already reads with (a chunked
 * Blob reader, a `fetch` body, a machine-file download) into that shape. See the module doc comment
 * in `docs/gcode-editor-plan.md`'s stop point 2 for the honest caveat this does NOT solve: the
 * resulting `Text` still holds the whole file's content resident in memory (~2.8× its raw size, per
 * that write-up's real measurement) — this function avoids the single-giant-string cost, not the
 * "hold the whole document" one. A genuinely huge file opened purely to view/diagnose should use a
 * different, windowed strategy instead of this function — noted as still-open, separate work there.
 */

import { Text } from "@codemirror/state";

export interface BuildDocOptions {
	/** Flush accumulated lines into the growing `Text` tree once this many characters have been
	 *  buffered, rather than holding the whole file as one pending line array before a single
	 *  `Text.of()` call. Default 200,000 (a few hundred KB) — small enough to keep peak transient
	 *  memory bounded, large enough that the number of `append()` calls stays trivial even on a
	 *  200 MB file (~1,000 appends, not one per source chunk). */
	flushAtChars?: number;
}

const DEFAULT_FLUSH_AT_CHARS = 200_000;

/**
 * Build a `Text` from decoded chunks, splitting on `\n` across chunk boundaries correctly (a line
 * split across two chunks is not lost or duplicated) and preserving every byte — the final,
 * possibly-partial line (no trailing newline) is included.
 */
export async function buildDocFromChunks(chunks: AsyncIterable<string>, options: BuildDocOptions = {}): Promise<Text> {
	const flushAtChars = options.flushAtChars ?? DEFAULT_FLUSH_AT_CHARS;

	let doc = Text.empty;
	let carry = "";
	let pending: Array<string> = [];
	let pendingChars = 0;
	// `Text.append` joins raw content with no separator of its own — verified empirically:
	// `Text.of(["line1","line2"]).append(Text.of(["line3","line4"]))` is `"line1\nline2line3\nline4"`,
	// fusing line2 and line3 into one line. Every flush after the first must therefore supply its
	// own leading "\n" (an empty string as the first element of the next `Text.of` array) to bridge
	// the seam, or two flushes fuse their boundary lines into one.
	let hasFlushed = false;

	function flush(): void {
		if (pending.length === 0) return;
		const batch = hasFlushed ? ["", ...pending] : pending;
		doc = doc.append(Text.of(batch));
		hasFlushed = true;
		pending = [];
		pendingChars = 0;
	}

	for await (const chunk of chunks) {
		const text = carry + chunk;
		const parts = text.split("\n");
		carry = parts.pop() ?? "";
		for (const line of parts) {
			pending.push(line);
			pendingChars += line.length + 1;
		}
		if (pendingChars >= flushAtChars) flush();
	}
	// Always push the final carry, even when empty: `"a\n".split("\n")` is `["a", ""]` — that
	// trailing empty string is what distinguishes a file ending WITH a newline from one that
	// doesn't, and dropping it when empty silently discarded that distinction.
	pending.push(carry);
	flush();

	return doc;
}

/** Convenience for tests/small files/paste-in content: wraps a single string as the one chunk this
 *  function needs. Never use this for a real large file — it defeats the whole point by requiring
 *  the caller to already hold the file as one string, exactly the case this module exists to avoid. */
export async function buildDocFromString(text: string): Promise<Text> {
	return buildDocFromChunks((async function* () { yield text; })());
}
