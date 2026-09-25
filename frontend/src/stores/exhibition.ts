import { defineStore } from 'pinia';
import { exhibitionRepository, publicationRepository, tourRepository } from '@/api/storage';
import type {
  Exhibition,
  ExhibitionDraft,
  Publication,
  PublishIssue,
  PublishResult,
  Tour
} from '@/types';
import { createId } from '@/utils/storage';
import {
  buildPublication,
  collectPublishIssues,
  deletePublicationFiles,
  hydratePublication
} from '@/utils/publication';
import { useArtifactStore } from './artifact';
import { useTourStore } from './tour';

function createSeedExhibition(artifactIds: string[]): Exhibition {
  const now = new Date().toISOString();
  return {
    id: 'exhibition-heritage-hall',
    title: '手作纹理常设展',
    intro: '围绕陶、绣、漆、竹四类工艺组织展陈，强调材料、手势和纹样的对照关系。',
    curator: '云上工艺馆',
    artifactIds,
    themeColor: '#173f35',
    backgroundMusicUrl: '',
    createdAt: now,
    updatedAt: now
  };
}

/** 旧版本库记录里可能残留的 status 字段，迁移时用来判断当时是否处于发布状态。 */
const legacyStatusById = new Map<string, string>();

export const useExhibitionStore = defineStore('exhibition', {
  state: () => ({
    exhibitions: [] as Exhibition[],
    publications: [] as Publication[],
    loaded: false
  }),
  getters: {
    getById: (state) => (id: string) => state.exhibitions.find((exhibition) => exhibition.id === id),
    /** 某展览的全部发布版本，版本号从大到小排列。 */
    publicationsOf: (state) => (exhibitionId: string) =>
      state.publications
        .filter((publication) => publication.exhibitionId === exhibitionId)
        .sort((a, b) => b.version - a.version),
    /** 某展览最新（即正在展厅展出）的发布版本。 */
    latestPublicationOf: (state) => (exhibitionId: string) =>
      state.publications
        .filter((publication) => publication.exhibitionId === exhibitionId)
        .sort((a, b) => b.version - a.version)[0],
    /** 展厅使用的展览列表：只包含已有发布版本的展览。 */
    publishedExhibitions(state): Exhibition[] {
      const publishedIds = new Set(state.publications.map((publication) => publication.exhibitionId));
      return state.exhibitions.filter((exhibition) => publishedIds.has(exhibition.id));
    },
    /** 全局最新发布版本，用于 3D 展厅默认入口。 */
    latestPublication(state): Publication | undefined {
      return [...state.publications].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt)
      )[0];
    }
  },
  actions: {
    async load() {
      const artifactStore = useArtifactStore();
      const records = await exhibitionRepository.list();
      if (records.length === 0) {
        const seed = createSeedExhibition(artifactStore.artifacts.map((artifact) => artifact.id));
        await exhibitionRepository.save(seed);
        this.exhibitions = [seed];
      } else {
        this.exhibitions = records;
        records.forEach((record) => {
          const status = (record as { status?: string }).status;
          if (typeof status === 'string') legacyStatusById.set(record.id, status);
        });
      }

      const storedPublications = await publicationRepository.list();
      this.publications = await Promise.all(storedPublications.map(hydratePublication));

      this.loaded = true;
    },
    /**
     * 旧版本库没有发布快照：首次升级后，为当时处于发布状态的展览冻结 v1，
     * 保证已有用户打开应用仍能进入展厅。新建库的种子展览也走这里自动首发。
     */
    async migrateLegacyPublications() {
      const artifactStore = useArtifactStore();
      const tourStore = useTourStore();

      for (const exhibition of this.exhibitions) {
        if (this.publicationsOf(exhibition.id).length > 0) continue;
        const isSeed = exhibition.id === 'exhibition-heritage-hall';
        const wasPublished = legacyStatusById.get(exhibition.id) === 'published';
        if (!isSeed && !wasPublished) continue;

        const tours = tourStore.byExhibitionId(exhibition.id);
        const { publication } = await buildPublication({
          exhibition,
          artifacts: artifactStore.artifacts,
          tours,
          version: 1,
          strict: false
        });
        if (publication) {
          await publicationRepository.save(publication);
          this.publications.push(await hydratePublication(publication));
        }
      }
    },
    async createExhibition(draft: ExhibitionDraft) {
      const now = new Date().toISOString();
      const exhibition: Exhibition = {
        ...draft,
        id: createId('exhibition'),
        createdAt: now,
        updatedAt: now
      };
      this.exhibitions.unshift(exhibition);
      await exhibitionRepository.save(exhibition);
      return exhibition;
    },
    async updateExhibition(id: string, patch: Partial<ExhibitionDraft>) {
      const current = this.getById(id);
      if (!current) return;
      const updated: Exhibition = { ...current, ...patch, updatedAt: new Date().toISOString() };
      this.exhibitions = this.exhibitions.map((exhibition) => (exhibition.id === id ? updated : exhibition));
      await exhibitionRepository.save(updated);
    },
    async deleteExhibition(id: string) {
      await Promise.all(
        this.publicationsOf(id).map(async (publication) => {
          await deletePublicationFiles(publication);
          await publicationRepository.remove(publication.id);
        })
      );
      this.publications = this.publications.filter((publication) => publication.exhibitionId !== id);
      this.exhibitions = this.exhibitions.filter((exhibition) => exhibition.id !== id);
      await exhibitionRepository.remove(id);
    },
    async reorderArtifacts(id: string, artifactIds: string[]) {
      await this.updateExhibition(id, { artifactIds });
    },
    /**
     * 发布：校验展品与导览引用，冻结文案、展品顺序与资料、主题和导览节点。
     * 存在缺件时不写入新版本，草稿和旧发布版本原样保留。
     */
    async publishExhibition(id: string): Promise<PublishResult> {
      const exhibition = this.getById(id);
      const artifactStore = useArtifactStore();
      const tourStore = useTourStore();
      if (!exhibition) {
        return {
          ok: false,
          issues: [{ type: 'missing-artifact', message: '展览不存在，无法发布。' }]
        };
      }

      const tours = tourStore.byExhibitionId(id);
      const nextVersion = (this.publicationsOf(id)[0]?.version ?? 0) + 1;
      const result = await buildPublication({
        exhibition,
        artifacts: artifactStore.artifacts,
        tours,
        version: nextVersion,
        strict: true
      });

      if (!result.publication) {
        return { ok: false, issues: result.issues };
      }

      await publicationRepository.save(result.publication);
      this.publications.push(await hydratePublication(result.publication));
      return { ok: true, publication: result.publication, issues: result.issues };
    },
    /** 预检发布，只返回缺件说明，不写任何数据（供后台在发布前提示）。 */
    previewPublishIssues(id: string): PublishIssue[] {
      const exhibition = this.getById(id);
      if (!exhibition) return [];
      const tourStore = useTourStore();
      const artifactStore = useArtifactStore();
      const artifactById = new Map(artifactStore.artifacts.map((artifact) => [artifact.id, artifact]));
      return collectPublishIssues(exhibition, artifactById, tourStore.byExhibitionId(id));
    },
    /**
     * 把旧发布版本载入草稿：快照中的展览文案、展品顺序、主题和导览节点
     * 写回各编辑表，但不改变正在展出的版本；重新发布后才会替换展厅。
     */
    async loadVersionToDraft(publicationId: string) {
      const publication = this.publications.find((item) => item.id === publicationId);
      if (!publication) return;

      const now = new Date().toISOString();
      const updated: Exhibition = {
        ...this.getById(publication.exhibitionId),
        id: publication.exhibitionId,
        title: publication.title,
        intro: publication.intro,
        curator: publication.curator,
        artifactIds: [...publication.artifactIds],
        themeColor: publication.themeColor,
        backgroundMusicUrl: publication.backgroundMusicUrl ?? '',
        createdAt: this.getById(publication.exhibitionId)?.createdAt ?? now,
        updatedAt: now
      } as Exhibition;
      await exhibitionRepository.save(updated);
      this.exhibitions = this.exhibitions.map((exhibition) =>
        exhibition.id === updated.id ? updated : exhibition
      );

      const tourStore = useTourStore();
      await Promise.all(
        publication.tours.map(async (snapshot) => {
          const liveTour = tourStore.getById(snapshot.id);
          const nextTour: Tour = {
            id: snapshot.id,
            exhibitionId: publication.exhibitionId,
            name: snapshot.name,
            nodes: snapshot.nodes.map((node) => ({
              ...node,
              cameraPosition: { ...node.cameraPosition },
              targetPosition: { ...node.targetPosition }
            })),
            createdAt: liveTour?.createdAt ?? snapshot.createdAt,
            updatedAt: now
          };
          await tourRepository.save(nextTour);
          if (liveTour) {
            tourStore.tours = tourStore.tours.map((tour) => (tour.id === nextTour.id ? nextTour : tour));
          } else {
            tourStore.tours.unshift(nextTour);
          }
        })
      );
    }
  }
});
