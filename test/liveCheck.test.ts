import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diagnoseDocument, parseDocument } from "dwc-gcode-core";
import { applyDiagnostics, gcodeLintUi } from "../src/diagnostics";
import { diagnoseLine, gcodeLiveCheck, type LiveCheckOptions } from "../src/liveCheck";

const OPTS = { path: "0:/macros/a.g", firmwareVersion: "3.6.0" };

/** Every line of this fixture is checked both ways below. It mixes clean lines with each kind of
 *  finding a single line can produce, plus an `if`/`else` pair (fine) and an orphan `else` (an error
 *  only the whole file can see). */
const FIXTURE = [
	"; a comment",
	"G1 X10 Y10 F1800",
	"M106 Q1",
	"T0 G1 X10",
	"M999 Z",
	"m106 S1",
	"G1 X1 K2",
	"G4 P",
	"M83 X",
	"if true",
	"  echo \"hi\"",
	"else",
	"  G1 Z{move.axes[0].nonexistentThing}",
	"G1 X{move.axes[0].homed}",
	"Else",
	"else",
].join("\n");

const key = (d: { rule?: string; source?: string; from?: number; to?: number; start?: number; end?: number; message: string }) =>
	`${d.rule ?? d.source}|${d.from ?? d.start}|${d.to ?? d.end}|${d.message}`;

describe("diagnoseLine", () => {
	it("gives, for each line, what the whole-file check gives for that line (block-structure errors aside)", () => {
		const parsed = parseDocument(FIXTURE);
		const full = diagnoseDocument(parsed, OPTS.path, { firmwareVersion: OPTS.firmwareVersion });
		const isBlock = (rule: string) => rule === "structure/document-error";

		let compared = 0;
		let offset = 0;
		FIXTURE.split("\n").forEach((text, index) => {
			const fast = diagnoseLine(text, offset, OPTS).filter((d) => d.source !== "structure/document-error").map(key).sort();
			const expected = full.filter((d) => d.line === index && !isBlock(d.rule)).map(key).sort();
			expect(fast, `line ${index + 1}: ${text}`).toEqual(expected);
			compared += expected.length;
			offset += text.length + 1;
		});
		expect(compared).toBeGreaterThan(4); // the fixture really does contain findings, so this is not comparing empties
	});

	it("keeps a T command that shares a line, which needs no other line to be judged", () => {
		expect(diagnoseLine("T0 G1 X10", 0, OPTS).map((d) => d.source)).toContain("structure/document-error");
	});

	it("says nothing about else / elif / break / continue on their own (that needs the lines around them)", () => {
		for (const text of ["else", "elif true", "break", "continue", "  else"]) {
			expect(diagnoseLine(text, 0, OPTS), text).toEqual([]);
		}
	});

	it("positions the result in the editor's document, not in the line", () => {
		const [d] = diagnoseLine("M106 Q1", 100, OPTS);
		expect(d!.from).toBeGreaterThanOrEqual(100);
	});
});

