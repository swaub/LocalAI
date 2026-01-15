export type ModelRole = 'planner' | 'coder' | 'reviewer' | 'general';

export interface ModelConfig {
  model_id: string;
  name: string;
  short_id: string;
  system_prompt: string;
  color: string;
  role?: ModelRole;
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: string;
  size?: number;
}

export interface Session {
  id: string;
  name: string;
  model_configs: ModelConfig[];
  autonomy_rounds: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: string;
  model_id: string | null;
  model_name: string | null;
  content: string;
  round_number: number;
  tokens_used: number;
  created_at: string;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
}

export interface StreamMessage {
  type: 'thinking' | 'chunk' | 'complete' | 'error' | 'round_start' | 'round_end' | 'ready' | 'paused' | 'resumed' | 'stopped' | 'token_usage' | 'project_complete' | 'checkpoint';
  model_id?: string;
  model_name?: string;
  content?: string;
  tokens?: number;
  tokens_per_second?: number;
  round?: number;
  error?: string;
  color?: string;
  usage?: Record<string, number>;
}

export const MODEL_COLORS = [
  '#6366f1', // indigo
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f43f5e', // rose
  '#06b6d4', // cyan
];

export function generateShortId(existingConfigs: ModelConfig[]): string {
  const existingIds = new Set(existingConfigs.map(c => c.short_id));

  for (let i = 0; i < 100; i++) {
    const letter = String.fromCharCode(97 + (i % 26)); // a-z
    const number = Math.floor(i / 26) + 1;
    const id = `${letter}${number}`;
    if (!existingIds.has(id)) {
      return id;
    }
  }

  return `x${Date.now().toString(36).slice(-4)}`;
}
