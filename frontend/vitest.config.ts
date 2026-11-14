import { defineConfig } from "vitest/config";

// 独立的测试配置：不复用 vite.config.ts，避免 VitePWA 的构建插件介入单元测试。
// 真实 Synapse / 浏览器双实例验收属于 e2e/live-e2ee.mjs（npm run e2e:live），
// 这里只做 node 环境下的纯逻辑与安全边界断言。
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: "verbose",
  },
});
