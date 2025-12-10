import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: "client",
    plugins: [react()],
    server: {
      port: 5173,
    },
    define: {
      global: "globalThis",
      "import.meta.env.NETWORK": JSON.stringify(
        env.NETWORK || env.VITE_NETWORK || "base-sepolia"
      ),
    },
  };
});
