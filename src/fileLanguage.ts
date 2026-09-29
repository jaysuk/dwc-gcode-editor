/**
 * Pick the CM6 language for a file from its path, using `dwc-gcode-core`'s own `classifyFile` so a
 * host does not re-derive "which files are G-code" (its `GCODE_FILE_KINDS` / `syntax` field is the
 * single source of truth for that). `board.txt` gets `boardTxtLanguage`; a 12864 menu file gets
 * `menuLanguage`; every G-code-syntax file gets `gcodeLanguage`; anything else (CSV, binary, plain text)
 * gets `null` - a host decides what to do with those, this package has no opinion.
 */

import type { Extension } from "@codemirror/state";
import { classifyFile } from "dwc-gcode-core";
import { boardTxtLanguage } from "./boardTxt.js";
import { gcodeLanguage } from "./language.js";
import { menuLanguage } from "./menuFile.js";

export function languageForPath(path: string): Extension | null {
	const classified = classifyFile(path);
	if (classified.kind === "board-config") return boardTxtLanguage;
	if (classified.kind === "menu") return menuLanguage;
	if (classified.syntax === "gcode") return gcodeLanguage;
	return null;
}
