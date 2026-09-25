import type { Artifact } from './artifact';
import type { TourNode } from './tour';

export interface Exhibition {
  id: string;
  title: string;
  intro: string;
  curator: string;
  artifactIds: string[];
  themeColor: string;
  backgroundMusicUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExhibitionDraft = Omit<Exhibition, 'id' | 'createdAt' | 'updatedAt'>;

/** 发布时冻结的展品资料副本，字段结构与展品库中的 Artifact 一致。 */
export type ArtifactSnapshot = Artifact;

/** 发布时冻结的导览副本（含节点顺序与相机、讲解配置）。 */
export interface TourSnapshot {
  id: string;
  name: string;
  nodes: TourNode[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 一次发布生成的不可变快照：展览文案、展品顺序与资料、主题色和导览节点
 * 全部冻结在该版本中，展厅与自动导览只读取最新发布版本。
 */
export interface Publication {
  id: string;
  exhibitionId: string;
  version: number;
  title: string;
  intro: string;
  curator: string;
  artifactIds: string[];
  artifacts: ArtifactSnapshot[];
  tours: TourSnapshot[];
  themeColor: string;
  backgroundMusicUrl?: string;
  publishedAt: string;
}

export type PublishIssueType = 'empty' | 'missing-artifact' | 'orphan-tour-node';

export interface PublishIssue {
  type: PublishIssueType;
  /** 缺失展品在展品库中的 id（已被删除时用于排查）。 */
  artifactId?: string;
  /** 出问题的导览名称。 */
  tourName?: string;
  message: string;
}

export interface PublishResult {
  ok: boolean;
  publication?: Publication;
  issues: PublishIssue[];
}
