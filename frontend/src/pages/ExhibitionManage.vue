<template>
  <section class="manage-page">
    <div class="page-head">
      <div>
        <h1>展览管理</h1>
        <p>编辑的是草稿，不影响正在展出的版本；点击发布冻结文案、展品顺序与资料、主题和导览节点。</p>
      </div>
      <n-button type="primary" @click="startCreate">新建展览</n-button>
    </div>

    <div class="manage-grid">
      <section class="exhibition-list">
        <ExhibitionCard
          v-for="item in exhibitionStore.exhibitions"
          :key="item.id"
          :exhibition="item"
          :artifact-count="item.artifactIds.length"
          :versions="exhibitionStore.publicationsOf(item.id)"
          @open="router.push(`/exhibitions/${$event}`)"
          @edit="selectExhibition"
        />
      </section>

      <section class="panel-surface editor-panel">
        <header>
          <h2>{{ isCreating ? '创建展览' : '编辑展览草稿' }}</h2>
          <n-button v-if="selectedId" quaternary type="error" @click="deleteSelected">删除</n-button>
        </header>
        <n-form label-placement="top" :show-feedback="false" class="form-stack">
          <n-form-item label="标题">
            <n-input v-model:value="draft.title" placeholder="展览标题" />
          </n-form-item>
          <n-form-item label="简介">
            <n-input v-model:value="draft.intro" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" />
          </n-form-item>
          <div class="field-grid">
            <n-form-item label="策展人">
              <n-input v-model:value="draft.curator" />
            </n-form-item>
            <n-form-item label="展厅主题色">
              <n-color-picker v-model:value="draft.themeColor" :show-alpha="false" />
            </n-form-item>
          </div>
          <n-form-item label="背景音乐 URL">
            <n-input v-model:value="draft.backgroundMusicUrl" placeholder="可选" />
          </n-form-item>
          <ArtifactPicker v-model="draft.artifactIds" :artifacts="artifactStore.artifacts" />

          <n-alert v-if="missingArtifactIds.length" type="warning" :bordered="false" title="草稿引用了已移除的展品">
            <span v-for="id in missingArtifactIds" :key="id" class="missing-chip">{{ id }}</span>
            <p>发布前请重新选择这些展品，否则展厅会出现空位。</p>
          </n-alert>
          <n-alert v-if="orphanTourAlerts.length" type="warning" :bordered="false" title="导览节点引用了已移除的展品">
            <p v-for="alert in orphanTourAlerts" :key="alert.key">{{ alert.message }}</p>
          </n-alert>

          <section class="picked-artifacts">
            <h3>已选展品预览</h3>
            <ArtifactCard
              v-for="artifact in pickedArtifacts"
              :key="artifact.id"
              :artifact="artifact"
              compact
              @open="router.push(`/artifacts/${$event}`)"
            />
          </section>
          <div class="form-actions">
            <n-button type="primary" @click="saveExhibition">{{ isCreating ? '创建' : '保存草稿' }}</n-button>
            <n-button v-if="selectedId" type="primary" secondary @click="publishSelected">发布新版本</n-button>
          </div>
        </n-form>

        <section v-if="selectedId && versions.length" class="version-panel">
          <h3>发布版本</h3>
          <p class="version-tip">展厅与自动导览只展示最新版本；把旧版本载入草稿后需重新发布才会替换展厅。</p>
          <div class="version-table">
            <div v-for="version in versions" :key="version.id" class="version-row">
              <div class="version-main">
                <strong>v{{ version.version }}</strong>
                <span>{{ formatTime(version.publishedAt) }}</span>
                <em>{{ version.artifacts.length }} 件展品 · {{ version.tours[0]?.nodes.length ?? 0 }} 个导览节点</em>
              </div>
              <n-button
                size="small"
                :type="version.id === versions[0]?.id ? 'success' : 'default'"
                secondary
                @click="loadVersion(version.id)"
              >
                {{ version.id === versions[0]?.id ? '当前展出 · 载入草稿' : '载入草稿' }}
              </n-button>
            </div>
          </div>
        </section>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useMessage } from 'naive-ui';
import ArtifactPicker from '@/components/editor/ArtifactPicker.vue';
import ArtifactCard from '@/components/common/ArtifactCard.vue';
import ExhibitionCard from '@/components/common/ExhibitionCard.vue';
import { useArtifactStore } from '@/stores/artifact';
import { useExhibitionStore } from '@/stores/exhibition';
import type { Artifact, ExhibitionDraft, PublishIssue } from '@/types';

const router = useRouter();
const message = useMessage();
const artifactStore = useArtifactStore();
const exhibitionStore = useExhibitionStore();

const selectedId = ref(exhibitionStore.exhibitions[0]?.id ?? '');
const isCreating = ref(false);
const draft = reactive<ExhibitionDraft>(emptyDraft());

