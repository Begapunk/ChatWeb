import { createRouter, createWebHistory } from "vue-router";
import LoginView from "../views/LoginView.vue";
import ConversationsView from "../views/ConversationsView.vue";
import ChatView from "../views/ChatView.vue";
import SearchView from "../views/SearchView.vue";
import SettingsView from "../views/SettingsView.vue";

// 演示模式默认已「登录」，打开首页即是会话列表；登录/邀请码注册界面从设置页进入。
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    { path: "/", name: "conversations", component: ConversationsView },
    { path: "/chat/:roomId", name: "chat", component: ChatView },
    { path: "/search", name: "search", component: SearchView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
