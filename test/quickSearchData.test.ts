import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	expressionQuickSearchEntries, flattenObjectModel, gcodeQuickSearchEntries, isInsideExpression,
	localVariableNames,
} from "../src/quickSearchData";

describe("gcodeQuickSearchEntries", () => {
	it("includes a real, known command with its real summary", () => {
		const entries = gcodeQuickSearchEntries();
		const g28 = entries.find((e) => e.label === "G28");
		expect(g28).toBeDefined();
		expect(g28!.insertText).toBe("G28");
		expect(g28!.detail).toBeTruthy();
	});

	it("returns more than a handful of entries - the real dictionary, not a stub", () => {
		expect(gcodeQuickSearchEntries().length).toBeGreaterThan(50);
	});
});

describe("isInsideExpression", () => {
	it("is true inside an unclosed { expression", () => {
		expect(isInsideExpression("G1 X{move.axes[0]")).toBe(true);
	});

	it("is false once the expression is closed before the cursor", () => {
		expect(isInsideExpression("G1 X{move.axes[0].userPosition} Y")).toBe(false);
	});

	it("does not count a { inside a quoted string as opening an expression", () => {
		expect(isInsideExpression("M118 S\"literal { brace\"")).toBe(false);
	});

	it("is true right after if/elif/while", () => {
		expect(isInsideExpression("if ")).toBe(true);
		expect(isInsideExpression("elif ")).toBe(true);
		expect(isInsideExpression("while ")).toBe(true);
	});

	it("is true after = on a set/var/global line", () => {
		expect(isInsideExpression("set myVar = ")).toBe(true);
		expect(isInsideExpression("var x = ")).toBe(true);
		expect(isInsideExpression("global y = ")).toBe(true);
	});

	it("is true right after echo/abort", () => {
		expect(isInsideExpression("echo ")).toBe(true);
		expect(isInsideExpression("abort ")).toBe(true);
	});

	it("is false on an ordinary G-code line", () => {
		expect(isInsideExpression("G1 X10 Y20 ")).toBe(false);
	});

	it("is false before the = on a set/var/global line - the name itself isn't an expression", () => {
		expect(isInsideExpression("set myVar")).toBe(false);
	});
});

describe("flattenObjectModel", () => {
	it("returns an empty list for a non-object root", () => {
		expect(flattenObjectModel(null)).toEqual([]);
		expect(flattenObjectModel(42)).toEqual([]);
		expect(flattenObjectModel("x")).toEqual([]);
	});

	it("flattens nested objects into dotted paths", () => {
		const paths = flattenObjectModel({ move: { axes: [], speedFactor: 1 } });
		expect(paths).toContain("move");
		expect(paths).toContain("move.axes");
		expect(paths).toContain("move.speedFactor");
	});

	it("represents an array of objects with a single [0]-suffixed path per its first element's own children", () => {
		const paths = flattenObjectModel({ tools: [{ number: 0 }, { number: 1 }] });
		expect(paths).toContain("tools[0].number");
		expect(paths.filter((p) => p.startsWith("tools["))).toHaveLength(1); // one representative element, not one per tool
	});

	it("an array of primitives contributes only its own path, no [0] sub-entry (nothing further to name)", () => {
		const paths = flattenObjectModel({ active: [200, 210] });
		expect(paths).toContain("active");
		expect(paths).not.toContain("active[0]");
	});

	it("skips underscore-prefixed keys", () => {
		const paths = flattenObjectModel({ move: {}, _private: 1 });
		expect(paths).not.toContain("_private");
	});

	it("does not loop forever on a cyclic object", () => {
		const cyclic: Record<string, unknown> = { name: "a" };
		cyclic.self = cyclic;
		expect(() => flattenObjectModel(cyclic)).not.toThrow();
	});

	it("emits nothing for an empty array (no representative element to walk)", () => {
		const paths = flattenObjectModel({ tools: [] });
		expect(paths).toContain("tools");
		expect(paths.some((p) => p.startsWith("tools["))).toBe(false);
	});
});

describe("localVariableNames", () => {
	it("finds var and global declarations, prefixed by scope", () => {
		const doc = Text.of(["var myVar = 1", "global myGlobal = 2", "G28"]);
		const names = localVariableNames(doc);
		expect(names).toContain("var.myVar");
		expect(names).toContain("global.myGlobal");
		expect(names).toHaveLength(2);
	});

	it("does not match var/global appearing inside a comment or string, per RRF's real recognition rule", () => {
		// lexLine's own meta detection (via metaKeywordOf) only recognises "var"/"global" as the FIRST
		// token on the line - a semicolon comment mentioning them isn't a real declaration.
		const doc = Text.of(["; not a var declaration", "G1 ; global note"]);
		expect(localVariableNames(doc)).toEqual([]);
	});

	it("finds no declarations in a file with none", () => {
		const doc = Text.of(["G28", "G1 X10"]);
		expect(localVariableNames(doc)).toEqual([]);
	});
});

describe("expressionQuickSearchEntries", () => {
	function mount(text: string) {
		return new EditorView({ doc: text, parent: document.createElement("div") });
	}

	it("combines flattened object-model paths with local var/global names, deduplicated and sorted", () => {
		const view = mount("var myVar = 1\nG28\n");
		const entries = expressionQuickSearchEntries(view, { move: { speedFactor: 1 } });
		const labels = entries.map((e) => e.label);
		expect(labels).toContain("move.speedFactor");
		expect(labels).toContain("var.myVar");
		expect(labels).toEqual([...labels].sort());
		view.destroy();
	});

	it("offers only local names when no object model is supplied", () => {
		const view = mount("var myVar = 1\n");
		const entries = expressionQuickSearchEntries(view);
		expect(entries.map((e) => e.label)).toEqual(["var.myVar"]);
		view.destroy();
	});

	it("entries have no detail column - object-model paths are bare, unlike G/M-code entries", () => {
		const view = mount("var myVar = 1\n");
		const entries = expressionQuickSearchEntries(view);
		expect(entries[0]!.detail).toBeUndefined();
		view.destroy();
	});
});
