<template>
  <section class="manage-page">
    <div class="page-head">
      <div>
        <h1>展览管理</h1>
        <p>创建展览、调整展品顺序、设置主题色并发布到 3D 展厅。</p>
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
          @open="router.push(`/exhibitions/${$event}`)"
          @edit="selectExhibition"
        />
      </section>

      <section class="panel-surface editor-panel">
        <header>
          <h2>{{ isCreating ? '创建展览' : '编辑展览' }}</h2>
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
            <n-form-item label="当前展出">
              <n-tag :bordered="false">
                {{ latestVersion ? `v${latestVersion.version} · ${formatTime(latestVersion.publishedAt)}` : '尚未发布' }}
              </n-tag>
            </n-form-item>
          </div>
          <div class="field-grid">
            <n-form-item label="展厅主题色">
              <n-color-picker v-model:value="draft.themeColor" :show-alpha="false" />
            </n-form-item>
            <n-form-item label="背景音乐 URL">
              <n-input v-model:value="draft.backgroundMusicUrl" placeholder="可选" />
            </n-form-item>
          </div>
          <ArtifactPicker v-model="draft.artifactIds" :artifacts="artifactStore.artifacts" />
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
          <n-alert
            v-if="publishIssues.length > 0"
            type="error"
            closable
            title="发布失败，缺少以下展品（草稿与当前展出版本已保留）"
            @close="publishIssues = []"
          >
            <ul class="issue-list">
              <li v-for="(issue, index) in publishIssues" :key="index">{{ issue.message }}</li>
            </ul>
          </n-alert>
          <div class="form-actions">
            <n-button type="primary" @click="saveExhibition">{{ isCreating ? '创建' : '保存' }}</n-button>
            <n-button v-if="selectedId" secondary :loading="publishing" @click="publishSelected">发布</n-button>
          </div>
        </n-form>

        <section v-if="selectedId && !isCreating" class="version-history">
          <header>
            <h3>发布历史</h3>
            <span>展厅只展示最新版本，载入旧版本后需重新发布</span>
          </header>
          <p v-if="versions.length === 0" class="version-empty">还没有发布版本，点击“发布”生成首个快照。</p>
          <ul v-else>
            <li v-for="item in versions" :key="item.id">
              <div class="version-meta">
                <n-tag size="small" :bordered="false" :type="item.id === latestVersion?.id ? 'success' : 'default'">
                  v{{ item.version }}
                </n-tag>
                <span>{{ formatTime(item.publishedAt) }}</span>
                <span>{{ item.artifactCount }} 件展品</span>
              </div>
              <n-button size="small" quaternary @click="loadVersion(item.id)">载入草稿</n-button>
            </li>
          </ul>
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
import { useExhibitionVersionStore } from '@/stores/version';
import type { Artifact, ExhibitionDraft, PublishIssue } from '@/types';
import { ExhibitionStatus } from '@/types';

const router = useRouter();
const message = useMessage();
const artifactStore = useArtifactStore();
const exhibitionStore = useExhibitionStore();
const versionStore = useExhibitionVersionStore();

const selectedId = ref(exhibitionStore.exhibitions[0]?.id ?? '');
const isCreating = ref(false);
const publishing = ref(false);
const publishIssues = ref<PublishIssue[]>([]);
const draft = reactive<ExhibitionDraft>(emptyDraft());

const selected = computed(() => exhibitionStore.getById(selectedId.value));
const pickedArtifacts = computed<Artifact[]>(() =>
  draft.artifactIds.map((id) => artifactStore.getById(id)).filter((artifact): artifact is Artifact => Boolean(artifact))
);
const versions = computed(() => (selectedId.value ? versionStore.byExhibitionId(selectedId.value) : []));
const latestVersion = computed(() => versions.value[0]);

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
      backgroundMusicUrl: value.backgroundMusicUrl ?? '',
      status: value.status
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
    backgroundMusicUrl: '',
    status: ExhibitionStatus.Draft
  };
}

function startCreate() {
  isCreating.value = true;
  selectedId.value = '';
  publishIssues.value = [];
  Object.assign(draft, emptyDraft());
}

function selectExhibition(id: string) {
  isCreating.value = false;
  selectedId.value = id;
  publishIssues.value = [];
}

async function persistDraft(): Promise<boolean> {
  if (!draft.title.trim()) {
    message.warning('请填写展览标题');
    return false;
  }
  if (isCreating.value) {
    const created = await exhibitionStore.createExhibition({ ...draft, artifactIds: [...draft.artifactIds] });
    selectedId.value = created.id;
    isCreating.value = false;
    return true;
  }
  if (selectedId.value) {
    await exhibitionStore.updateExhibition(selectedId.value, { ...draft, artifactIds: [...draft.artifactIds] });
    return true;
  }
  return false;
}

async function saveExhibition() {
  const wasCreating = isCreating.value;
  if (await persistDraft()) {
    message.success(wasCreating ? '展览已创建' : '展览已保存');
  }
}

async function publishSelected() {
  if (!selectedId.value || publishing.value) return;
  publishing.value = true;
  publishIssues.value = [];
  try {
    if (!(await persistDraft())) return;
    const result = await versionStore.publish(selectedId.value);
    if (result.ok) {
      message.success(`已发布 v${result.version.version}，展厅与自动导览已更新`);
    } else {
      publishIssues.value = result.issues;
      message.error('发布失败：缺少展品，草稿与当前展出版本保持不变');
    }
  } finally {
    publishing.value = false;
  }
}

async function loadVersion(versionId: string) {
  if (await versionStore.loadVersionToDraft(versionId)) {
    publishIssues.value = [];
    message.success('已载入草稿，重新发布后才会替换展厅');
  } else {
    message.error('版本载入失败');
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

async function deleteSelected() {
  if (!selectedId.value) return;
  await versionStore.removeVersionsForExhibition(selectedId.value);
  await exhibitionStore.deleteExhibition(selectedId.value);
  selectedId.value = exhibitionStore.exhibitions[0]?.id ?? '';
  isCreating.value = !selectedId.value;
  publishIssues.value = [];
  Object.assign(draft, selected.value ?? emptyDraft());
  message.success('展览已删除');
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

.picked-artifacts h3 {
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

.issue-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.7;
}

.version-history {
  display: grid;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid rgba(23, 63, 53, 0.12);
}

.version-history header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.version-history h3 {
  margin: 0;
  font-size: 15px;
}

.version-history header span,
.version-empty {
  margin: 0;
  color: rgba(31, 46, 41, 0.58);
  font-size: 13px;
}

.version-history ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.version-history li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: rgba(251, 245, 232, 0.72);
  border: 1px solid rgba(23, 63, 53, 0.1);
  border-radius: 8px;
}

.version-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(31, 46, 41, 0.72);
  font-size: 13px;
}

@media (max-width: 1080px) {
  .manage-grid,
  .field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
