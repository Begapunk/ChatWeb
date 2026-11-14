<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    name: string;
    initials?: string;
    color?: string;
    size?: number;
    online?: boolean;
  }>(),
  { initials: "", color: "#4fd1c5", size: 44, online: false },
);

const label = computed<string>(() => props.initials || props.name.slice(0, 1));
</script>

<template>
  <span
    class="avatar"
    :style="{ '--size': `${size}px`, '--tint': color }"
    :aria-label="name"
    role="img"
  >
    <span class="avatar__text">{{ label }}</span>
    <span v-if="online" class="avatar__dot" aria-hidden="true"></span>
  </span>
</template>

<style scoped>
.avatar {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--size);
  height: var(--size);
  border-radius: 34%;
  background: color-mix(in srgb, var(--tint) 22%, var(--ae-bg-elev-2));
  border: 1px solid color-mix(in srgb, var(--tint) 42%, transparent);
  color: var(--tint);
  font-size: calc(var(--size) * 0.4);
  font-weight: 700;
  line-height: 1;
  user-select: none;
}

.avatar__dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--ae-success);
  border: 2px solid var(--ae-bg-elev);
}
</style>
