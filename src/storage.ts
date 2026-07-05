import type { DbSkill, ModelConfig, SqlHistoryItem, SqlTemplate } from "./types";

const DEFAULT_CONFIG: ModelConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: "",
  model: "deepseek-chat",
  dialect: "hive",
  temperature: 0.1
};

type StoreShape = {
  modelConfig: ModelConfig;
  skills: DbSkill[];
  activeSkillId: string | null;
  history: SqlHistoryItem[];
  templates: SqlTemplate[];
};

const DEFAULT_STORE: StoreShape = {
  modelConfig: DEFAULT_CONFIG,
  skills: [],
  activeSkillId: null,
  history: [],
  templates: []
};

export async function getStore(): Promise<StoreShape> {
  const data = await chrome.storage.local.get(DEFAULT_STORE);
  return {
    modelConfig: { ...DEFAULT_CONFIG, ...data.modelConfig },
    skills: data.skills ?? [],
    activeSkillId: data.activeSkillId ?? null,
    history: data.history ?? [],
    templates: data.templates ?? []
  };
}

export async function saveModelConfig(modelConfig: ModelConfig): Promise<void> {
  await chrome.storage.local.set({ modelConfig });
}

export async function saveSkills(skills: DbSkill[], activeSkillId: string | null): Promise<void> {
  await chrome.storage.local.set({ skills, activeSkillId });
}

export async function saveHistory(history: SqlHistoryItem[]): Promise<void> {
  await chrome.storage.local.set({ history: history.slice(0, 200) });
}

export async function saveTemplates(templates: SqlTemplate[]): Promise<void> {
  await chrome.storage.local.set({ templates });
}

export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
