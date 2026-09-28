import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { boardTxtDiagnostics, boardTxtKeySource, boardTxtLanguage, boardTxtLiveLinter, classifyBoardTxtLine } from "../src/boardTxt";
import { languageForPath } from "../src/fileLanguage";
import { gcodeLanguage } from "../src/language";

const tagsOf = (raw: string): Array<[string, string]> =>
	classifyBoardTxtLine(raw).map((r) => [raw.slice(r.from, r.to), r.tag]);

describe("classifyBoardTxtLine", () => {
	it("colours a known key, and a numeric value as a number", () => {
		expect(tagsOf("sdcard.internal.type=1")).toEqual([["sdcard.internal.type", "propertyName"], ["1", "number"]]);
	});

	it("colours a pin value and the key of a scalar pin setting", () => {
		expect(tagsOf("stepper.powerEnablePin=NoPin")).toEqual([["stepper.powerEnablePin", "propertyName"], ["NoPin", "atom"]]);
	});

	it("leaves an unknown key uncoloured - it is what the loader skips - and its value too", () => {
		expect(tagsOf("not.a.setting = 5")).toEqual([]);
	});

	it("matches keys case-insensitively, like the loader", () => {
		expect(tagsOf("SDCARD.internal.TYPE = 1")[0]).toEqual(["SDCARD.internal.TYPE", "propertyName"]);
	});

	it("colours a quoted string whole, quotes included, even with spaces inside", () => {
		expect(tagsOf("board.longName=\"BTT GTR V1.0\"")).toEqual([["board.longName", "propertyName"], ["\"BTT GTR V1.0\"", "string"]]);
	});

	it("tolerates an unterminated quote (mid-typing)", () => {
		expect(tagsOf("board.longName=\"BTT")[1]).toEqual(["\"BTT", "string"]);
	});

	it("colours each entry of a { } list, not the braces or commas", () => {
		expect(tagsOf("SPI0.pins={A.5, A.6 ,A.7}")).toEqual([
			["SPI0.pins", "propertyName"], ["A.5", "atom"], ["A.6", "atom"], ["A.7", "atom"],
		]);
	});

	it("stops colouring a list at a bad separator - the loader discards the whole list there", () => {
		expect(tagsOf("SPI0.pins={A.5 A.6}")).toEqual([["SPI0.pins", "propertyName"], ["A.5", "atom"]]);
	});

	it("treats a whole line starting with / # or ; as a comment, after leading blanks", () => {
		for (const c of ["/", "#", ";"]) {
			expect(tagsOf(`  ${c}power.VInDetectPin=C.7`)).toEqual([[`${c}power.VInDetectPin=C.7`, "lineComment"]]);
		}
	});

	it("ends the line at a comment after the key, after '=', or after the value", () => {
		expect(tagsOf("sdcard.internal.type ; x = 1")).toEqual([["sdcard.internal.type", "propertyName"], ["; x = 1", "lineComment"]]);
		expect(tagsOf("sdcard.internal.type = ; x")).toEqual([["sdcard.internal.type", "propertyName"], ["; x", "lineComment"]]);
		expect(tagsOf("sdcard.internal.type = 1 // sdio")).toEqual([["sdcard.internal.type", "propertyName"], ["1", "number"], ["// sdio", "lineComment"]]);
	});

	it("does not colour text after a value that is not a comment - RRF ignores it", () => {
		expect(tagsOf("heat.spiTempSensorChannel=4 junk")).toEqual([["heat.spiTempSensorChannel", "propertyName"], ["4", "number"]]);
	});

	it("gives a line without '=' only its key colour", () => {
		expect(tagsOf("sdcard.internal.type 1")).toEqual([["sdcard.internal.type", "propertyName"]]);
	});

	it("returns nothing for a blank line", () => {
		expect(classifyBoardTxtLine("   ")).toEqual([]);
	});

	it("yields ranges in ascending order and inside the line", () => {
		const raw = "stepper.enablePins={F.1,E.4} ; c";
		const r = classifyBoardTxtLine(raw);
		for (let i = 1; i < r.length; i++) expect(r[i]!.from).toBeGreaterThanOrEqual(r[i - 1]!.to);
		expect(r[r.length - 1]!.to).toBeLessThanOrEqual(raw.length);
	});
});

describe("boardTxtLanguage", () => {
	it("really highlights through a mounted view (a stream parser can yield unknown tags silently)", () => {
		const view = new EditorView({
			state: EditorState.create({ doc: "sdcard.internal.type=1\n; c", extensions: [boardTxtLanguage] }),
			parent: document.createElement("div"),
		});
		const names: Array<string> = [];
		syntaxTree(view.state).iterate({ enter: (n) => { names.push(n.name); } });
		const joined = names.join(" ");
		expect(joined).toMatch(/propertyName/i);
		expect(joined).toMatch(/number/i);
		expect(joined).toMatch(/comment/i);
		view.destroy();
	});

	it("declares ';' as its line comment", () => {
		const state = EditorState.create({ doc: "x", extensions: [boardTxtLanguage] });
		expect(state.languageDataAt<{ line: string }>("commentTokens", 0)[0]?.line).toBe(";");
	});
});

