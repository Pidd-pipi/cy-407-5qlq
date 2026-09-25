export enum CraftCategory {
  Pottery = 'pottery',
  Embroidery = 'embroidery',
  PaperCutting = 'paper_cutting',
  WoodCarving = 'wood_carving',
  TieDye = 'tie_dye',
  Lacquer = 'lacquer',
  Weaving = 'weaving',
  Metalwork = 'metalwork'
}

export const craftCategoryLabels: Record<CraftCategory, string> = {
  [CraftCategory.Pottery]: '陶艺',
  [CraftCategory.Embroidery]: '刺绣',
  [CraftCategory.PaperCutting]: '剪纸',
  [CraftCategory.WoodCarving]: '木雕',
  [CraftCategory.TieDye]: '扎染',
  [CraftCategory.Lacquer]: '漆器',
  [CraftCategory.Weaving]: '编织',
  [CraftCategory.Metalwork]: '金属工艺'
};
