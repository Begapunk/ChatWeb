import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// M2 前端构建基线。版本组合见 docs/DEPENDENCIES.md 与 docs/M2-KICKOFF-CHECK.md：
// TypeScript 锁定 5.9.3（TS 7.x 与 vue-tsc 3.3.14 不兼容，已实证）。
export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      // 用 prompt 而非 autoUpdate：更新由用户在界面上确认，避免会话中途被强制刷新
      // 打断正在进行的加密同步（M0 F2：重启语义应新建客户端实例）。
      registerType: "prompt",
      includeAssets: ["icons/icon.svg"],
      manifest: {
        name: "Aether",
        short_name: "Aether",
        description: "私人端到端加密通讯",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // 只预缓存应用外壳静态资源。
        globPatterns: ["**/*.{js,css,html,svg,wasm,woff2}"],
        navigateFallback: "/index.html",
        // 安全红线：Matrix / 邀请服务 API 绝不进入 Service Worker 导航回退或缓存，
        // 防止密文响应、注册令牌等被缓存到离线存储。
        navigateFallbackDenylist: [/^\/_matrix\//, /^\/invite-api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // M0 F4：WASM 资源须作为静态资产显式处理，运行时路径固定，
  // 避免打包器重写 import.meta.url 导致 404。
  assetsInclude: ["**/*.wasm"],
  build: { target: "es2022", sourcemap: false },
});
