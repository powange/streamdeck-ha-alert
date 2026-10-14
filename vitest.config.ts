import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		// Temporaire : les premiers tests arrivent à l'étape 2.
		passWithNoTests: true,
	},
});
