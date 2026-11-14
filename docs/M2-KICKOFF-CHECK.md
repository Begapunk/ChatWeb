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

## 7. 未完成 / 边界声明

- **本首检只验证工具链兼容性，未创建 `frontend/` 脚手架、未实现 MatrixService、未写任何 M2 界面或测试**。
- 未验证项（留待 M2 实现时按官方类型定义逐个确认，遇不确定 API 即停下查证）：
  `initRustCrypto` 在浏览器打包下的 WASM 资源路径（M0 F4）、MatrixRTC 子路径导出（M6）、
  多设备 E2EE 在真实 PWA 中的行为。
- 探针目录 `.tmp-gen/m2-probe` 为临时验证工程，被 `.gitignore` 忽略，不作为交付物。

## 8. 结论

M2 前端具备开工条件：工具链组合已通过最小工程实证，唯一阻断项（TS7 / vue-tsc 不兼容）已通过
降级到 TypeScript 5.9.3 解决并写入依赖锁定与风险清单。**M2 实际代码仍待下一步开发，本报告不宣称其完成。**
