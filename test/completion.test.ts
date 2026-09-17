import { describe, expect, it } from "vitest";
import { CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { createGcodeCompletionSource } from "../src/completion";

function contextFor(doc: string, pos: number, explicit = false): CompletionContext {
	const state = EditorState.create({ doc });
	return new CompletionContext(state, pos, explicit);
}

// `createGcodeCompletionSource`'s implementation is always synchronous, but the `CompletionSource`
// type it returns is declared as `CompletionResult | null | Promise<...>` by @codemirror/autocomplete
// itself - narrow it back here, once, rather than asserting at every call site below.
function runSync(source: CompletionSource, context: CompletionContext): CompletionResult | null {
	const result = source(context);
	if (result instanceof Promise) throw new Error("expected a synchronous result");
	return result;
}

describe("createGcodeCompletionSource", () => {
	const rawSource = createGcodeCompletionSource();
	const source = (context: CompletionContext) => runSync(rawSource, context);

	it("offers matching command codes while typing a bare command", () => {
		const result = source(contextFor("G1", 2));
		expect(result).not.toBeNull();
		expect(result!.from).toBe(0);
		const labels = result!.options.map((o) => o.label);
		expect(labels).toContain("G1");
		expect(labels).toContain("G10");
		expect(labels).toContain("G28");
		// A completely unrelated command must still be in the full list (CM6's own engine filters
		// by the typed prefix from `options`, not this source) - this source's job is only to
		// identify the trigger position and hand back the dictionary, not to pre-filter by prefix.
		expect(labels).toContain("M104");
	});

	it("includes the real dictionary summary as detail, proving this is the live dictionary, not a stub", () => {
		const result = source(contextFor("G1", 2));
		const g1 = result!.options.find((o) => o.label === "G1");
		expect(g1?.detail).toBe("Linear move");
	});

	it("does not fire command completion once a command already has a parameter", () => {
		// Cursor right after "G1 X10 F" - inside the command's overall span, but params.length > 0,
		// so this must fall through to parameter-letter completion instead of re-offering "G1 X10 F"
		// as if it were itself a command code.
		const result = source(contextFor("G1 X10 F", 8));
		expect(result).not.toBeNull();
		const labels = result!.options.map((o) => o.label);
		expect(labels).not.toContain("G1");
		expect(labels).toContain("F");
	});

	it("offers a known command's own parameter letters while typing a bare letter after it", () => {
		const result = source(contextFor("G1 X", 4));
		expect(result).not.toBeNull();
		expect(result!.from).toBe(3); // replaces the bare "X" itself
		const labels = result!.options.map((o) => o.label);
		expect(labels).toContain("F"); // Feedrate
		expect(labels).toContain("H"); // Move type
		expect(labels).not.toContain("X"); // axis letters are explicitly out of scope - see module doc
	});

	it("excludes a parameter letter already used earlier on the same command", () => {
		const result = source(contextFor("G1 F100 ", 8));
		// Nothing typed yet after the trailing space - only fires on explicit invocation.
		expect(result).toBeNull();
		const explicitResult = source(contextFor("G1 F100 ", 8, true));
		expect(explicitResult).not.toBeNull();
		const labels = explicitResult!.options.map((o) => o.label);
		expect(labels).not.toContain("F"); // already set on this line
		expect(labels).toContain("H");
	});

	it("offers no parameter completions for a command the dictionary doesn't know at all", () => {
		// "G99999" is not a real command - lexLine still parses it structurally (a bare code), but
		// commandSpec must return null, and this source must not throw or fabricate anything.
		const result = source(contextFor("G99999 X", 8));
		expect(result).toBeNull();
	});

	it("respects multi-command lines - parameter completion targets only the command that owns that span", () => {
		// "G90 G1 X" - the bare "X" belongs to G1, not G90 (which has no parameters in the dictionary
		// at all, so if this incorrectly attributed it to G90 the result would be null instead).
		const result = source(contextFor("G90 G1 X", 8));
		expect(result).not.toBeNull();
		const labels = result!.options.map((o) => o.label);
		expect(labels).toContain("F");
	});

	it("returns null outside of any command (e.g. inside a trailing comment)", () => {
		const result = source(contextFor("G28 ; home all axes", 10));
		expect(result).toBeNull();
	});

	it("machineMode option does not exclude a mode-agnostic command", () => {
		// Checked directly (a quick script against the real dictionary): as of this writing, zero
		// commands in COMMANDS have `machineModes` set at all, so there is currently no real entry to
		// assert gets EXCLUDED by this option - only that passing it doesn't wrongly exclude an
		// unrestricted one. Revisit with a real negative-case assertion once the dictionary gains its
		// first mode-restricted command.
		const cncOnly = createGcodeCompletionSource({ machineMode: "cnc" });
		const result = runSync(cncOnly, contextFor("G1", 2));
		const labels = result!.options.map((o) => o.label);
		expect(labels).toContain("G1");
	});
});
