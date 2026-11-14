import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import BootView from "./views/BootView.vue";
import "./styles/tokens.css";
import "./styles/base.css";

// M2 基座阶段只注册已实现的路由。登录/注册/会话/聊天等视图在对应功能完成测试后
// 再逐个加入，避免路由表里出现「点进去是空壳」的入口。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/", name: "boot", component: BootView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

createApp(App).use(createPinia()).use(router).mount("#app");
