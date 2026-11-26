import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import ConversationsView from "../views/ConversationsView.vue";
import ChatView from "../views/ChatView.vue";
import SearchView from "../views/SearchView.vue";
import SettingsView from "../views/SettingsView.vue";
import NetworkTestView from "../views/NetworkTestView.vue";
import P2PView from "../views/P2PView.vue";

// 两种模式共用同一套路由：
// - demo：纯内存演示数据，打开首页即是会话列表，用于无服务器试用界面；
// - live：真实 Synapse + Rust Crypto WASM，凭据只在内存，从 /login「连接真实服务器」进入。
// 整页刷新导致 live 会话失效时，由 main.ts 的一次性守卫强制重定向回 /login 并给出原因提示，
// 绝不静默回退演示假数据。
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    { path: "/", name: "p2p", component: P2PView },
    { path: "/legacy", name: "conversations", component: ConversationsView },
    { path: "/chat/:roomId", name: "chat", component: ChatView },
    { path: "/search", name: "search", component: SearchView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/network-test", name: "network-test", component: NetworkTestView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
