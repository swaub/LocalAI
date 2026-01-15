import { create } from 'zustand';
import type { Session, Message, ModelConfig, StreamMessage, ProviderModel } from '../types';
import { generateShortId } from '../types';

const API_BASE = import.meta.env.DEV ? '' : 'http://localhost:8000';

export type BackendStatus = 'starting' | 'running' | 'stopped' | 'error';

function fixDuplicateShortIds(configs: ModelConfig[]): ModelConfig[] {
  const seenIds = new Set<string>();
  const fixedConfigs: ModelConfig[] = [];

  for (const config of configs) {
    if (seenIds.has(config.short_id)) {
      const newId = generateShortId(fixedConfigs);
      fixedConfigs.push({ ...config, short_id: newId });
      seenIds.add(newId);
    } else {
      seenIds.add(config.short_id);
      fixedConfigs.push(config);
    }
  }

  return fixedConfigs;
}

interface AppState {
  currentSession: Session | null;
  sessions: Session[];
  modelConfigs: ModelConfig[];
  autonomyRounds: number;
  messages: Message[];
  streamingContent: Map<string, string>;
  streamingTokens: Map<string, number>;
  streamingSpeed: Map<string, number>;
  thinkingModels: Set<string>;
  modelErrors: Map<string, string>;
  isConnected: boolean;
  isRunning: boolean;
  isPaused: boolean;
  currentRound: number;
  checkpointRound: number | null;
  tokenUsage: Record<string, number>;
  backendStatus: BackendStatus;
  backendError: string | null;
  availableModels: ProviderModel[];
  modelsLoading: boolean;
  modelsError: string | null;
  setCurrentSession: (session: Session | null, messages?: Message[]) => void;
  setSessions: (sessions: Session[]) => void;
  setModelConfigs: (configs: ModelConfig[]) => void;
  addModelConfig: (config: ModelConfig) => void;
  updateModelConfig: (shortId: string, updates: Partial<ModelConfig>) => void;
  removeModelConfig: (shortId: string) => void;
  moveModelConfig: (shortId: string, direction: 'up' | 'down') => void;
  setAutonomyRounds: (rounds: number) => void;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
  handleStreamMessage: (msg: StreamMessage) => void;
  clearStreaming: () => void;
  setConnected: (connected: boolean) => void;
  setRunning: (running: boolean) => void;
  setPaused: (paused: boolean) => void;
  setBackendStatus: (status: BackendStatus) => void;
  setBackendError: (error: string | null) => void;
  refreshModels: () => Promise<void>;
}

const loadSavedModelConfigs = (): ModelConfig[] => {
  try {
    const saved = localStorage.getItem('localai-model-configs');
    if (saved) {
      const configs = JSON.parse(saved) as ModelConfig[];
      const fixedConfigs = fixDuplicateShortIds(configs);
      if (JSON.stringify(configs) !== JSON.stringify(fixedConfigs)) {
        localStorage.setItem('localai-model-configs', JSON.stringify(fixedConfigs));
      }
      return fixedConfigs;
    }
  } catch (e) {
    console.error('Failed to load saved model configs:', e);
  }
  return [];
};

const loadSavedAutonomyRounds = (): number => {
  try {
    const saved = localStorage.getItem('localai-autonomy-rounds');
    if (saved) {
      return parseInt(saved, 10);
    }
  } catch (e) {
    console.error('Failed to load saved autonomy rounds:', e);
  }
  return 0;
};

const chunkBuffer: Map<string, { content: string; tokens?: number; speed?: number }> = new Map();
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

const flushChunks = (set: (partial: Partial<AppState>) => void, get: () => AppState) => {
  if (chunkBuffer.size === 0) return;

  const state = get();
  const newStreaming = new Map(state.streamingContent);
  const newTokens = new Map(state.streamingTokens);
  const newSpeed = new Map(state.streamingSpeed);
  const newThinking = new Set(state.thinkingModels);

  for (const [modelId, data] of chunkBuffer) {
    const current = newStreaming.get(modelId) || '';
    newStreaming.set(modelId, current + data.content);
    newThinking.delete(modelId);
    if (data.tokens !== undefined) newTokens.set(modelId, data.tokens);
    if (data.speed !== undefined) newSpeed.set(modelId, data.speed);
  }

  chunkBuffer.clear();

  set({
    streamingContent: newStreaming,
    streamingTokens: newTokens,
    streamingSpeed: newSpeed,
    thinkingModels: newThinking,
  });
};

