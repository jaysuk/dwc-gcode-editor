/**
 * The shared file format + SD-card path for user-customised editor colors — pure data/parsing, no
 * `machineStore`/DWC import (this package stays host-agnostic). A host does the actual
 * `machineStore.download`/`upload` I/O against `GCODE_EDITOR_COLORS_SD_PATH`, using
 * `parseColorSchemeFile`/`serializeColorSchemeFile` here so both `duet-gcode-postprocessor` and
 * `Flexible-Layouts` read and write byte-identical JSON and therefore genuinely share one palette,
 * rather than each inventing its own shape.
 *
 * **One file, not one per plugin** — deliberately NOT DWC's own `useSettingsStore().registerPluginData`
 * mechanism (`src/stores/settings.ts`, real source checked before choosing): that rides inside
 * `0:/sys/dwc-settings.json`, is scoped per-plugin-id, and is only written to the SD card when the
 * user's own `settingsStorageLocal` setting is off — none of which fits "site-wide, guaranteed on the
 * SD card, shared across whichever plugin's editor happens to be open". Follows `Flexible-Layouts`'
 * own already-proven direct-file pattern instead (`src/model/sdBackup.ts`): a dedicated file under
 * `0:/sys/`, self-tagged with `kind`/`schemaVersion`, `machineStore.upload`/`download` (the latter
 * needs `type: "text"` — that repo's own documented gotcha: omit it and DWC auto-parses the JSON,
 * handing back the string `"[object Object]"` instead of the real text).
 */

import { DEFAULT_DARK_COLOR_SCHEME, DEFAULT_LIGHT_COLOR_SCHEME, isGcodeColorScheme, type GcodeColorScheme } from "./customTheme.js";

/** Fixed SD-card path both hosts read and write — changing this is a breaking change for anyone with
 *  an existing saved file. */
export const GCODE_EDITOR_COLORS_SD_PATH = "0:/sys/dwc-gcode-editor.colors.json";

const SCHEME_FILE_KIND = "dwc-gcode-editor-colors";
const SCHEME_FILE_SCHEMA_VERSION = 1;

export interface GcodeColorSchemeFile {
	light: GcodeColorScheme;
	dark: GcodeColorScheme;
}

export const DEFAULT_COLOR_SCHEME_FILE: GcodeColorSchemeFile = {
	light: DEFAULT_LIGHT_COLOR_SCHEME,
	dark: DEFAULT_DARK_COLOR_SCHEME,
};

/**
 * Parse a color-scheme file's raw text. Returns `null` for anything that isn't recognisably this
 * package's own file — invalid JSON, a wrong/missing `kind`, or a `light`/`dark` value that doesn't
 * pass `isGcodeColorScheme` — so a host can fall back to `DEFAULT_COLOR_SCHEME_FILE` rather than
 * propagate a parse error for what is, ultimately, a hand-editable file a user could have broken.
 * Deliberately does NOT reject an unknown `schemaVersion` outright (there is only one today); a host
 * upgrading this package later can decide how far back to stay compatible.
 */
export function parseColorSchemeFile(text: string): GcodeColorSchemeFile | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (parsed === null || typeof parsed !== "object") return null;
	const obj = parsed as Record<string, unknown>;
	if (obj.kind !== SCHEME_FILE_KIND) return null;
	if (!isGcodeColorScheme(obj.light) || !isGcodeColorScheme(obj.dark)) return null;
	return { light: obj.light, dark: obj.dark };
}

/** Serialise a color-scheme file ready to write to `GCODE_EDITOR_COLORS_SD_PATH`. */
export function serializeColorSchemeFile(file: GcodeColorSchemeFile): string {
	return JSON.stringify({ kind: SCHEME_FILE_KIND, schemaVersion: SCHEME_FILE_SCHEMA_VERSION, ...file }, null, 2);
}
