import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

// M2 前端构建基线。版本组合见 docs/DEPENDENCIES.md 与 docs/M2-KICKOFF-CHECK.md：
// TypeScript 锁定 5.9.3（TS 7.x 与 vue-tsc 3.3.14 不兼容，已实证）。
//
// 真实链路（M2-R）与生产同构：前端只用相对路径 /_matrix/* 与 /invite-api/*。
// 生产环境由 Caddy 在同一 origin 下路由这两组路径；本地 dev/preview 用 Vite 代理
// 转发到本地 Caddy，从而避免浏览器直连自签 HTTPS 带来的证书与 CORS 问题。
// `secure: false` 是**仅作用于这两条本地代理**的 TLS 校验放宽（目标为 127.0.0.1
// 的 tls internal 自签证书），等价于 M1 测试中「仅限该请求」的 https Agent；
// 不是全局 NODE_TLS_REJECT_UNAUTHORIZED=0，也不会进入生产构建产物。
const LOCAL_CADDY = "https://127.0.0.1";
const liveProxy = {
  "/_matrix": { target: LOCAL_CADDY, changeOrigin: true, secure: false, ws: true },
  "/invite-api": { target: LOCAL_CADDY, changeOrigin: true, secure: false },
};

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
        // 只预缓存应用外壳静态资源。WASM（7.8 MiB）刻意不进 precache：
        // demo 用户无需下载，live 用户首次连接时按需 fetch；也避免
        // 离线时误以为能收发消息（SW 从不缓存任何 API 响应）。
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
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
  // 本地开发/预览代理；生产由 Caddy 同源承载，前端代码无需任何服务器地址配置。
  server: { proxy: liveProxy },
  preview: { proxy: liveProxy },
  // M0 F4：WASM 作为 public/ 静态资产由 postinstall 复制，运行时路径显式固定，
  // 避免打包器重写 import.meta.url 导致 404。
  assetsInclude: ["**/*.wasm"],
  build: { target: "es2022", sourcemap: false },
});