export const useStore = create<AppState>((set, get) => ({
  currentSession: null,
  sessions: [],
  modelConfigs: loadSavedModelConfigs(),
  autonomyRounds: loadSavedAutonomyRounds(),
  messages: [],
  streamingContent: new Map(),
  streamingTokens: new Map(),
  streamingSpeed: new Map(),
  thinkingModels: new Set(),
  modelErrors: new Map(),
  backendStatus: 'starting' as BackendStatus,
  backendError: null,
  availableModels: [],
  modelsLoading: false,
  modelsError: null,
  isConnected: false,
  isRunning: false,
  isPaused: false,
  currentRound: 0,
  checkpointRound: null,
  tokenUsage: {},

  setCurrentSession: (session, messages?: Message[]) => {
    set({
      currentSession: session,
      messages: messages || [],
      streamingContent: new Map(),
      thinkingModels: new Set(),
      modelErrors: new Map(),
    });
  },

  setSessions: (sessions) => set({ sessions }),

  setModelConfigs: (configs) => {
    localStorage.setItem('localai-model-configs', JSON.stringify(configs));
    set({ modelConfigs: configs });
  },

  addModelConfig: (config) => set((state) => {
    const newConfigs = [...state.modelConfigs, config];
    localStorage.setItem('localai-model-configs', JSON.stringify(newConfigs));
    return { modelConfigs: newConfigs };
  }),

  updateModelConfig: (shortId, updates) => set((state) => {
    const newConfigs = state.modelConfigs.map((c) =>
      c.short_id === shortId ? { ...c, ...updates } : c
    );
    localStorage.setItem('localai-model-configs', JSON.stringify(newConfigs));
    return { modelConfigs: newConfigs };
  }),

  removeModelConfig: (shortId) => set((state) => {
    const newConfigs = state.modelConfigs.filter((c) => c.short_id !== shortId);
    localStorage.setItem('localai-model-configs', JSON.stringify(newConfigs));
    return { modelConfigs: newConfigs };
  }),

  moveModelConfig: (shortId, direction) => set((state) => {
    const configs = [...state.modelConfigs];
    const index = configs.findIndex((c) => c.short_id === shortId);
    if (index === -1) return state;

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= configs.length) return state;

    [configs[index], configs[newIndex]] = [configs[newIndex], configs[index]];
    localStorage.setItem('localai-model-configs', JSON.stringify(configs));
    return { modelConfigs: configs };
  }),

  setAutonomyRounds: (rounds) => {
    localStorage.setItem('localai-autonomy-rounds', rounds.toString());
    set({ autonomyRounds: rounds });
  },

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  setMessages: (messages) => set({ messages }),

  clearMessages: () => set({ messages: [] }),

  handleStreamMessage: (msg) => {
    const state = get();

    switch (msg.type) {
      case 'ready':
        set({ isConnected: true });
        break;

      case 'thinking':
        if (msg.model_id) {
          const newThinking = new Set(state.thinkingModels);
          newThinking.add(msg.model_id);
          set({ thinkingModels: newThinking, isRunning: true });
        }
        break;

      case 'chunk':
        if (msg.model_id && msg.content) {
          const existing = chunkBuffer.get(msg.model_id);
          if (existing) {
            existing.content += msg.content;
            if (msg.tokens !== undefined) existing.tokens = msg.tokens;
            if (msg.tokens_per_second !== undefined) existing.speed = msg.tokens_per_second;
          } else {
            chunkBuffer.set(msg.model_id, {
              content: msg.content,
              tokens: msg.tokens,
              speed: msg.tokens_per_second,
            });
          }

          if (!flushTimeout) {
            flushTimeout = setTimeout(() => {
              flushTimeout = null;
              flushChunks(set, get);
            }, 32);
          }
        }
        break;

      case 'complete':
        if (flushTimeout) {
          clearTimeout(flushTimeout);
          flushTimeout = null;
        }
        chunkBuffer.clear();

        if (msg.model_id && msg.content) {
          const message: Message = {
            id: crypto.randomUUID(),
            session_id: state.currentSession?.id || '',
            role: msg.model_id,
            model_id: msg.model_id,
            model_name: msg.model_name || null,
            content: msg.content,
            round_number: state.currentRound,
            tokens_used: msg.tokens || 0,
            created_at: new Date().toISOString(),
          };

          const newStreaming = new Map(state.streamingContent);
          newStreaming.delete(msg.model_id);

          const newTokens = new Map(state.streamingTokens);
          newTokens.delete(msg.model_id);

          const newSpeed = new Map(state.streamingSpeed);
          newSpeed.delete(msg.model_id);

          set({
            messages: [...state.messages, message],
            streamingContent: newStreaming,
            streamingTokens: newTokens,
            streamingSpeed: newSpeed,
            thinkingModels: new Set([...state.thinkingModels].filter(id => id !== msg.model_id)),
          });
        }
        break;

      case 'round_start':
        set({ currentRound: msg.round || 0 });
        break;

      case 'round_end':
        set({
          streamingContent: new Map(),
          streamingTokens: new Map(),
          streamingSpeed: new Map(),
          thinkingModels: new Set(),
        });
        break;

      case 'token_usage':
        if (msg.usage) {
          set({ tokenUsage: msg.usage, isRunning: false });
        }
        break;

      case 'paused':
        set({ isPaused: true });
        break;

      case 'resumed':
        set({ isPaused: false, checkpointRound: null });
        break;

      case 'stopped':
        set({
          isRunning: false,
          isPaused: false,
          streamingContent: new Map(),
          thinkingModels: new Set(),
        });
        break;

      case 'project_complete':
        set({
          isRunning: false,
          isPaused: false,
          streamingContent: new Map(),
          thinkingModels: new Set(),
        });
        break;

      case 'checkpoint':
        set({ isPaused: true, checkpointRound: msg.round || 0 });
        break;

      case 'error':
        if (msg.model_id) {
          const newThinking = new Set(state.thinkingModels);
          newThinking.delete(msg.model_id);

          const newErrors = new Map(state.modelErrors);
          newErrors.set(msg.model_id, msg.error || 'Unknown error');

          const errorMessage: Message = {
            id: crypto.randomUUID(),
            session_id: state.currentSession?.id || '',
            role: msg.model_id,
            model_id: msg.model_id,
            model_name: msg.model_name || null,
            content: `⚠️ **Error:** ${msg.error}`,
            round_number: state.currentRound,
            tokens_used: 0,
            created_at: new Date().toISOString(),
          };

          set({
            thinkingModels: newThinking,
            modelErrors: newErrors,
            messages: [...state.messages, errorMessage],
            isRunning: false,
          });
        } else {
          set({ isRunning: false });
        }
        break;
    }
  },

  clearStreaming: () => set({
    streamingContent: new Map(),
    streamingTokens: new Map(),
    streamingSpeed: new Map(),
    thinkingModels: new Set(),
    modelErrors: new Map(),
    isRunning: false,
  }),

  setConnected: (connected) => set({ isConnected: connected }),
  setRunning: (running) => set({ isRunning: running }),
  setPaused: (paused) => set({ isPaused: paused }),
  setBackendStatus: (status) => set({ backendStatus: status }),
  setBackendError: (error) => set({ backendError: error }),

  refreshModels: async () => {
    set({ modelsLoading: true, modelsError: null });
    try {
      const res = await fetch(`${API_BASE}/api/models`);
      const data = await res.json();
      if (Array.isArray(data)) {
        set({ availableModels: data, modelsLoading: false });
      } else {
        set({ modelsError: 'Failed to load models', modelsLoading: false });
      }
    } catch {
      set({ modelsError: 'Backend offline', modelsLoading: false });
    }
  },
}));
