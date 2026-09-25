import type {
  Artifact,
  ArtifactSnapshot,
  Exhibition,
  Publication,
  PublishIssue,
  Tour,
  TourSnapshot
} from '@/types';
import { cloneBlobFile, createBlobUrl, createId, deleteBlobFile, type StoredFile } from '@/utils/storage';

/** 把展品（或快照）中独立文件 id 对应的 Blob 还原为当前会话可用的 URL。 */
export async function hydrateArtifactMedia<T extends Artifact>(artifact: T): Promise<T> {
  const fileImages = await Promise.all(artifact.imageFileIds.map((fileId) => createBlobUrl(fileId)));
  const modelUrl = artifact.modelFileId ? await createBlobUrl(artifact.modelFileId) : artifact.modelUrl;
  const persistedImages = fileImages.filter((url): url is string => Boolean(url));

  return {
    ...artifact,
    images: persistedImages.length > 0 ? persistedImages : artifact.images,
    modelUrl
  };
}

/** 读取发布版本后，为快照中的展品资料重新挂上 Blob URL。 */
export async function hydratePublication(publication: Publication): Promise<Publication> {
  const artifacts = await Promise.all(publication.artifacts.map((artifact) => hydrateArtifactMedia(artifact)));
  return { ...publication, artifacts };
}

function isInlineImage(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 生成展品资料快照：把图片/模型 Blob 复制一份归快照所有，
 * 这样展品库删除原件或替换文件都不会影响已发布版本。
 */
export async function createArtifactSnapshot(artifact: Artifact): Promise<ArtifactSnapshot> {
  const imageFiles = (
    await Promise.all(artifact.imageFileIds.map((fileId) => cloneBlobFile(fileId)))
  ).filter((file): file is StoredFile => Boolean(file));
  const modelFile = artifact.modelFileId ? await cloneBlobFile(artifact.modelFileId) : undefined;

  return {
    ...artifact,
    imageFileIds: imageFiles.map((file) => file.id),
    images: imageFiles.length > 0 ? [] : artifact.images.filter(isInlineImage),
    modelFileId: modelFile?.id,
    modelUrl: modelFile ? undefined : artifact.modelUrl
  };
}

function snapshotTour(tour: Tour): TourSnapshot {
  return {
    id: tour.id,
    name: tour.name,
    createdAt: tour.createdAt,
    updatedAt: tour.updatedAt,
    nodes: tour.nodes.map((node) => ({
      ...node,
      cameraPosition: { ...node.cameraPosition },
      targetPosition: { ...node.targetPosition }
    }))
  };
}

export interface PublicationBuildInput {
  exhibition: Exhibition;
  /** 展品库中的最新展品，用于校验引用和冻结资料。 */
  artifacts: Artifact[];
  /** 该展览下的导览草稿。 */
  tours: Tour[];
  version: number;
  /** 严格模式：发现缺件时不产出快照（用户点击发布走严格模式；旧数据迁移不拦截）。 */
  strict: boolean;
}

export interface PublicationBuildResult {
  publication?: Publication;
  issues: PublishIssue[];
}

/** 收集发布前的缺件问题：展览空列表、展品顺序缺件、导览节点指向已删除展品。 */
export function collectPublishIssues(exhibition: Exhibition, artifactById: Map<string, Artifact>, tours: Tour[]): PublishIssue[] {
  const issues = new Map<string, PublishIssue>();

  if (exhibition.artifactIds.length === 0) {
    issues.set('empty', {
      type: 'empty',
      message: '展览还没有选择任何展品，无法发布。'
    });
  }

  exhibition.artifactIds.forEach((artifactId, index) => {
    if (!artifactById.has(artifactId)) {
      issues.set(`missing:${artifactId}`, {
        type: 'missing-artifact',
        artifactId,
        message: `展品顺序第 ${index + 1} 件引用的展品（${artifactId}）已从展品库移除，请重新选择后再发布。`
      });
    }
  });

  tours.forEach((tour) => {
    tour.nodes.forEach((node, index) => {
      if (!artifactById.has(node.artifactId)) {
        issues.set(`orphan:${tour.id}:${node.id}`, {
          type: 'orphan-tour-node',
          artifactId: node.artifactId,
          tourName: tour.name,
          message: `导览《${tour.name}》第 ${index + 1} 站引用的展品（${node.artifactId}）已从展品库移除，请修改该节点后再发布。`
        });
      }
    });
  });

  return [...issues.values()];
}

/** 冻结一次发布所需的全部内容，返回快照与缺件说明。 */
export async function buildPublication(input: PublicationBuildInput): Promise<PublicationBuildResult> {
  const { exhibition, artifacts, tours, version, strict } = input;
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const issues = collectPublishIssues(exhibition, artifactById, tours);

  if (strict && issues.length > 0) {
    return { issues };
  }

  const orderedIds = exhibition.artifactIds.filter((id) => artifactById.has(id));
  const snapshotArtifacts = await Promise.all(
    orderedIds.map((id) => createArtifactSnapshot(artifactById.get(id) as Artifact))
  );
  const liveArtifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const snapshotTours = tours.map(snapshotTour).map((tour) => ({
    ...tour,
    nodes: tour.nodes.filter((node) => liveArtifactIds.has(node.artifactId))
  }));

  const publication: Publication = {
    id: createId('publication'),
    exhibitionId: exhibition.id,
    version,
    title: exhibition.title,
    intro: exhibition.intro,
    curator: exhibition.curator,
    artifactIds: orderedIds,
    artifacts: snapshotArtifacts,
    tours: snapshotTours,
    themeColor: exhibition.themeColor,
    backgroundMusicUrl: exhibition.backgroundMusicUrl,
    publishedAt: new Date().toISOString()
  };

  return { publication, issues };
}

/** 删除发布版本时，连同快照私有的图片/模型 Blob 副本一起清理。 */
export async function deletePublicationFiles(publication: Publication): Promise<void> {
  const fileIds = publication.artifacts.flatMap((artifact) => [
    ...artifact.imageFileIds,
    artifact.modelFileId
  ]);
  await Promise.all(
    fileIds.filter((id): id is string => Boolean(id)).map((fileId) => deleteBlobFile(fileId))
  );
}
