<template>
  <article class="exhibition-card" :style="{ '--theme': exhibition.themeColor }">
    <div class="status-line">
      <span :class="{ unpublished: !published }">{{ published ? `已发布 · 最新 v${latestVersion}` : '草稿 · 未发布' }}</span>
      <strong>{{ artifactCount }} 件展品</strong>
    </div>
    <h3>{{ exhibition.title }}</h3>
    <p>{{ exhibition.intro }}</p>
    <footer>
      <span>{{ exhibition.curator }}</span>
      <div>
        <n-button size="small" secondary :disabled="!published" @click="$emit('open', exhibition.id)">进入展厅</n-button>
        <n-button size="small" quaternary @click="$emit('edit', exhibition.id)">编辑</n-button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Exhibition } from '@/types';

const props = defineProps<{
  exhibition: Exhibition;
  artifactCount: number;
  /** 已有的发布版本（版本号从大到小），空数组表示从未发布。 */
  versions: { version: number }[];
}>();

const published = computed(() => props.versions.length > 0);
const latestVersion = computed(() => props.versions[0]?.version ?? 0);

defineEmits<{
  open: [id: string];
  edit: [id: string];
}>();
</script>

<style scoped>
.exhibition-card {
  display: grid;
  gap: 14px;
  min-height: 220px;
  padding: 20px;
  background:
    linear-gradient(90deg, var(--theme), var(--theme)) 0 0 / 6px 100% no-repeat,
    #fbf5e8;
  border: 1px solid rgba(23, 63, 53, 0.14);
  border-radius: 8px;
}

.status-line,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-line {
  color: var(--museum-green);
  font-size: 13px;
  font-weight: 800;
}

.status-line .unpublished {
  color: var(--museum-brass);
}

h3 {
  margin: 0;
  color: var(--museum-ink);
  font-family: var(--font-display);
  font-size: 28px;
  line-height: 1.05;
}

p {
  margin: 0;
  color: rgba(31, 46, 41, 0.7);
  line-height: 1.65;
}

footer {
  align-self: end;
  color: rgba(31, 46, 41, 0.64);
  font-size: 13px;
}

footer div {
  display: flex;
  gap: 8px;
}
</style>
