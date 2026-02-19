import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSISTANT_UI_CHAT_CHUNK_RE =
  /\/node_modules\/(?:@assistant-ui\/|remark-|rehype-|micromark|mdast-util-|hast-util-|unist-util-|vfile)/;

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

            if (ASSISTANT_UI_CHAT_CHUNK_RE.test(normalizedId)) {
              return "assistant-ui";
            }

            if (
              normalizedId.includes("/node_modules/react/") ||
              normalizedId.includes("/node_modules/react-dom/") ||
              normalizedId.includes("/node_modules/scheduler/")
            ) {
              return "react-vendor";
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
