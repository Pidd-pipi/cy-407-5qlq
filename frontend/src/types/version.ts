import type { Artifact } from './artifact';
import type { TourNode } from './tour';

export interface ExhibitionVersionTour {
  name: string;
  nodes: TourNode[];
}

export interface ExhibitionVersion {
  id: string;
  exhibitionId: string;
  version: number;
  title: string;
  intro: string;
  curator: string;
  themeColor: string;
  backgroundMusicUrl?: string;
  /** 发布时冻结的展品资料，按展出顺序排列 */
  artifacts: Artifact[];
  /** 发布时冻结的导览，未配置导览时为 null */
  tour: ExhibitionVersionTour | null;
  artifactCount: number;
  publishedAt: string;
}

export interface PublishIssue {
  source: 'exhibition' | 'tour';
  artifactId: string;
  artifactName?: string;
  message: string;
}

export type PublishResult = { ok: true; version: ExhibitionVersion } | { ok: false; issues: PublishIssue[] };
