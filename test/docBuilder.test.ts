import { describe, expect, it } from "vitest";
import { buildDocFromChunks, buildDocFromString } from "../src/docBuilder";

async function* chunksOf(parts: Array<string>): AsyncGenerator<string> {
	for (const p of parts) yield p;
}

describe("buildDocFromChunks", () => {
	it("reconstructs a document split cleanly on chunk boundaries", async () => {
		const doc = await buildDocFromChunks(chunksOf(["G28\n", "G1 X10\n", "G1 Y10\n"]));
		expect(doc.toString()).toBe("G28\nG1 X10\nG1 Y10\n");
		expect(doc.lines).toBe(4); // 3 real lines + the trailing empty one after the final \n
	});

	it("handles a line split across two chunks without losing or duplicating it", async () => {
		const doc = await buildDocFromChunks(chunksOf(["G1 X1", "0 Y20\n", "G28\n"]));
		expect(doc.toString()).toBe("G1 X10 Y20\nG28\n");
	});

	it("handles a chunk boundary that falls exactly on a newline", async () => {
		const doc = await buildDocFromChunks(chunksOf(["G28\n", "G1 X10\n"]));
		expect(doc.toString()).toBe("G28\nG1 X10\n");
	});

	it("preserves a final line with no trailing newline", async () => {
		const doc = await buildDocFromChunks(chunksOf(["G28\nG1 X10"]));
		expect(doc.toString()).toBe("G28\nG1 X10");
		expect(doc.lines).toBe(2);
	});

	it("handles an empty stream", async () => {
		const doc = await buildDocFromChunks(chunksOf([]));
		expect(doc.toString()).toBe("");
	});

	it("handles many small chunks the same as one big one", async () => {
		const whole = "G28\nG1 X10 Y10\nG1 X20 Y20\nM400\n";
		const tiny = whole.split("").map((c) => c); // one character per chunk - worst case
		const fromTiny = await buildDocFromChunks(chunksOf(tiny));
		const fromWhole = await buildDocFromChunks(chunksOf([whole]));
		expect(fromTiny.toString()).toBe(fromWhole.toString());
		expect(fromTiny.toString()).toBe(whole);
	});

	it("flushing early (a small flushAtChars) produces the same result as flushing once at the end", async () => {
		const whole = Array.from({ length: 500 }, (_, i) => `G1 X${i} Y${i}`).join("\n") + "\n";
		const eager = await buildDocFromChunks(chunksOf([whole]), { flushAtChars: 50 });
		const lazy = await buildDocFromChunks(chunksOf([whole]), { flushAtChars: 1_000_000 });
		expect(eager.toString()).toBe(whole);
		expect(eager.toString()).toBe(lazy.toString());
	});
});

describe("buildDocFromString", () => {
	it("wraps a plain string as a single-chunk build", async () => {
		const doc = await buildDocFromString("G28\nG1 X10\n");
		expect(doc.toString()).toBe("G28\nG1 X10\n");
	});
});
