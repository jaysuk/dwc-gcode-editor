import { describe, expect, it } from "vitest";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Diagnostic as CoreDiagnostic } from "dwc-gcode-core";
import {
	AUTO_CHECK_MAX_CHARS, applyDiagnostics, canAutoCheck, checkDocument, gcodeLintUi, gcodeLiveLinter, toCmDiagnostics,
} from "../src/diagnostics";

function coreDiagnostic(overrides: Partial<CoreDiagnostic> = {}): CoreDiagnostic {
	return {
		rule: "dictionary/unknown-parameter",
		severity: "warning",
		message: "Unknown parameter",
		file: "test.g",
		line: 0,
		start: 3,
		end: 5,
		sources: ["RRF 3.7.0-rc.1 GCodes2.cpp HandleMcode"],
		...overrides,
	};
}

describe("toCmDiagnostics", () => {
	it("carries start/end straight through as from/to - no offset conversion", () => {
		const [cm] = toCmDiagnostics([coreDiagnostic({ start: 10, end: 14 })]);
		expect(cm.from).toBe(10);
		expect(cm.to).toBe(14);
	});

	it("carries severity straight through unchanged", () => {
		for (const severity of ["error", "warning", "info", "hint"] as const) {
			const [cm] = toCmDiagnostics([coreDiagnostic({ severity })]);
			expect(cm.severity).toBe(severity);
		}
	});

	it("maps message and rule -> source", () => {
		const [cm] = toCmDiagnostics([coreDiagnostic({ message: "A T command must be on a line by itself", rule: "t-not-alone" })]);
		expect(cm.message).toBe("A T command must be on a line by itself");
		expect(cm.source).toBe("t-not-alone");
	});

	it("maps an empty list to an empty list", () => {
		expect(toCmDiagnostics([])).toEqual([]);
	});
});

describe("a core diagnostic's fixes", () => {
	const fixed = (overrides: Partial<CoreDiagnostic> = {}): CoreDiagnostic => coreDiagnostic({
		start: 10, end: 14, fixes: [{ title: "Turn into a comment", edits: [{ start: 10, end: 10, newText: "; " }] }], ...overrides,
	});

	it("become actions named after the fix, and a diagnostic without fixes has none", () => {
		const [withFix, without] = toCmDiagnostics([fixed(), coreDiagnostic()]);
		expect(withFix.actions?.map((a) => a.name)).toEqual(["Turn into a comment"]);
		expect(without.actions).toBeUndefined();
		expect(toCmDiagnostics([fixed({ fixes: [] })])[0].actions).toBeUndefined();
	});

	function open(doc: string): { view: EditorView; actions: () => Array<{ from: number; to: number; apply: (v: EditorView, f: number, t: number) => void }> } {
		const view = new EditorView({ state: EditorState.create({ doc, extensions: [gcodeLintUi()] }), parent: document.createElement("div") });
		return {
			view,
			actions: () => {
				const found: Array<{ from: number; to: number; apply: (v: EditorView, f: number, t: number) => void }> = [];
				forEachDiagnostic(view.state, (d, from, to) => { for (const a of d.actions ?? []) found.push({ from, to, apply: a.apply }); });
				return found;
			},
		};
	}

	it("apply the edit at the diagnostic's position", () => {
		const { view, actions } = open("M104 S200 heat up\n");
		applyDiagnostics(view, [fixed()]);
		const [a] = actions();
		a.apply(view, a.from, a.to);
		expect(view.state.doc.toString()).toBe("M104 S200 ; heat up\n");
		view.destroy();
	});

	it("follow the squiggle when text above it has been edited since the check", () => {
		const { view, actions } = open("M104 S200 heat up\n");
		applyDiagnostics(view, [fixed()]);
		view.dispatch({ changes: { from: 0, insert: "G28\n" } });
		const [a] = actions();
		expect(a.from).toBe(14);
		a.apply(view, a.from, a.to);
		expect(view.state.doc.toString()).toBe("G28\nM104 S200 ; heat up\n");
		view.destroy();
	});
});

