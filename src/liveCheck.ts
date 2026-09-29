/**
 * Live error checking that follows the lines being typed on, instead of re-checking the whole file.
 *
 * `diagnostics.ts` explains why a `linter()` that re-runs `diagnoseDocument` over the whole document on
 * every change is unaffordable for a large file. Nearly every rule in `dwc-gcode-core` looks at one line
 * at a time (`syntax/*`, `dictionary/*`, `objectModel/*`, `structure/macro-command-not-last`,
 * `structure/capitalised-meta-keyword` each loop over lines independently), so a line can be checked on
 * its own — about 0.01 ms, whatever the size of the file. This extension does that, in three steps:
 *
 * 1. **A line you have left** (Enter, a click or arrow into another line) is re-checked almost at once
 *    (`leftDelayMs`), so nothing flickers while a word is half typed.
 * 2. **The line the cursor is still on** is re-checked after a pause (`activeDelayMs`).
 * 3. **The whole file** is re-checked after a longer pause (`fullDelayMs`) — only for files up to
 *    `fullCheckMaxChars` — because a few rules need the surrounding lines and cannot be run on one line:
 *    `else`/`elif` without an `if`, `break`/`continue` outside a loop, mixed indentation.
 *
 * The single-line pass replaces only the diagnostics on the lines it checked; the rest of the file's
 * squiggles (from the on-load check, the button, or the full pass) are left in place and move with the
 * text. It removes the block-structure diagnostics on a line it re-checks (they come back at the next
 * full pass), so on a file over `fullCheckMaxChars` a block-structure error on an edited line stays
 * cleared until the manual check.
 *
 * **Files that use `M453`** (switching to laser/CNC mode) skip the single-line pass entirely: core lexes
 * each line in the machine mode set by the lines above it, so a line on its own can be read wrongly.
 * Those files get the full pass only.
 *
 * Needs `gcodeLintUi()` (or any `@codemirror/lint` setup) in the same editor.
 */

