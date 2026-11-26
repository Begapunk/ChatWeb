import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// M2 前端构建基线。版本组合见 docs/DEPENDENCIES.md 与 docs/M2-KICKOFF-CHECK.md：
// TypeScript 锁定 5.9.3（TS 7.x 与 vue-tsc 3.3.14 不兼容，已实证）。
//
// 免安装模式由浏览器直接连接用户填写的 Matrix homeserver，不依赖本机反向代理。
// 标准 Matrix homeserver 会为 Client API 提供浏览器 CORS；不支持 CORS 的私有服务器
// 无法在此模式连接，应用会明确显示网络错误而不会降级到演示数据。

const base = process.env.VITE_BASE_PATH ?? "/";
if (!/^\/(?:[a-zA-Z0-9._-]+\/)?$/.test(base)) throw new Error("VITE_BASE_PATH 必须是 / 或 /repository/");

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      // 用 prompt 而非 autoUpdate：更新由用户在界面上确认，避免会话中途被强制刷新
      // 打断正在进行的加密同步（M0 F2：重启语义应新建客户端实例）。
      registerType: "prompt",
      includeAssets: ["icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"],
      manifest: {
        name: "Aether",
        short_name: "Aether",
        description: "私人端到端加密通讯",
        lang: "zh-CN",
        start_url: base,
        scope: base,
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // 只预缓存应用外壳静态资源。WASM（7.8 MiB）刻意不进 precache：
        // demo 用户无需下载，live 用户首次连接时按需 fetch；也避免
        // 离线时误以为能收发消息（SW 从不缓存任何 API 响应）。
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: `${base}index.html`,
        // 安全红线：Matrix / 邀请服务 API 绝不进入 Service Worker 导航回退或缓存，
        // 防止密文响应、注册令牌等被缓存到离线存储。
        navigateFallbackDenylist: [/^\/api\//, /^\/_matrix\//, /^\/invite-api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  // M0 F4：WASM 作为 public/ 静态资产由 postinstall 复制，运行时路径显式固定，
  // 避免打包器重写 import.meta.url 导致 404。
  assetsInclude: ["**/*.wasm"],
  build: { target: "es2022", sourcemap: false },
});
