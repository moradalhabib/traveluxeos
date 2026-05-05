import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Build version stamp — used by the auto-reload feature.
// At production build time we emit /version.json containing this value, and
// inject it into the client bundle as __BUILD_VERSION__. The client then
// polls /version.json every 60s; when the served value differs from the
// value baked into the running bundle, we know a new build has been
// published and we trigger a soft reload so the team never has to close
// and re-open the tab manually.
const BUILD_VERSION = String(Date.now());

// process.cwd() is always the package directory (artifacts/traveluxe-os)
// when pnpm executes this build script — it is NOT affected by Vite bundling
// the config to a temp file the way import.meta.dirname is.
const pkgDir = process.cwd();

function buildVersionPlugin(): Plugin {
  return {
    name: "traveluxe-build-version",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: BUILD_VERSION }),
      });
    },
  };
}

function devVersionPlugin(): Plugin {
  return {
    name: "traveluxe-dev-version",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split("?")[0]?.endsWith("/version.json")) {
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ version: "dev" }));
          return;
        }
        next();
      });
    },
  };
}

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// In Replit the workflow injects BASE_PATH; on Vercel (and plain vite build)
// the app is served from root, so "/" is the correct default.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    buildVersionPlugin(),
    devVersionPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(pkgDir, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(pkgDir, "src"),
      "@assets": path.resolve(pkgDir, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: pkgDir,
  build: {
    outDir: path.resolve(pkgDir, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
