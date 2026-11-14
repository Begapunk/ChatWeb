# M2 开工首检报告：工具链兼容性与依赖锁定修订

> 日期：2026-11-14 · 执行：主理人自行完成（用户已通知 Codex 子 Agent 当前不可用，未调用）
> 目的：M2 前端开工前，**实证**核实 Vue 3 / Vite 8 / vue-router 5 / Pinia 4 / TypeScript 7
> 与 `vue-tsc`、`vite-plugin-pwa` 的兼容性，避免脚手架搭到一半因工具链返工（对应 `RISKS.md R4.3`）。
> 状态：**首检完成 · 工具链组合已锁定 · M2 前端脚手架尚未创建（属下一任务，不宣称完成）**

---

## 1. 环境实测

| 项 | 当前 shell 实测 | 备注 |
|---|---|---|
| Node | **v22.22.2** | `node -v` |
| npm | **10.9.7** | `npm -v` |
| M0 报告记录 | Node 24.18.0 | M0 由千问在另一 shell/环境执行；两者均满足 `matrix-js-sdk` engines `node >=22`。**差异如实登记，不改写 M0 报告** |
| Docker | 29.7.2 / Compose v5.4.0 | M1 本地栈实测可用 |

## 2. 官方版本核实（2026-11-14 查询，非记忆推断）

| 组件 | 版本 | 核实要点 |
|---|---|---|
| vue | 3.5.45 | — |
| vue-router | 5.5.1 | peers: vue ^3.5.34 ✓ |
| pinia | 4.1.0 | peers: vue ^3.5.11 ✓, typescript >=5.6 ✓ |
| vite | 8.3.8 | — |
| @vitejs/plugin-vue | 6.0.11 | — |
| vite-plugin-pwa | 2.0.0 | peers: vite ^3.1–^8 ✓；需 workbox-build/window ^7.4.1 |
| vue-tsc | 3.3.14 | — |
| typescript | **7.0.2 → 修订为 5.9.3** | 见 §4/§5 |
| vitest | 5.1.0 | peers: vite ^6.4–^8 ✓ |
| @playwright/test | 1.65.1 | M2 E2E 用本机 Chrome channel |

## 3. 验证方法（最小工程，非纸面推断）

在 `.tmp-gen/m2-probe/`（已 gitignore）建立最小 Vue PWA 工程：

- `package.json`：上表组件精确版本；scripts = `vite build` / `vue-tsc --noEmit`
- `vite.config.ts`：`@vitejs/plugin-vue` + `VitePWA`（含 manifest）
- `tsconfig.json`、`index.html`、`src/main.ts`、`src/App.vue`

执行两项门禁：

```bash
npx vue-tsc --noEmit     # 类型检查
npx vite build           # 生产构建 + PWA 产物
```

## 4. 失败证据：TypeScript 7.0.2 与 vue-tsc 3.3.14 不兼容

`typescript: 7.0.2` 下 `npx vue-tsc --noEmit` 失败：

```text
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]:
Package subpath './lib/tsc' is not defined by "exports" in typescript/package.json
```

根因（本地 `node_modules` 实证 + 官方/社区资料交叉确认）：

- TS 7.x 为 Go 原生编译器世代，`package.json` 的 `exports` 不再暴露 `./lib/tsc`，
  且移除了 JS programmatic API / 内部路径；
- `vue-tsc 3.3.14` 的 `index.js` 中 `resolveTscPath(tscPath = require.resolve('typescript/lib/tsc'))`
  仍依赖该子路径；
- 因此 **TS7 + 当前 vue-tsc 无法共存**，属于上游工具链代际差异，不是本项目代码问题。

按 M0 风险 R4.3 的既定处置路径「必要时降级到经过验证的组合」，不等待上游修复。

## 5. 修复与通过证据：TypeScript 5.9.3

`npm pkg set devDependencies.typescript=5.9.3` 后重跑：

| 门禁 | 结果 |
|---|---|
| `npx vue-tsc --noEmit` | **exit 0** |
| `npx vite build` | **exit 0** |
| PWA 产物 | `dist/sw.js`、`dist/manifest.webmanifest` 正常生成 |