import { forEachDiagnostic, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from "@codemirror/view";
import { diagnoseDocument, parseDocument } from "dwc-gcode-core";
import { checkDocument, toCmDiagnostics, type CheckDocumentOptions } from "./diagnostics.js";

/** `DocumentError` codes that depend on the lines around a line (block nesting, indentation seen so
 *  far), so a line parsed alone would report them wrongly — `else` on its own is "else without if". */
const BLOCK_ERROR_CODES: ReadonlySet<string> = new Set([
	"elif-without-if", "else-without-if", "else-after-else", "break-outside-loop", "continue-outside-loop", "mixed-indentation",
]);

/**
 * The diagnostics for one line, checked on its own, positioned at `lineFrom` in the editor's document.
 * Leaves out the block-structure errors (see `BLOCK_ERROR_CODES`); everything else is what
 * `diagnoseDocument` reports for that line inside the whole file (a test asserts this against a real
 * fixture). Exported so a host can check a line it is about to insert.
 */
export function diagnoseLine(text: string, lineFrom: number, options: CheckDocumentOptions): Array<CmDiagnostic> {
	const parsed = parseDocument(text);
	const doc = { ...parsed, errors: parsed.errors.filter((e) => !BLOCK_ERROR_CODES.has(e.code)) };
	const found = diagnoseDocument(doc, options.path, { firmwareVersion: options.firmwareVersion ?? "0.0.0" });
	return toCmDiagnostics(found).map((d) => ({ ...d, from: d.from + lineFrom, to: d.to + lineFrom }));
}

export interface LiveCheckOptions {
	/** The file's path and target firmware, read at each check (a thunk: the machine model may arrive later). */
	getOptions: () => CheckDocumentOptions;
	/** Called after every check with how many diagnostics the editor now holds. */
	onChange?: (count: number) => void;
	/** Delay before a line the cursor has left is re-checked. Default 100. */
	leftDelayMs?: number;
	/** Delay after the last keystroke before the line the cursor is on is re-checked. Default 1000. */
	activeDelayMs?: number;
	/** Delay after the last keystroke before the whole file is re-checked. Default 1500. */
	fullDelayMs?: number;
	/** Largest document (characters) that gets the whole-file pass. Default 500,000 (about 0.2 s of work). */
	fullCheckMaxChars?: number;
	/** An edit touching more lines than this (a huge paste) skips the single-line pass. Default 2000. */
	maxLines?: number;
}


class LiveCheck implements PluginValue {
	/** Positions (kept current through edits) of text changed since the lines around it were last checked. */
	private dirty: Array<[number, number]> = [];
	private wholeFilePending = false;
	/** Whether the document uses `M453`; `null` until first needed (scanning a huge file costs a moment). */
	private usesModeSwitch: boolean | null = null;
	private leftTimer: ReturnType<typeof setTimeout> | undefined;
	private activeTimer: ReturnType<typeof setTimeout> | undefined;
	private fullTimer: ReturnType<typeof setTimeout> | undefined;
	private destroyed = false;
	private readonly o: {
		getOptions: () => CheckDocumentOptions; onChange: ((count: number) => void) | undefined;
		leftDelayMs: number; activeDelayMs: number; fullDelayMs: number; fullCheckMaxChars: number; maxLines: number;
	};

	constructor(private readonly view: EditorView, options: LiveCheckOptions) {
		this.o = {
			getOptions: options.getOptions,
			onChange: options.onChange,
			leftDelayMs: options.leftDelayMs ?? 100,
			activeDelayMs: options.activeDelayMs ?? 1000,
			fullDelayMs: options.fullDelayMs ?? 1500,
			fullCheckMaxChars: options.fullCheckMaxChars ?? 500_000,
			maxLines: options.maxLines ?? 2000,
		};
	}

	update(u: ViewUpdate): void {
		if (u.docChanged) {
			this.dirty = this.dirty.map(([a, b]) => [u.changes.mapPos(a, -1), u.changes.mapPos(b, 1)]);
			u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
				// Whole lines pasted in at the start of a line leave the line that follows them unchanged, so
				// end the range on the last inserted line rather than touching that neighbour (re-checking it
				// would clear its block-structure error until the next whole-file pass for no reason).
				const wholeLinesAtLineStart = toA === fromA && inserted.length > 0
					&& inserted.sliceString(inserted.length - 1) === "\n" && u.startState.doc.lineAt(fromA).from === fromA;
				this.dirty.push([fromB, wholeLinesAtLineStart ? toB - 1 : toB]);
			});
			this.wholeFilePending = true;
			this.restart("activeTimer", this.o.activeDelayMs, () => this.checkLines(true));
			this.restart("fullTimer", this.o.fullDelayMs, () => this.checkWholeFile());
		}
		if (u.docChanged || u.selectionSet) {
			if (this.dirty.length > 0) this.restart("leftTimer", this.o.leftDelayMs, () => this.checkLines(false));
		}
	}

	destroy(): void {
		this.destroyed = true;
		clearTimeout(this.leftTimer);
		clearTimeout(this.activeTimer);
		clearTimeout(this.fullTimer);
	}

	private restart(timer: "leftTimer" | "activeTimer" | "fullTimer", ms: number, run: () => void): void {
		clearTimeout(this[timer]);
		this[timer] = setTimeout(() => { if (!this.destroyed) run(); }, ms);
	}

	private notify(): void {
		if (this.o.onChange === undefined) return;
		let count = 0;
		forEachDiagnostic(this.view.state, () => { count++; });
		this.o.onChange(count);
	}

	private documentUsesModeSwitch(): boolean {
		if (this.usesModeSwitch === null) {
			this.usesModeSwitch = false;
			for (const chunk of this.view.state.doc.iter()) {
				if (/M453/i.test(chunk)) { this.usesModeSwitch = true; break; }
			}
		}
		return this.usesModeSwitch;
	}

	/** Re-checks the changed lines. `includeActive` false leaves the line(s) the cursor is on for later. */
	private checkLines(includeActive: boolean): void {
		const { state } = this.view;
		const doc = state.doc;
		const active = new Set(state.selection.ranges.map((r) => doc.lineAt(r.head).number));
		const lines = new Set<number>();
		const stillDirty: Array<[number, number]> = [];
		for (const [a, b] of this.dirty) {
			const first = doc.lineAt(Math.min(a, doc.length)).number;
			const last = doc.lineAt(Math.min(b, doc.length)).number;
			if (last - first > this.o.maxLines) { this.dirty = []; return; } // a huge paste: the whole-file pass handles it
			for (let n = first; n <= last; n++) {
				if (!includeActive && active.has(n)) stillDirty.push([doc.line(n).from, doc.line(n).to]);
				else lines.add(n);
			}
		}
		this.dirty = stillDirty;
		if (lines.size === 0) return;

		// Checked from the text now in the editor: a line containing M453 switches the whole file over to
		// the whole-file pass for good (see the module comment).
		for (const n of lines) if (/M453/i.test(doc.line(n).text)) this.usesModeSwitch = true;
		if (this.documentUsesModeSwitch()) return;

		const options = this.o.getOptions();
		const fresh: Array<CmDiagnostic> = [];
		const spans: Array<[number, number]> = [];
		for (const n of lines) {
			const line = doc.line(n);
			spans.push([line.from, line.to]);
			fresh.push(...diagnoseLine(line.text, line.from, options));
		}

		const kept: Array<CmDiagnostic> = [];
		let dropped = 0;
		forEachDiagnostic(state, (d, from, to) => {
			if (spans.some(([lf, lt]) => from <= lt && to >= lf)) dropped++;
			else kept.push({ ...d, from, to });
		});
		if (dropped === 0 && fresh.length === 0) return; // nothing was there and nothing is now
		this.view.dispatch(setDiagnostics(state, [...kept, ...fresh]));
		this.notify();
	}

	private checkWholeFile(): void {
		if (!this.wholeFilePending || this.view.state.doc.length > this.o.fullCheckMaxChars) return;
		this.wholeFilePending = false;
		this.dirty = [];
		clearTimeout(this.leftTimer);
		clearTimeout(this.activeTimer);
		checkDocument(this.view, this.o.getOptions());
		this.notify();
	}
}

/** See the module comment. Add alongside `gcodeLintUi()`. */
export function gcodeLiveCheck(options: LiveCheckOptions): Extension {
	return ViewPlugin.define((view) => new LiveCheck(view, options));
}
