import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { clearLiveSession, hadLiveSession, matrixServiceStatus } from "./services/matrix";
import "./styles/tokens.css";
import "./styles/base.css";

// 真实链路（M2-R）：凭据（access_token / device_id）、口令与 storageKey 只在内存中，
// 不写入 localStorage / sessionStorage。因此整页刷新或重新打开页面必然丢失真实会话。
//
// 安全要求：绝不能在这种情况下静默回退到「演示假数据」——用户会误以为自己仍在
// 加密会话里。这里用一次性导航守卫检测「曾建立过 live 会话但当前无连接」，
// 清除非敏感标记、强制回到登录页并给出明确原因提示。
let liveSessionChecked = false;
router.beforeEach((to) => {
  if (liveSessionChecked) return true;
  liveSessionChecked = true;
  if (hadLiveSession() && !matrixServiceStatus.connected) {
    clearLiveSession();
    if (to.name !== "login") {
      return { name: "login", query: { ...to.query, reason: "session-expired" } };
    }
  }
  return true;
});

createApp(App).use(createPinia()).use(router).mount("#app");
