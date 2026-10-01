import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forEachDiagnostic, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { applyDiagnostics, gcodeLintUi } from "../src/diagnostics";
import { gcodeLiveCheck } from "../src/liveCheck";
import {
	IMPACT_SOURCE, gcodeImpactCheck, impactDiagnostics, isImpactDiagnostic, refreshImpactCheck,
	type ImpactCheckOptions, type ImpactDiagnostic, type ImpactRange,
} from "../src/impactCheck";

const UP: ImpactRange = { from: "3.6.3", to: "3.7.0-rc.2" };
const CONFIG = ["; config.g", "G1 X1", "M408 S0", "M955 P2 C0", "G1 X2", ""].join("\n");

describe("impactDiagnostics", () => {
	it("marks the changed command where it is in the text, with the event and its rule", () => {
		const ds = impactDiagnostics(CONFIG, UP, "0:/sys/config.g");
		const m408 = ds.find((d) => d.eventId === "m408-removed")!;
		expect(CONFIG.slice(m408.from, m408.to)).toBe("M408 S0");
		expect(m408).toMatchObject({ source: IMPACT_SOURCE, rule: "release/removed", severity: "warning" });
		expect(m408.message).toContain("Changed in 3.7.0-alpha.2");
		expect(m408.message).not.toContain("[m408-removed]");
		expect(isImpactDiagnostic(m408)).toBe(true);
	});

	it("puts the description, the version and the citation in the hover", () => {
		const d = impactDiagnostics(CONFIG, UP, "0:/sys/config.g").find((x) => x.eventId === "m408-removed")!;
		const node = d.renderMessage!(undefined as never) as HTMLElement;
		expect(node.querySelector(".cm-rrf-change-version")!.textContent).toBe("Changed in 3.7.0-alpha.2");
		expect(node.querySelector(".cm-rrf-change-source")!.textContent!.length).toBeGreaterThan(5);
		expect(node.firstElementChild!.textContent).toMatch(/M408/);
	});

	it("leaves out acknowledged changes", () => {
		const ds = impactDiagnostics(CONFIG, UP, "0:/sys/config.g", { isAcknowledged: (id) => id === "m408-removed" });
		expect(ds.map((d) => d.eventId)).not.toContain("m408-removed");
		expect(ds.length).toBeGreaterThan(0);
	});

	it("says nothing for a file that is not G-code", () => {
		expect(impactDiagnostics("M408\n", UP, "0:/menu/main")).toEqual([]);
		expect(impactDiagnostics("M408\n", UP, "0:/gcodes/print.gcode")).toEqual([]);
		expect(impactDiagnostics("M408\n", UP, "0:/sys/board.txt")).toEqual([]);
	});

	it("reads the other way round on a downgrade", () => {
		const ds = impactDiagnostics("if {a ^ b}\n  M118 P0\nendif\n", { from: "3.7.0-rc.2", to: "3.6.3" }, "0:/macros/x.g");
		expect(ds.find((d) => d.eventId === "expr-array-concat")).toMatchObject({ rule: "release/removed", severity: "warning" });
	});

	it("offers Ignore only when the host can handle it", () => {
		expect(impactDiagnostics(CONFIG, UP, "0:/sys/config.g")[0].actions).toBeUndefined();
		const ds = impactDiagnostics(CONFIG, UP, "0:/sys/config.g", { onIgnore: () => {}, ignoreLabel: "Ignorieren" });
		expect(ds[0].actions!.map((a) => a.name)).toEqual(["Ignorieren"]);
	});
});