describe("gcodeLiveCheck", () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	function mount(doc: string, extra: Partial<LiveCheckOptions> = {}) {
		const counts: Array<number> = [];
		const state = EditorState.create({
			doc,
			extensions: [gcodeLintUi(), gcodeLiveCheck({ getOptions: () => OPTS, onChange: (n) => counts.push(n), ...extra })],
		});
		const view = new EditorView({ state, parent: document.createElement("div") });
		return { view, counts };
	}
	/** `[line number, rule]` for every diagnostic now in the editor. */
	function found(view: EditorView): Array<[number, string]> {
		const out: Array<[number, string]> = [];
		forEachDiagnostic(view.state, (d, from) => out.push([view.state.doc.lineAt(from).number, d.source ?? "?"]));
		return out.sort((a, b) => a[0] - b[0]);
	}
	function type(view: EditorView, at: number, text: string): void {
		view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: "input.type" });
	}

	it("checks the line being typed on only after a pause, and only that line", () => {
		const { view } = mount("M106 S1\nM106 S2\nM106 S3");
		const end = view.state.doc.line(2).to;
		type(view, end, " Q9"); // M106 has no Q parameter
		vi.advanceTimersByTime(500);
		expect(found(view)).toEqual([]); // still typing on that line: nothing yet
		vi.advanceTimersByTime(600);
		expect(found(view).map(([n]) => n)).toEqual([2]);
		view.destroy();
	});

	it("checks a line as soon as the cursor leaves it, without waiting for the pause", () => {
		const { view } = mount("M106 S1\nM106 S2");
		const end = view.state.doc.line(1).to;
		type(view, end, " Q9");
		view.dispatch({ selection: { anchor: view.state.doc.line(2).from } }); // click on line 2
		vi.advanceTimersByTime(150);
		expect(found(view).map(([n]) => n)).toEqual([1]);
		view.destroy();
	});

	it("Enter counts as leaving the line", () => {
		const { view } = mount("M106 Q1");
		const end = view.state.doc.line(1).to;
		view.dispatch({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 }, userEvent: "input" });
		vi.advanceTimersByTime(150);
		expect(found(view).map(([n]) => n)).toEqual([1]);
		view.destroy();
	});

	it("leaves diagnostics on lines it did not check alone, and they follow their text", () => {
		const { view } = mount("M106 Q1\nM106 S2\nM106 S3");
		applyDiagnostics(view, [{ rule: "test/other", severity: "warning", message: "old", file: "a", line: 0, sources: [], start: 0, end: 7 }]);
		expect(found(view)).toEqual([[1, "test/other"]]);
		view.dispatch({ changes: { from: 0, insert: "; new first line\n" } }); // pushes the marked line down
		type(view, view.state.doc.line(3).to, " Q9");
		vi.advanceTimersByTime(1100);
		const rules = found(view);
		expect(rules).toContainEqual([2, "test/other"]); // untouched, and moved with its text
		expect(rules.some(([n, r]) => n === 3 && r.startsWith("dictionary/"))).toBe(true);
		view.destroy();
	});

	it("clears a line's finding once the line is fixed", () => {
		const { view } = mount("M106 Q1\nG1 X2");
		applyDiagnostics(view, diagnoseDocument(parseDocument(view.state.doc.toString()), OPTS.path, { firmwareVersion: "3.6.0" }));
		expect(found(view).length).toBeGreaterThan(0);
		view.dispatch({ changes: { from: 0, to: 7, insert: "M106 S1" }, selection: { anchor: 7 } });
		view.dispatch({ selection: { anchor: view.state.doc.line(2).from } });
		vi.advanceTimersByTime(150);
		expect(found(view)).toEqual([]);
		view.destroy();
	});

	it("finds block-structure errors on the whole-file pass, not before", () => {
		const { view } = mount("G1 X1\nG1 X2");
		view.dispatch({ changes: { from: view.state.doc.length, insert: "\nelse" }, selection: { anchor: view.state.doc.length + 5 } });
		vi.advanceTimersByTime(1100);
		expect(found(view)).toEqual([]); // the single-line pass does not judge a bare else
		vi.advanceTimersByTime(600);
		expect(found(view)).toEqual([[3, "structure/document-error"]]);
		// Adding the `if` it was missing clears it on the next whole-file pass.
		view.dispatch({ changes: { from: view.state.doc.line(3).from, insert: "if true\n  G1 X0\n" } });
		vi.advanceTimersByTime(2000);
		expect(found(view)).toEqual([]);
		view.destroy();
	});

	it("does not run the whole-file pass on a document over the size limit, but still checks lines", () => {
		const { view } = mount("M106 S1\nelse", { fullCheckMaxChars: 5 });
		type(view, view.state.doc.line(1).to, " Q9");
		vi.advanceTimersByTime(5000);
		expect(found(view).map(([n]) => n)).toEqual([1]); // the orphan else was never found: no whole-file pass ran
		view.destroy();
	});

	it("skips the single-line pass in a file that switches machine mode, leaving it to the whole-file pass", () => {
		// In CNC/laser mode `( ... )` is a comment; read alone the same line gets false unknown-command findings.
		const { view } = mount("M453\nG1 X1");
		type(view, view.state.doc.line(2).to, " (a comment) Y2");
		vi.advanceTimersByTime(1100); // past the single-line pass, before the whole-file one
		expect(found(view)).toEqual([]);
		vi.advanceTimersByTime(600); // the whole-file pass reads it in its real mode: still clean
		expect(found(view)).toEqual([]);
		view.destroy();
	});

	it("notices M453 being typed into a file and stops judging lines singly from then on", () => {
		const { view } = mount("G1 X1");
		const insert = "\nM453\nG1 X1 (a comment) Y2";
		view.dispatch({ changes: { from: view.state.doc.length, insert }, selection: { anchor: view.state.doc.length + insert.length } });
		vi.advanceTimersByTime(1100);
		expect(found(view)).toEqual([]);
		view.destroy();
	});

	it("notices M453 typed after an earlier check already found the file did not use it", () => {
		const { view } = mount("G1 X1");
		type(view, view.state.doc.length, " Y2");
		vi.advanceTimersByTime(1100); // first check: the file is scanned once and found not to use M453
		const insert = "\nM453\nG1 X1 (a comment) Y2";
		view.dispatch({ changes: { from: view.state.doc.length, insert }, selection: { anchor: view.state.doc.length + insert.length } });
		vi.advanceTimersByTime(1100);
		expect(found(view)).toEqual([]);
		view.destroy();
	});

	it("checks the same line singly when the file does not use M453", () => {
		// The control for the two tests above: it is the M453, not the comment, that keeps these clean.
		const { view } = mount("G1 X1");
		type(view, view.state.doc.length, " (a comment) Y2");
		vi.advanceTimersByTime(1100);
		expect(found(view).some(([, r]) => r === "syntax/text-after-command")).toBe(true);
		view.destroy();
	});

	it("reports the diagnostic count after each check", () => {
		const { view, counts } = mount("M106 S1");
		type(view, view.state.doc.length, " Q9");
		vi.advanceTimersByTime(1100);
		expect(counts.at(-1)).toBe(found(view).length);
		expect(counts.at(-1)).toBeGreaterThan(0);
		view.destroy();
	});

	it("does nothing after the editor is destroyed", () => {
		const { view, counts } = mount("M106 S1");
		type(view, view.state.doc.length, " Q9");
		view.destroy();
		expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
		expect(counts).toEqual([]);
	});
});
