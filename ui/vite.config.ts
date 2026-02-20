import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSISTANT_UI_TRANSITIVE_PACKAGES = [
  "/node_modules/@assistant-ui/",
  "/node_modules/remark-",
  "/node_modules/rehype-",
  "/node_modules/micromark",
  "/node_modules/mdast-util-",
  "/node_modules/hast-util-",
  "/node_modules/unist-util-",
  "/node_modules/vfile",
  "/node_modules/property-information",
  "/node_modules/character-entities",
  "/node_modules/decode-named-character-reference",
];

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  const envBase = process.env.OPENCLAW_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join("/");
            if (!normalizedId.includes("/node_modules/")) {
              return;
            }

            if (ASSISTANT_UI_TRANSITIVE_PACKAGES.some((pkg) => normalizedId.includes(pkg))) {
              return "assistant-ui";
            }

            if (
              normalizedId.includes("/node_modules/react/") ||
              normalizedId.includes("/node_modules/react-dom/") ||
              normalizedId.includes("/node_modules/scheduler/")
            ) {
              return "react-vendor";
            }

            if (normalizedId.includes("/node_modules/lit/")) {
              return "lit-vendor";
            }

            return "vendor";
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
  };
});
