import { describe, expect, it } from "vitest";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classifyLineForHighlight, gcodeLanguage } from "../src/language";

describe("classifyLineForHighlight", () => {
	it("tags the command word as keyword", () => {
		const ranges = classifyLineForHighlight("G1 X10 Y20");
		expect(ranges[0]).toEqual({ from: 0, to: 2, tag: "keyword" });
	});

	it("tags a parameter letter as propertyName and its numeric value as number", () => {
		const ranges = classifyLineForHighlight("G1 X10");
		const letter = ranges.find((r) => r.tag === "propertyName");
		const value = ranges.find((r) => r.tag === "number");
		expect(letter).toEqual({ from: 3, to: 4, tag: "propertyName" });
		expect(value).toEqual({ from: 4, to: 6, tag: "number" });
	});

	it("tags a quoted string parameter's value as string", () => {
		const ranges = classifyLineForHighlight('M291 P"Hello"');
		const value = ranges.find((r) => r.tag === "string");
		expect(value).toBeDefined();
		expect(value!.from).toBeGreaterThan(0);
	});

	it("tags an {expression} parameter's value as atom", () => {
		const ranges = classifyLineForHighlight("G1 X{myVar}");
		expect(ranges.some((r) => r.tag === "atom")).toBe(true);
	});

	it("tags a trailing comment as lineComment, starting at the semicolon", () => {
		const ranges = classifyLineForHighlight("G28 ; home all axes");
		const comment = ranges.find((r) => r.tag === "lineComment");
		expect(comment).toBeDefined();
		expect("G28 ; home all axes"[comment!.from]).toBe(";");
	});

	it("tags a control-flow meta keyword as controlKeyword", () => {
		const ranges = classifyLineForHighlight('if move.axes[0].homed');
		expect(ranges[0]).toEqual({ from: 0, to: 2, tag: "controlKeyword" });
	});

	it("tags a declaration meta keyword as definitionKeyword", () => {
		const ranges = classifyLineForHighlight("var x = 1");
		expect(ranges[0]).toEqual({ from: 0, to: 3, tag: "definitionKeyword" });
	});

	it("tags echo as a plain keyword, neither control nor definition", () => {
		const ranges = classifyLineForHighlight('echo "hi"');
		expect(ranges[0]).toEqual({ from: 0, to: 4, tag: "keyword" });
	});

	it("respects leading indentation when locating a meta keyword", () => {
		const ranges = classifyLineForHighlight("    if true");
		expect(ranges[0]).toEqual({ from: 4, to: 6, tag: "controlKeyword" });
	});

	it("produces no ranges for a blank line", () => {
		expect(classifyLineForHighlight("")).toEqual([]);
	});

	it("produces no ranges for a comment-only line beyond the comment itself", () => {
		const line = "; just a comment";
		const ranges = classifyLineForHighlight(line);
		expect(ranges).toEqual([{ from: 0, to: line.length, tag: "lineComment" }]);
	});

	it("tags each command separately on a multi-command line", () => {
		const ranges = classifyLineForHighlight("G90 G1 Z5");
		const keywords = ranges.filter((r) => r.tag === "keyword");
		expect(keywords).toEqual([
			{ from: 0, to: 3, tag: "keyword" },
			{ from: 4, to: 6, tag: "keyword" },
		]);
	});

	it("returns ranges in ascending order", () => {
		const ranges = classifyLineForHighlight("G1 X10 Y20 E1 F1800 ; move");
		for (let i = 1; i < ranges.length; i++) expect(ranges[i].from).toBeGreaterThanOrEqual(ranges[i - 1].from);
	});
});

describe("gcodeLanguage (real CM6 mount)", () => {
	function highlightClassesAt(doc: string, pos: number): Array<string> {
		const state = EditorState.create({
			doc,
			extensions: [gcodeLanguage, syntaxHighlighting(defaultHighlightStyle, { fallback: true })],
		});
		const view = new EditorView({ state, parent: document.createElement("div") });
		const el = view.domAtPos(pos).node as HTMLElement;
		const span = el.nodeType === 3 ? el.parentElement! : (el as HTMLElement);
		const classes = span.className.split(/\s+/).filter(Boolean);
		view.destroy();
		return classes;
	}

	it("actually renders a highlighted span for a command keyword, not just plain text", () => {
		const classes = highlightClassesAt("G1 X10", 0);
		expect(classes.length).toBeGreaterThan(0);
	});

	it("mounts without throwing on a file with every construct this module recognises", () => {
		const doc = [
			"; header comment",
			"if move.axes[0].homed",
			'  var x = 1',
			"  G90 G1 Z5",
			'  M291 P"hi" S0',
			"else",
			'  M118 P0 S"not homed"',
		].join("\n");
		expect(() => {
			const state = EditorState.create({ doc, extensions: [gcodeLanguage] });
			const view = new EditorView({ state, parent: document.createElement("div") });
			view.destroy();
		}).not.toThrow();
	});
});
