import { syntaxTree } from "@codemirror/language";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { languageForPath } from "../src/fileLanguage";
import { classifyMenuLine, menuDiagnostics, menuLanguage, menuLiveLinter } from "../src/menuFile";

const tagsOf = (raw: string): Array<[string, string]> =>
	classifyMenuLine(raw).map((r) => [raw.slice(r.from, r.to), r.tag]);

describe("classifyMenuLine", () => {
	it("colours the command, each parameter's letter, and its value by kind", () => {
		expect(tagsOf("text R0 C5 F1 T\"Hello\"")).toEqual([
			["text", "keyword"],
			["R", "propertyName"], ["0", "number"],
			["C", "propertyName"], ["5", "number"],
			["F", "propertyName"], ["1", "number"],
			["T", "propertyName"], ["\"Hello\"", "string"],
		]);
	});

	it("matches a command case-insensitively, like RRF", () => {
		expect(tagsOf("BUTTON T\"x\"")[0]).toEqual(["BUTTON", "keyword"]);
	});

	it("leaves an unrecognised command uncoloured - it is what RRF refuses", () => {
		expect(tagsOf("frobnicate R1")).toEqual([["R", "propertyName"], ["1", "number"]]);
	});

	it("colours a bare quoted string (short for T) as a string with no letter", () => {
		expect(tagsOf("text \"Bare\"")).toEqual([["text", "keyword"], ["\"Bare\"", "string"]]);
	});

	it("keeps a doubled-quote escape inside one string", () => {
		expect(tagsOf("text T\"say \"\"hi\"\"\"")[2]).toEqual(["\"say \"\"hi\"\"\"", "string"]);
	});

	it("tokenises an N{...} / V{...} expression with the G-code expression scanner", () => {
		const tags = tagsOf("value N{move.axes[0].machinePosition} V{exists(global.x)}");
		expect(tags).toContainEqual(["move", "propertyName"]);
		expect(tags).toContainEqual(["exists", "keyword"]);
		expect(tags).toContainEqual(["global", "definitionKeyword"]);
		// the braces themselves stay plain
		expect(tags.map(([t]) => t)).not.toContain("{");
	});

	it("colours a whole-line comment, after leading blanks", () => {
		expect(tagsOf("  ; a comment")).toEqual([["; a comment", "lineComment"]]);
	});

	it("colours a comment after the last parameter", () => {
		expect(tagsOf("text R0 ; note")).toEqual([
			["text", "keyword"], ["R", "propertyName"], ["0", "number"], ["; note", "lineComment"],
		]);
	});

	it("does not treat a ';' as a comment once parsing has stopped on a bad argument", () => {
		// RRF gives up at `X` ("Bad arg letter"), so what follows is not read at all.
		expect(tagsOf("text X5 ; c").some(([, tag]) => tag === "lineComment")).toBe(false);
	});

	it("does not treat a ';' inside a string as a comment", () => {
		const tags = tagsOf("text T\"a;b\"");
		expect(tags.some(([, tag]) => tag === "lineComment")).toBe(false);
		expect(tags).toContainEqual(["\"a;b\"", "string"]);
	});

	it("returns nothing for a blank line", () => {
		expect(classifyMenuLine("   ")).toEqual([]);
		expect(classifyMenuLine("")).toEqual([]);
	});

	it("tolerates a half-typed line", () => {
		expect(tagsOf("text T\"unfinished")).toEqual([
			["text", "keyword"], ["T", "propertyName"], ["\"unfinished", "string"],
		]);
		expect(() => classifyMenuLine("value N{")).not.toThrow();
	});

	it("yields ranges in ascending order and inside the line", () => {
		const raw = "button R27 C0 T\"Preheat\" A\"M98 P#0\" L\"/macros/x\" ; c";
		const r = classifyMenuLine(raw);
		for (let i = 1; i < r.length; i++) expect(r[i]!.from).toBeGreaterThanOrEqual(r[i - 1]!.to);
		expect(r[r.length - 1]!.to).toBeLessThanOrEqual(raw.length);
	});
});

describe("menuLanguage", () => {
	it("really highlights through a mounted view (a stream parser can yield unknown tags silently)", () => {
		const view = new EditorView({
			state: EditorState.create({ doc: "text R0 T\"Hi\"\n; c", extensions: [menuLanguage] }),
			parent: document.createElement("div"),
		});
		const names: Array<string> = [];
		syntaxTree(view.state).iterate({ enter: (n) => { names.push(n.name); } });
		const joined = names.join(" ");
		expect(joined).toMatch(/keyword/i);
		expect(joined).toMatch(/propertyName/i);
		expect(joined).toMatch(/string/i);
		expect(joined).toMatch(/comment/i);
		view.destroy();
	});

	it("declares ';' as its line comment", () => {
		const state = EditorState.create({ doc: "x", extensions: [menuLanguage] });
		expect(state.languageDataAt<{ line: string }>("commentTokens", 0)[0]?.line).toBe(";");
	});
});