describe("gcodeImpactCheck", () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	function mount(doc: string, options: Partial<ImpactCheckOptions> = {}, extra: Array<ReturnType<typeof gcodeLintUi>> = []) {
		const counts: Array<number> = [];
		const state = EditorState.create({
			doc,
			extensions: [gcodeLintUi(), gcodeImpactCheck({ getRange: () => UP, path: () => "0:/sys/config.g", onFinding: (n) => counts.push(n), ...options }), ...extra],
		});
		const view = new EditorView({ state, parent: document.createElement("div") });
		return { view, counts };
	}
	function all(view: EditorView): Array<CmDiagnostic> {
		const out: Array<CmDiagnostic> = [];
		forEachDiagnostic(view.state, (d, from, to) => out.push({ ...d, from, to }));
		return out;
	}
	const impact = (view: EditorView): Array<ImpactDiagnostic> => all(view).filter(isImpactDiagnostic);

	it("checks once after load", () => {
		const { view, counts } = mount(CONFIG);
		expect(all(view)).toEqual([]);
		vi.advanceTimersByTime(100);
		expect(impact(view).map((d) => d.eventId)).toContain("m408-removed");
		expect(counts).toEqual([impact(view).length]);
		view.destroy();
	});

	it("re-checks after an edit, and only after the pause", () => {
		const { view } = mount("G1 X1\n");
		vi.advanceTimersByTime(100);
		expect(impact(view)).toEqual([]);
		view.dispatch({ changes: { from: 0, insert: "M408 S0\n" } });
		vi.advanceTimersByTime(1000);
		expect(impact(view)).toEqual([]); // still typing
		vi.advanceTimersByTime(700);
		expect(impact(view).map((d) => d.eventId)).toContain("m408-removed");
		expect(impact(view)[0].from).toBe(0);
		view.destroy();
	});

	it("skips a document over maxChars", () => {
		const { view } = mount(CONFIG, { maxChars: 10 });
		vi.advanceTimersByTime(100);
		expect(impact(view)).toEqual([]);
		view.destroy();
	});

	it("is off when the range is null, and turns on/off with refreshImpactCheck as the range changes", () => {
		let range: ImpactRange | null = null;
		const { view, counts } = mount(CONFIG, { getRange: () => range });
		vi.advanceTimersByTime(100);
		expect(impact(view)).toEqual([]);
		range = UP;
		refreshImpactCheck(view);
		vi.advanceTimersByTime(10);
		expect(impact(view).length).toBeGreaterThan(0);
		range = null;
		refreshImpactCheck(view);
		vi.advanceTimersByTime(10);
		expect(impact(view)).toEqual([]);
		expect(counts.at(-1)).toBe(0);
		view.destroy();
	});

	it("is off for a path that is not G-code", () => {
		const { view } = mount(CONFIG, { path: () => "0:/menu/main" });
		vi.advanceTimersByTime(100);
		expect(impact(view)).toEqual([]);
		view.destroy();
	});

	it("drops an acknowledged change on refresh, and Ignore calls the host then refreshes", () => {
		const ignored = new Set<string>();
		const { view } = mount(CONFIG, { isAcknowledged: (id) => ignored.has(id), onIgnore: (id) => ignored.add(id) });
		vi.advanceTimersByTime(100);
		const target = impact(view).find((d) => d.eventId === "m408-removed")!;
		target.actions![0].apply(view, target.from, target.to);
		vi.advanceTimersByTime(10);
		expect([...ignored]).toEqual(["m408-removed"]);
		expect(impact(view).map((d) => d.eventId)).not.toContain("m408-removed");
		view.destroy();
	});

	it("does not clear, and is not cleared by, the ordinary check", () => {
		const { view } = mount("M106 Q1\nM408 S0\n");
		vi.advanceTimersByTime(100);
		expect(impact(view).length).toBeGreaterThan(0);
		// The "Check for errors" button replaces the ordinary set - ours must survive it.
		applyDiagnostics(view, [{ rule: "test/other", severity: "warning", message: "x", file: "a", line: 0, sources: [], start: 0, end: 4 }]);
		expect(all(view).filter((d) => d.source === "test/other")).toHaveLength(1);
		expect(impact(view).length).toBeGreaterThan(0);
		// And running ours must keep what the ordinary check put there.
		refreshImpactCheck(view);
		vi.advanceTimersByTime(10);
		expect(all(view).filter((d) => d.source === "test/other")).toHaveLength(1);
		view.destroy();
	});

	it("coexists with the live check's edits", () => {
		const { view } = mount("M106 S1\nM408 S0\n", {}, [gcodeLiveCheck({ getOptions: () => ({ path: "0:/sys/config.g", firmwareVersion: "3.7.0-rc.2" }) })]);
		vi.advanceTimersByTime(100);
		const before = impact(view).length;
		expect(before).toBeGreaterThan(0);
		view.dispatch({ changes: { from: 0, insert: "; note\n" } });
		vi.advanceTimersByTime(3000);
		expect(impact(view)).toHaveLength(before);
		view.destroy();
	});

	it("stops when the editor is destroyed", () => {
		const { view, counts } = mount(CONFIG);
		view.destroy();
		vi.advanceTimersByTime(5000);
		expect(counts).toEqual([]);
	});
});