探针工程最终锁定（`package.json` 实测）：

```json
{
  "dependencies": { "pinia": "4.1.0", "vue": "3.5.45", "vue-router": "5.5.1" },
  "devDependencies": {
    "@vitejs/plugin-vue": "6.0.11", "typescript": "5.9.3", "vite": "8.3.8",
    "vite-plugin-pwa": "2.0.0", "vue-tsc": "3.3.14"
  }
}
```

## 6. 决策与文档联动

- **M2 工具链锁定 TypeScript 5.9.3，不使用 7.0.2**。
- `docs/DEPENDENCIES.md` §4 已把 `typescript` 行从 7.0.2 改为 **5.9.3**，并附实证原因与本报告链接。
- `docs/RISKS.md R4.3` 状态由「待验证（M2）」改为「**已验证并缓解**」。
- `TODO.md` M2「开工首检」项已勾选。

## 7. 首检后的脚手架落地（同日完成，真实验证）

按本报告锁定的组合创建 `frontend/`（细节见 `frontend/README.md`）：
`package.json` / `package-lock.json` / `tsconfig.json` / `vite.config.ts` / `index.html`、
`src/{main.ts, App.vue, env.d.ts}`、`src/styles/{tokens.css, base.css}`、
`src/stores/ui.ts`、`src/components/UpdatePrompt.vue`、`src/views/BootView.vue`、
`public/icons/icon.svg`。

| 门禁 | 结果 |
|---|---|
| 实际安装版本核对 | `matrix-js-sdk 45.1.0` → `@matrix-org/matrix-sdk-crypto-wasm 18.9.2`（SDK requires `18.9.2`），与 M0 锁定一致 |
| `npm run typecheck` | `vue-tsc --noEmit` **exit 0** |
| `npm run build` | **exit 0**；36 modules；JS 100.62 kB / CSS 6.81 kB |
| PWA 产物 | `dist/sw.js`、`dist/workbox-*.js`、`dist/manifest.webmanifest`、`dist/icons/icon.svg`；precache 7 项 |
| 入库范围 | `frontend/node_modules/`、`frontend/dist/` 均被 `.gitignore` 忽略；`package-lock.json` 入库 |

**新发现的依赖踩坑**：首轮 `npm install --prefer-offline` 报
`ETARGET No matching version found for @vitest/mocker@5.1.0`。经 `npm view @vitest/mocker@5.1.0`
核对该版本**确实存在**，属「离线优先读取过期 packument」；改用 `--prefer-online` 后
成功安装 440 包。本工程**禁用 `--prefer-offline`**，已写入 `frontend/README.md`。

设计要点落实：深色默认 + `[data-theme="light"]` 浅色切换（设计令牌）、iPhone 安全区与
44px 最小点击区、`registerType: "prompt"` 的 PWA 更新提示。
**安全边界**：Service Worker 通过 `navigateFallbackDenylist` 排除 `/_matrix/*` 与
`/invite-api/*`，`runtimeCaching: []`，只预缓存应用外壳 ——
API 响应、注册令牌与密文事件不落入 SW 缓存。

## 8. 未完成 / 边界声明

- **MatrixService、登录/邀请注册、会话列表、聊天界面、单元测试与双浏览器 E2E 均未创建**。
  `BootView.vue` 已明确标注「尚未接线」，不制造功能可用的假象。
- 未验证项（留待实现时按安装版 `.d.ts` / 官方文档逐个确认，遇不确定 API 即停下查证）：
  `initRustCrypto` 在浏览器打包下的 WASM 资源路径（M0 F4）、MatrixRTC 子路径导出（M6）、
  多设备 E2EE 在真实 PWA 中的行为。
- 探针目录 `.tmp-gen/m2-probe` 为临时验证工程，被 `.gitignore` 忽略，不作为交付物。

## 9. 结论

M2 工具链组合已实证、唯一阻断项（TS7 / vue-tsc 不兼容）经降级 TypeScript 5.9.3 解决；
前端脚手架与设计系统基座已落地且类型检查/生产构建通过。
**M2 的业务功能（MatrixService 与界面）仍待开发，本报告不宣称其完成。**
