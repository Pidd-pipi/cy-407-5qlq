import { defineStore } from 'pinia';
import { exhibitionVersionRepository } from '@/api/storage';
import {
  ExhibitionStatus,
  type Artifact,
  type ExhibitionVersion,
  type PublishIssue,
  type PublishResult,
  type TourNode
} from '@/types';
import { copyBlobFile, createId, deleteBlobFile } from '@/utils/storage';
import { hydrateArtifactMedia, useArtifactStore } from './artifact';
import { useExhibitionStore } from './exhibition';
import { useTourStore } from './tour';

function cloneNodes(nodes: TourNode[]): TourNode[] {
  return nodes.map((node) => ({
    ...node,
    cameraPosition: { ...node.cameraPosition },
    targetPosition: { ...node.targetPosition }
  }));
}

async function freezeArtifact(artifact: Artifact): Promise<Artifact> {
  // 快照复制一份图片/模型文件，展品库后续删改不会影响已发布版本
  const imageFileIds: string[] = [];
  for (const fileId of artifact.imageFileIds) {
    const copy = await copyBlobFile(fileId);
    if (copy) imageFileIds.push(copy.id);
  }
  let modelFileId: string | undefined;
  if (artifact.modelFileId) {
    modelFileId = (await copyBlobFile(artifact.modelFileId))?.id;
  }

  return {
    ...artifact,
    images: artifact.images.filter((url) => !url.startsWith('blob:')),
    imageFileIds,
    modelFileId,
    modelUrl: modelFileId ? undefined : artifact.modelUrl
  };
}

async function hydrateVersion(version: ExhibitionVersion): Promise<ExhibitionVersion> {
  return {
    ...version,
    artifacts: await Promise.all(version.artifacts.map(hydrateArtifactMedia))
  };
}

export const useExhibitionVersionStore = defineStore('exhibitionVersion', {
  state: () => ({
    versions: [] as ExhibitionVersion[],
    loaded: false
  }),
  getters: {
    byExhibitionId: (state) => (exhibitionId: string) =>
      state.versions
        .filter((version) => version.exhibitionId === exhibitionId)
        .slice()
        .sort((a, b) => b.version - a.version),
    latestByExhibitionId(): (exhibitionId: string) => ExhibitionVersion | undefined {
      return (exhibitionId: string) => this.byExhibitionId(exhibitionId)[0];
    }
  },
  actions: {
    async load() {
      const records = await exhibitionVersionRepository.list();
      this.versions = await Promise.all(records.map(hydrateVersion));

      // 兼容旧数据：已发布但没有版本的展览，补一个初始快照
      const exhibitionStore = useExhibitionStore();
      for (const exhibition of exhibitionStore.exhibitions) {
        if (exhibition.status === ExhibitionStatus.Published && !this.latestByExhibitionId(exhibition.id)) {
          await this.publish(exhibition.id);
        }
      }
      this.loaded = true;
    },
    async publish(exhibitionId: string): Promise<PublishResult> {
      const exhibitionStore = useExhibitionStore();
      const artifactStore = useArtifactStore();
      const tourStore = useTourStore();
      const exhibition = exhibitionStore.getById(exhibitionId);
      if (!exhibition) {
        return { ok: false, issues: [{ source: 'exhibition', artifactId: '', message: '展览不存在，无法发布。' }] };
      }

      const issues: PublishIssue[] = [];
      const artifacts: Artifact[] = [];

      if (exhibition.artifactIds.length === 0) {
        issues.push({ source: 'exhibition', artifactId: '', message: '展览还没有展品，空展览不能发布。' });
      }
      exhibition.artifactIds.forEach((artifactId, index) => {
        const artifact = artifactStore.getById(artifactId);
        if (artifact) {
          artifacts.push(artifact);
        } else {
          issues.push({
            source: 'exhibition',
            artifactId,
            message: `展品清单第 ${index + 1} 位（${artifactId}）已不在展品库，请先在草稿中移除。`
          });
        }
      });

      const tour = tourStore.byExhibitionId(exhibitionId)[0];
      if (tour) {
        tour.nodes.forEach((node, index) => {
          const artifact = artifactStore.getById(node.artifactId);
          if (!artifact) {
            issues.push({
              source: 'tour',
              artifactId: node.artifactId,
              message: `导览第 ${index + 1} 站指向的展品（${node.artifactId}）已不存在，请在导览编辑中调整该节点。`
            });
          } else if (!exhibition.artifactIds.includes(node.artifactId)) {
            issues.push({
              source: 'tour',
              artifactId: node.artifactId,
              artifactName: artifact.name,
              message: `导览第 ${index + 1} 站指向的展品「${artifact.name}」已不在展览中，请将其加回展览或调整导览。`
            });
          }
        });
      }

      // 校验失败：草稿与旧版本保持原样
      if (issues.length > 0) {
        return { ok: false, issues };
      }

      const frozenArtifacts = await Promise.all(artifacts.map(freezeArtifact));
      const record: ExhibitionVersion = {
        id: createId('version'),
        exhibitionId,
        version: (this.latestByExhibitionId(exhibitionId)?.version ?? 0) + 1,
        title: exhibition.title,
        intro: exhibition.intro,
        curator: exhibition.curator,
        themeColor: exhibition.themeColor,
        backgroundMusicUrl: exhibition.backgroundMusicUrl ?? '',
        artifacts: frozenArtifacts,
        tour: tour ? { name: tour.name, nodes: cloneNodes(tour.nodes) } : null,
        artifactCount: frozenArtifacts.length,
        publishedAt: new Date().toISOString()
      };
      await exhibitionVersionRepository.save(record);
      this.versions.push(await hydrateVersion(record));
      await exhibitionStore.updateExhibition(exhibitionId, { status: ExhibitionStatus.Published });
      return { ok: true, version: record };
    },
    async loadVersionToDraft(versionId: string): Promise<boolean> {
      const version = this.versions.find((item) => item.id === versionId);
      if (!version) return false;
      const exhibitionStore = useExhibitionStore();
      const tourStore = useTourStore();
      const exhibition = exhibitionStore.getById(version.exhibitionId);
      if (!exhibition) return false;

      await exhibitionStore.updateExhibition(exhibition.id, {
        title: version.title,
        intro: version.intro,
        curator: version.curator,
        themeColor: version.themeColor,
        backgroundMusicUrl: version.backgroundMusicUrl ?? '',
        artifactIds: version.artifacts.map((artifact) => artifact.id)
      });

      if (version.tour) {
        const nodes = cloneNodes(version.tour.nodes);
        const existingTour = tourStore.byExhibitionId(exhibition.id)[0];
        if (existingTour) {
          await tourStore.updateTour(existingTour.id, { name: version.tour.name, nodes });
        } else {
          await tourStore.createTour({ exhibitionId: exhibition.id, name: version.tour.name, nodes });
        }
      }
      return true;
    },
    async removeVersionsForExhibition(exhibitionId: string) {
      const targets = this.versions.filter((version) => version.exhibitionId === exhibitionId);
      for (const version of targets) {
        const fileIds = version.artifacts
          .flatMap((artifact) => [...artifact.imageFileIds, artifact.modelFileId])
          .filter((fileId): fileId is string => Boolean(fileId));
        await Promise.all(fileIds.map((fileId) => deleteBlobFile(fileId)));
        await exhibitionVersionRepository.remove(version.id);
      }
      this.versions = this.versions.filter((version) => version.exhibitionId !== exhibitionId);
    }
  }
});
