import { describe, expect, it } from "vitest";
import { DEFAULT_DARK_COLOR_SCHEME, DEFAULT_LIGHT_COLOR_SCHEME } from "../src/customTheme";
import {
	DEFAULT_COLOR_SCHEME_FILE, GCODE_EDITOR_COLORS_SD_PATH, parseColorSchemeFile, serializeColorSchemeFile,
} from "../src/colorSchemeStorage";

describe("GCODE_EDITOR_COLORS_SD_PATH", () => {
	it("is a fixed, real SD-card path under 0:/sys/", () => {
		expect(GCODE_EDITOR_COLORS_SD_PATH).toBe("0:/sys/dwc-gcode-editor.colors.json");
	});
});

describe("serializeColorSchemeFile / parseColorSchemeFile", () => {
	it("round-trips a real file exactly", () => {
		const text = serializeColorSchemeFile(DEFAULT_COLOR_SCHEME_FILE);
		const parsed = parseColorSchemeFile(text);
		expect(parsed).toEqual(DEFAULT_COLOR_SCHEME_FILE);
	});

	it("the serialized file self-tags with kind and schemaVersion", () => {
		const text = serializeColorSchemeFile(DEFAULT_COLOR_SCHEME_FILE);
		const raw = JSON.parse(text);
		expect(raw.kind).toBe("dwc-gcode-editor-colors");
		expect(raw.schemaVersion).toBe(1);
	});

	it("round-trips a genuinely customised scheme, not just the defaults", () => {
		const custom = { light: { ...DEFAULT_LIGHT_COLOR_SCHEME, keyword: "#123456" }, dark: DEFAULT_DARK_COLOR_SCHEME };
		expect(parseColorSchemeFile(serializeColorSchemeFile(custom))).toEqual(custom);
	});

	it("returns null for invalid JSON", () => {
		expect(parseColorSchemeFile("{ not json")).toBeNull();
	});

	it("returns null for valid JSON with the wrong kind", () => {
		expect(parseColorSchemeFile(JSON.stringify({ kind: "something-else", light: DEFAULT_LIGHT_COLOR_SCHEME, dark: DEFAULT_DARK_COLOR_SCHEME }))).toBeNull();
	});

	it("returns null when light or dark is missing or malformed", () => {
		expect(parseColorSchemeFile(JSON.stringify({ kind: "dwc-gcode-editor-colors", light: DEFAULT_LIGHT_COLOR_SCHEME }))).toBeNull();
		expect(parseColorSchemeFile(JSON.stringify({
			kind: "dwc-gcode-editor-colors", light: { keyword: "#fff" }, dark: DEFAULT_DARK_COLOR_SCHEME,
		}))).toBeNull();
	});

	it("returns null for a non-object JSON value", () => {
		expect(parseColorSchemeFile("42")).toBeNull();
		expect(parseColorSchemeFile("null")).toBeNull();
		expect(parseColorSchemeFile("[1,2,3]")).toBeNull();
	});
});
