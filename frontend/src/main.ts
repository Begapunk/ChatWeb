import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "./styles/tokens.css";
import "./styles/base.css";

// 演示模式入口：只挂载本地状态层与 UI 路由。
// 未接入 matrix-js-sdk / Rust Crypto WASM / Synapse，详见 src/services/matrix.ts。
createApp(App).use(createPinia()).use(router).mount("#app");