const selected = computed(() => exhibitionStore.getById(selectedId.value));
const versions = computed(() => (selectedId.value ? exhibitionStore.publicationsOf(selectedId.value) : []));
const pickedArtifacts = computed<Artifact[]>(() =>
  draft.artifactIds.map((id) => artifactStore.getById(id)).filter((artifact): artifact is Artifact => Boolean(artifact))
);
const missingArtifactIds = computed(() =>
  draft.artifactIds.filter((id) => !artifactStore.getById(id))
);
const orphanTourAlerts = computed(() => {
  if (!selectedId.value) return [];
  const issues = exhibitionStore.previewPublishIssues(selectedId.value).filter(
    (issue): issue is PublishIssue & { tourName: string } => issue.type === 'orphan-tour-node'
  );
  return issues.map((issue) => ({ key: `${issue.tourName}-${issue.artifactId}`, message: issue.message }));
});

watch(
  selected,
  (value) => {
    if (!value || isCreating.value) return;
    Object.assign(draft, {
      title: value.title,
      intro: value.intro,
      curator: value.curator,
      artifactIds: [...value.artifactIds],
      themeColor: value.themeColor,
      backgroundMusicUrl: value.backgroundMusicUrl ?? ''
    });
  },
  { immediate: true }
);

function emptyDraft(): ExhibitionDraft {
  return {
    title: '',
    intro: '',
    curator: '',
    artifactIds: artifactStore.artifacts.map((artifact) => artifact.id),
    themeColor: '#173f35',
    backgroundMusicUrl: ''
  };
}

function startCreate() {
  isCreating.value = true;
  selectedId.value = '';
  Object.assign(draft, emptyDraft());
}

function selectExhibition(id: string) {
  isCreating.value = false;
  selectedId.value = id;
}

async function saveExhibition() {
  if (!draft.title.trim()) {
    message.warning('请填写展览标题');
    return;
  }
  if (isCreating.value) {
    const created = await exhibitionStore.createExhibition({ ...draft, artifactIds: [...draft.artifactIds] });
    selectedId.value = created.id;
    isCreating.value = false;
    message.success('展览草稿已创建');
    return;
  }
  if (selectedId.value) {
    await exhibitionStore.updateExhibition(selectedId.value, { ...draft, artifactIds: [...draft.artifactIds] });
    message.success('草稿已保存，不会影响正在展出的版本');
  }
}

async function publishSelected() {
  if (!selectedId.value) return;
  // 先把草稿落库，再冻结发布，确保发布内容与表单一致。
  await exhibitionStore.updateExhibition(selectedId.value, { ...draft, artifactIds: [...draft.artifactIds] });
  const result = await exhibitionStore.publishExhibition(selectedId.value);
  if (!result.ok) {
    message.warning(`发布被阻止：共有 ${result.issues.length} 处缺件，草稿与旧版本均已保留`);
    return;
  }
  message.success(`v${result.publication?.version} 已发布，展厅已切换到最新版本`);
}

async function loadVersion(publicationId: string) {
  await exhibitionStore.loadVersionToDraft(publicationId);
  message.success('旧版本内容已载入草稿，重新发布后才会替换展厅');
}

async function deleteSelected() {
  if (!selectedId.value) return;
  await exhibitionStore.deleteExhibition(selectedId.value);
  selectedId.value = exhibitionStore.exhibitions[0]?.id ?? '';
  isCreating.value = !selectedId.value;
  Object.assign(draft, selected.value ?? emptyDraft());
  message.success('展览及其发布版本已删除');
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>

<style scoped>
.manage-page {
  display: grid;
  gap: 18px;
}

.manage-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(420px, 1.1fr);
  gap: 18px;
  align-items: start;
}

.exhibition-list {
  display: grid;
  gap: 14px;
}

.editor-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.editor-panel header,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.picked-artifacts {
  display: grid;
  gap: 10px;
}

.picked-artifacts h3,
.version-panel h3 {
  margin: 0;
  font-size: 15px;
}

.editor-panel h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 30px;
}

.form-stack {
  display: grid;
  gap: 10px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.missing-chip {
  display: inline-block;
  margin: 0 6px 6px 0;
  padding: 2px 8px;
  font-size: 12px;
  background: rgba(187, 77, 62, 0.12);
  border-radius: 999px;
}

.version-panel {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid rgba(23, 63, 53, 0.14);
}

.version-tip {
  margin: 0;
  color: rgba(31, 46, 41, 0.62);
  font-size: 13px;
}

.version-table {
  display: grid;
  gap: 8px;
}

.version-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(250, 246, 236, 0.78);
  border: 1px solid rgba(23, 63, 53, 0.12);
  border-radius: 6px;
}

.version-main {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.version-main strong {
  font-size: 15px;
}

.version-main span {
  color: rgba(31, 46, 41, 0.72);
  font-size: 13px;
}

.version-main em {
  color: var(--museum-brass);
  font-size: 12px;
  font-style: normal;
}

@media (max-width: 1080px) {
  .manage-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