describe("menuDiagnostics", () => {
	const messages = (text: string, options = {}) => menuDiagnostics(text, options).map((d) => `${d.source}: ${d.message}`);

	it("is empty for a clean menu", () => {
		expect(menuDiagnostics("text R0 C0 F1 T\"My printer\"\nvalue N80 W30\nbutton R27 C0 T\"Back\" A\"return\"\n")).toEqual([]);
	});

	it("reports a bad argument at its own column and says RRF stops loading", () => {
		const text = "text R0 T\"ok\"\ntext X5";
		const [d] = menuDiagnostics(text);
		expect(d!.source).toBe("menu/parse-error");
		expect(text.slice(d!.from, d!.from + 1)).toBe("X");
		expect(d!.message).toMatch(/stops loading/);
	});

	it("reports an unknown command over the command word", () => {
		const text = "text R0\nfrobnicate R1";
		const found = menuDiagnostics(text).filter((d) => d.source === "menu/unknown-command");
		expect(found).toHaveLength(1);
		expect(text.slice(found[0]!.from, found[0]!.to)).toBe("frobnicate");
	});

	it("reports a value code RRF does not know", () => {
		const found = messages("value N9999");
		expect(found.some((m) => m.startsWith("menu/unknown-value-code"))).toBe(true);
	});

	it("reports a line RRF would split at its length limit", () => {
		expect(messages(`text T"${"x".repeat(200)}"`).some((m) => m.startsWith("menu/line-too-long"))).toBe(true);
	});

	it("does not judge a `menu` target or an image file when it has not been told what else is in the folder", () => {
		const text = "button T\"Go\" A\"menu\" L\"nowhere\"\nimage L\"nothing.bin\"";
		expect(menuDiagnostics(text)).toEqual([]);
	});

	it("judges them against `siblings` once they are given (menus and images, case-insensitively)", () => {
		const text = "button T\"Go\" A\"menu\" L\"nowhere\"\nbutton T\"Ok\" A\"menu\" L\"LISTFILES\"\nimage L\"nothing.bin\"\nimage L\"logo.BIN\"";
		const found = menuDiagnostics(text, { siblings: ["listFiles", "logo.bin"] });
		expect(found.map((d) => d.source).sort()).toEqual(["menu/image-missing", "menu/target-missing"]);
		const missingMenu = found.find((d) => d.source === "menu/target-missing")!;
		expect(text.slice(missingMenu.from, missingMenu.to)).toBe("L\"nowhere\"");
	});

	it("does not let a sibling of the same name replace the file being edited", () => {
		// A stub for `main` (the file's own name, as a directory listing would include it) must not shadow the
		// real text - or this file's own errors would vanish whenever the listing includes it.
		expect(menuDiagnostics("text X5", { siblings: ["main"] }).map((d) => d.source)).toEqual(["menu/parse-error"]);
		// ...and a menu that returns to itself is fine, since it exists.
		expect(menuDiagnostics("button T\"Loop\" A\"menu\" L\"main\"", { siblings: ["main"] })).toEqual([]);
	});

	it("honours a custom path and its folder for siblings", () => {
		const text = "button T\"Go\" A\"menu\" L\"other\"";
		expect(menuDiagnostics(text, { path: "0:/menu/second", siblings: ["other"] })).toEqual([]);
		expect(menuDiagnostics(text, { path: "0:/menu/second", siblings: ["else"] }).map((d) => d.source)).toEqual(["menu/target-missing"]);
	});

	it("lets a caller disable a rule", () => {
		expect(menuDiagnostics("value N9999", { rules: { disable: ["menu/unknown-value-code"] } })).toEqual([]);
	});
});

describe("menuLiveLinter", () => {
	it("puts the diagnostics into a mounted editor, reading the options fresh each run", async () => {
		let siblings: ReadonlyArray<string> = [];
		const view = new EditorView({
			state: EditorState.create({
				doc: "button T\"Go\" A\"menu\" L\"other\"",
				extensions: [menuLiveLinter(() => ({ siblings }))],
			}),
			parent: document.createElement("div"),
		});
		await new Promise((r) => setTimeout(r, 900));
		const seen: Array<string> = [];
		forEachDiagnostic(view.state, (d) => { seen.push(d.message); });
		expect(seen).toHaveLength(1);

		siblings = ["other"];
		view.dispatch({ changes: { from: 0, insert: " " } }); // a change re-runs the linter
		await new Promise((r) => setTimeout(r, 900));
		const after: Array<string> = [];
		forEachDiagnostic(view.state, (d) => { after.push(d.message); });
		expect(after).toHaveLength(0);
		view.destroy();
	});
});

describe("languageForPath (menu files)", () => {
	it("picks menuLanguage for a file in the menu folder, not gcodeLanguage", () => {
		expect(languageForPath("0:/menu/main")).toBe(menuLanguage);
		expect(languageForPath("/menu/listFiles")).toBe(menuLanguage);
	});

	it("leaves a menu image alone", () => {
		expect(languageForPath("0:/menu/logo.bin")).toBeNull();
	});
});
