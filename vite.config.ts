import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function contentSecurityPolicyPlugin(connectSources: string[], upgradeInsecureRequests: boolean): Plugin {
  return {
    name: "mosaic-content-security-policy",
    transformIndexHtml(html) {
      return html
        .replace("__MOSAIC_CONNECT_SRC__", connectSources.join(" "))
        .replace("__MOSAIC_UPGRADE_INSECURE_REQUESTS__", upgradeInsecureRequests ? "upgrade-insecure-requests" : "");
    },
  };
}

function connectionOrigins(url: string) {
  try {
    const httpOrigin = new URL(url).origin;
    const websocketOrigin = httpOrigin.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
    return [httpOrigin, websocketOrigin];
  } catch {
    return [];
  }
}

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  const configuredOrigins = connectionOrigins(environment.VITE_SUPABASE_URL ?? "");
  const localOrigins = command === "serve"
    ? ["http://127.0.0.1:54321", "ws://127.0.0.1:54321", "http://localhost:54321", "ws://localhost:54321"]
    : [];

  return {
    base: "/MOSAIC/",
    plugins: [contentSecurityPolicyPlugin([...new Set([...configuredOrigins, ...localOrigins])], command === "build"), react()],
    build: {
      outDir: "dist",
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "supabase",
                test: /node_modules[\\/]@supabase[\\/]/,
              },
            ],
          },
        },
      },
    },
  };
});
