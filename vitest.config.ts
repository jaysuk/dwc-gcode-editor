import { defineConfig } from "vitest/config";

// happy-dom, not node: unlike dwc-gcode-core, this package genuinely mounts CM6 EditorView
// instances in its own tests (the workspace/highlighting/diagnostics adapters are pure and would
// be fine under node, but a shared environment is simpler than splitting the config in two).
export default defineConfig({
	test: {
		environment: "happy-dom",
		include: ["test/**/*.test.ts"],
		coverage: { provider: "v8", include: ["src/**"], reporter: ["text", "text-summary"] },
	},
});