describe("applyDiagnostics", () => {
	it("pushes diagnostics into a real editor that has gcodeLintUi installed", () => {
		const state = EditorState.create({ doc: "G90 G1 Z5\nG1 X1 Y1", extensions: [gcodeLintUi()] });
		const view = new EditorView({ state, parent: document.createElement("div") });

		applyDiagnostics(view, [coreDiagnostic({ start: 0, end: 3, severity: "warning", message: "bad G90" })]);

		const seen: Array<{ from: number; to: number; message: string }> = [];
		forEachDiagnostic(view.state, (d, from, to) => seen.push({ from, to, message: d.message }));
		expect(seen).toEqual([{ from: 0, to: 3, message: "bad G90" }]);
		view.destroy();
	});

	it("replaces the previous diagnostic set rather than accumulating", () => {
		const state = EditorState.create({ doc: "G90 G1 Z5", extensions: [gcodeLintUi()] });
		const view = new EditorView({ state, parent: document.createElement("div") });

		applyDiagnostics(view, [coreDiagnostic({ start: 0, end: 3 })]);
		applyDiagnostics(view, [coreDiagnostic({ start: 4, end: 6 })]);

		const seen: Array<number> = [];
		forEachDiagnostic(view.state, (_d, from) => seen.push(from));
		expect(seen).toEqual([4]);
		view.destroy();
	});

	it("clears diagnostics when given an empty list", () => {
		const state = EditorState.create({ doc: "G90 G1 Z5", extensions: [gcodeLintUi()] });
		const view = new EditorView({ state, parent: document.createElement("div") });

		applyDiagnostics(view, [coreDiagnostic()]);
		applyDiagnostics(view, []);

		let count = 0;
		forEachDiagnostic(view.state, () => count++);
		expect(count).toBe(0);
		view.destroy();
	});
});

describe("gcodeLiveLinter", () => {
	it("re-runs the given source after a document change and applies the result", async () => {
		let calls = 0;
		const source = (view: EditorView) => {
			calls++;
			// A trivial "real" rule: flag any line starting with "T" combined with anything else,
			// just to prove `source` sees the CURRENT document, not a stale snapshot.
			const text = view.state.doc.toString();
			return text.includes("BAD") ? [{ from: 0, to: 3, severity: "error" as const, message: "found BAD" }] : [];
		};

		const state = EditorState.create({ doc: "G90", extensions: [gcodeLiveLinter(source, { delay: 0 })] });
		const view = new EditorView({ state, parent: document.createElement("div") });

		view.dispatch({ changes: { from: 0, to: 3, insert: "BAD" } });

		// CM6 schedules the lint pass asynchronously even with delay:0 - poll briefly rather than
		// assume a fixed wait is long enough or too slow.
		const deadline = Date.now() + 2000;
		let seen = 0;
		while (Date.now() < deadline) {
			seen = 0;
			forEachDiagnostic(view.state, () => seen++);
			if (seen > 0) break;
			await new Promise((r) => setTimeout(r, 20));
		}

		expect(seen).toBe(1);
		expect(calls).toBeGreaterThan(0);
		view.destroy();
	});
});

describe("checkDocument", () => {
	function viewOf(doc: string): EditorView {
		return new EditorView({ state: EditorState.create({ doc, extensions: [gcodeLintUi()] }), parent: document.createElement("div") });
	}
	function countIn(view: EditorView): number {
		let n = 0;
		forEachDiagnostic(view.state, () => n++);
		return n;
	}

	it("checks the whole document with the real rules and shows the result in the editor", () => {
		// M106 has no Q parameter (the demo's own known-bad line).
		const view = viewOf("G1 X10\nM106 Q1\n");
		const found = checkDocument(view, { path: "0:/macros/a.g", firmwareVersion: "3.6.0" });
		expect(found.length).toBeGreaterThan(0);
		expect(countIn(view)).toBe(found.length);
		view.destroy();
	});

	it("reports nothing for a clean document and clears an earlier result", () => {
		const view = viewOf("M106 Q1\n");
		checkDocument(view, { path: "0:/macros/a.g" });
		expect(countIn(view)).toBeGreaterThan(0);
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "G1 X10\n" } });
		expect(checkDocument(view, { path: "0:/macros/a.g" })).toEqual([]);
		expect(countIn(view)).toBe(0);
		view.destroy();
	});
});

describe("canAutoCheck", () => {
	it("is true up to the cap and false above it", () => {
		const small = new EditorView({ state: EditorState.create({ doc: "G1 X1\n" }), parent: document.createElement("div") });
		expect(canAutoCheck(small)).toBe(true);
		small.destroy();
		const big = new EditorView({ state: EditorState.create({ doc: "x".repeat(AUTO_CHECK_MAX_CHARS + 1) }), parent: document.createElement("div") });
		expect(canAutoCheck(big)).toBe(false);
		big.destroy();
	});
});
