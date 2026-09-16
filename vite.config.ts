import { defineConfig } from "vite";

// Drives `npm run dev` only — the demo harness under `demo/`, run directly against `src/` (no
// build step needed first). Vitest prefers its own `vitest.config.ts` over this file when both
// exist, so `npm test` is unaffected by `root` being pointed at `demo/` here.
export default defineConfig({
	root: "demo",
});