describe("boardTxtDiagnostics", () => {
	it("is empty for a clean file", () => {
		expect(boardTxtDiagnostics("board=x\nsdcard.internal.type=1\nSPI0.pins={A.5,A.6,A.7}\n")).toEqual([]);
	});

	it("underlines the offending line's content, excluding leading blanks and the newline", () => {
		const text = "sdcard.internal.type=1\n  bogus.key = 5\nsdcard.internal.type=1";
		const [d] = boardTxtDiagnostics(text);
		expect(text.slice(d!.from, d!.to)).toBe("bogus.key = 5");
		expect(d!.severity).toBe("warning");
		expect(d!.source).toBe("unknown-key");
	});

	it("reports the right line under CRLF endings", () => {
		const text = "sdcard.internal.type=1\r\nbogus = 5\r\nsdcard.internal.type=1\r\n";
		const [d] = boardTxtDiagnostics(text);
		expect(text.slice(d!.from, d!.to)).toBe("bogus = 5");
	});

	it("flags a missing '=' and a list on a scalar key", () => {
		const kinds = boardTxtDiagnostics("sdcard.internal.type 1\nsdcard.internal.type={1}").map((d) => d.source);
		expect(kinds).toEqual(["missing-equals", "wrong-shape"]);
	});

	it("flags a list with too many entries", () => {
		expect(boardTxtDiagnostics("SPI0.pins={A.1,A.2,A.3,A.4}").map((d) => d.source)).toEqual(["array-overflow"]);
	});

	it("marks a legal empty list as info, not a warning", () => {
		expect(boardTxtDiagnostics("SPI0.pins={}")[0]!.severity).toBe("info");
	});

	it("a lone BOM before the first key is called out on line 1", () => {
		const [d] = boardTxtDiagnostics("﻿board=x");
		expect(d!.message).toMatch(/byte-order mark/);
	});

	it("never emits an empty range", () => {
		const out = boardTxtDiagnostics("=\n=1");
		expect(out.length).toBeGreaterThan(0);
		for (const d of out) expect(d.to).toBeGreaterThan(d.from);
	});
});

describe("boardTxtLiveLinter", () => {
	it("puts the diagnostics into a mounted editor", async () => {
		const view = new EditorView({
			state: EditorState.create({ doc: "bogus = 5", extensions: [boardTxtLiveLinter()] }),
			parent: document.createElement("div"),
		});
		await new Promise((r) => setTimeout(r, 900));
		const seen: Array<string> = [];
		forEachDiagnostic(view.state, (d) => { seen.push(d.message); });
		expect(seen.length).toBe(1);
		view.destroy();
	});
});

describe("boardTxtKeySource", () => {
	const at = (doc: string, pos = doc.length, explicit = false) => {
		const state = EditorState.create({ doc, extensions: [autocompletion()] });
		return boardTxtKeySource(new CompletionContext(state, pos, explicit));
	};

	it("offers every key while typing at the start of a line", () => {
		const r = at("sdcard.int");
		expect(r!.from).toBe(0);
		expect(r!.options.some((o) => o.label === "sdcard.internal.type")).toBe(true);
	});

	it("offers nothing on an empty line unless explicitly invoked", () => {
		expect(at("")).toBeNull();
		expect(at("", 0, true)).not.toBeNull();
	});

	it("offers nothing after the '='", () => {
		expect(at("sdcard.internal.type=1")).toBeNull();
		expect(at("sdcard.internal.type = ", undefined, true)).toBeNull();
	});

	it("offers nothing with text before the word", () => {
		expect(at("foo bar")).toBeNull();
	});

	it("applying a list key puts the cursor between the braces", () => {
		const view = new EditorView({ state: EditorState.create({ doc: "SPI0" }), parent: document.createElement("div") });
		const r = boardTxtKeySource(new CompletionContext(view.state, 4, false))!;
		const option = r.options.find((o) => o.label === "SPI0.pins")!;
		(option.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view, option, r.from, 4);
		expect(view.state.doc.toString()).toBe("SPI0.pins = {}");
		expect(view.state.selection.main.head).toBe(view.state.doc.length - 1);
		view.destroy();
	});
});

describe("languageForPath", () => {
	it("picks boardTxtLanguage for board.txt, wherever it lives", () => {
		expect(languageForPath("0:/sys/board.txt")).toBe(boardTxtLanguage);
		expect(languageForPath("board.txt")).toBe(boardTxtLanguage);
	});

	it("picks gcodeLanguage for G-code files", () => {
		expect(languageForPath("0:/sys/config.g")).toBe(gcodeLanguage);
		expect(languageForPath("0:/gcodes/part.gcode")).toBe(gcodeLanguage);
	});

	it("returns null for a file that is neither", () => {
		expect(languageForPath("0:/sys/heightmap.csv")).toBeNull();
	});
});
