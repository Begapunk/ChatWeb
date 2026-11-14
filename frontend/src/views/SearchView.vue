<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useChatStore } from "../stores/chat";
import { formatClock, formatDayLabel } from "../data/demo";

const chat = useChatStore();
const router = useRouter();

const query = computed<string>({
  get: () => chat.searchQuery,
  set: (value) => { chat.searchQuery = value; },
});

function goto(roomId: string): void {
  chat.openRoom(roomId);
  void router.push({ name: "chat", params: { roomId } });
}
</script>

<template>
  <section class="search">
    <h1>搜索</h1>
    <input
      v-model="query"
      class="ae-input search__input"
      type="search"
      placeholder="搜索消息内容或文件名…"
      aria-label="搜索消息"
    />

    <div v-if="!query.trim()" class="search__suggest">
      <p>可以试试这些关键词</p>
      <div class="search__chips">
        <button v-for="word in ['加密', 'demo', '界面', '撤回', '联调记录']" :key="word" type="button" @click="query = word">
          {{ word }}
        </button>
      </div>
    </div>

    <template v-else>
      <p class="search__count">找到 {{ chat.searchResults.length }} 条消息</p>
      <ul v-if="chat.searchResults.length" class="search__results">
        <li v-for="msg in chat.searchResults" :key="msg.id">
          <button type="button" @click="goto(msg.roomId)">
            <span class="search__room">{{ chat.roomOf(msg.roomId)?.name ?? "会话" }}</span>
            <span class="search__body">{{ msg.body || msg.attachment?.name }}</span>
            <span class="search__time">{{ formatDayLabel(msg.ts) }} {{ formatClock(msg.ts) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="search__empty">没有匹配的消息。</p>
    </template>
  </section>
</template>

<style scoped>
.search h1 {
  margin-bottom: 16px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.search__input {
  font-size: 15px;
}

.search__suggest {
  margin-top: 28px;
}

.search__suggest p {
  color: var(--ae-text-subtle);
  font-size: 12.5px;
}

.search__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.search__chips button {
  padding: 6px 13px;
  border: 1px solid var(--ae-border);
  border-radius: 999px;
  background: var(--ae-surface);
  color: var(--ae-text-muted);
  font-size: 13px;
}

.search__chips button:hover {
  color: var(--ae-accent);
  border-color: var(--ae-accent);
}

.search__count {
  margin: 20px 0 10px;
  color: var(--ae-text-subtle);
  font-size: 12.5px;
}

.search__results {
  border: 1px solid var(--ae-border);
  border-radius: var(--ae-radius);
  background: var(--ae-bg-elev);
  overflow: hidden;
}

.search__results li + li {
  border-top: 1px solid var(--ae-border);
}

.search__results button {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: transparent;
  text-align: left;
}

.search__results button:hover {
  background: var(--ae-surface-hover);
}

.search__room {
  color: var(--ae-accent);
  font-size: 12px;
  font-weight: 600;
}

.search__body {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search__time {
  color: var(--ae-text-subtle);
  font-size: 11.5px;
}

.search__empty {
  margin-top: 24px;
  color: var(--ae-text-subtle);
  font-size: 14px;
  text-align: center;
}
</style>
