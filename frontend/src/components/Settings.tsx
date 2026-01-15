import { useState, useEffect, useCallback } from 'react';
import {
  Download,
  Trash2,
  RefreshCw,
  HardDrive,
  Search,
  AlertCircle,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Cloud,
  Eye,
  EyeOff,
  ToggleLeft,
  ToggleRight,
  Box,
  Info,
  ExternalLink,
  Shield,
  Keyboard,
} from 'lucide-react';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useStore } from '../store';

const API_BASE = import.meta.env.DEV ? '' : 'http://localhost:8000';

const openExternal = async (url: string) => {
  try {
    await shellOpen(url);
  } catch {
    window.open(url, '_blank');
  }
};

interface InstalledModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

interface ProviderInfo {
  name: string;
  configured: boolean;
  enabled: boolean;
  models: string[];
}

interface SettingsProps {
  onBack: () => void;
}

type TabId = 'models' | 'providers' | 'about';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'models', label: 'Local Models', icon: <HardDrive className="w-4 h-4" /> },
  { id: 'providers', label: 'Cloud Providers', icon: <Cloud className="w-4 h-4" /> },
  { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
];

const PROVIDER_ORDER = ['openai', 'anthropic', 'gemini', 'deepseek', 'groq', 'together', 'openrouter'];

export function Settings({ onBack }: SettingsProps) {
  const { refreshModels } = useStore();
  const [activeTab, setActiveTab] = useState<TabId>('models');
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pullModelName, setPullModelName] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<{ status: string; completed: number; total: number } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [modelsRes, providersRes, ollamaRes] = await Promise.all([
        fetch(`${API_BASE}/api/models`),
        fetch(`${API_BASE}/api/providers`),
        fetch(`${API_BASE}/api/ollama/status`),
      ]);

      if (ollamaRes.ok) {
        const ollamaData = await ollamaRes.json();
        setOllamaAvailable(ollamaData.available);
      } else {
        setOllamaAvailable(false);
      }

      if (modelsRes.ok) {
        const models = await modelsRes.json();
        const ollamaModels = Array.isArray(models)
          ? models.filter((m: { provider?: string }) => m.provider === 'ollama' || !m.provider)
          : [];
        setInstalledModels(ollamaModels);
      }

      if (providersRes.ok) {
        const providerData = await providersRes.json();
        setProviders(Array.isArray(providerData) ? providerData : []);
      }
    } catch {
      setOllamaAvailable(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (ollamaAvailable !== false) return;

    const checkOllama = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/ollama/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.available) {
            setOllamaAvailable(true);
            fetchData();
          }
        }
      } catch {
      }
    };

    const interval = setInterval(checkOllama, 3000);
    return () => clearInterval(interval);
  }, [ollamaAvailable, fetchData]);

  const handlePullModel = () => {
    if (!pullModelName.trim()) return;
    setIsPulling(true);
    setStatusMessage(null);
    setPullProgress(null);

    const modelName = pullModelName.trim();
    const backendUrl = 'http://localhost:8000';
    const eventSource = new EventSource(`${backendUrl}/api/models/pull/stream?name=${encodeURIComponent(modelName)}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.done) {
          eventSource.close();
          setIsPulling(false);
          setPullProgress(null);

          if (data.status === 'success') {
            setStatusMessage({ type: 'success', message: `Successfully pulled ${modelName}` });
            setPullModelName('');
            refreshModels();
            fetchData();
          } else if (data.error) {
            setStatusMessage({ type: 'error', message: data.error });
          }
        } else {
          setPullProgress({
            status: data.status || 'downloading',
            completed: data.completed || 0,
            total: data.total || 0,
          });
        }
      } catch {
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setIsPulling(false);
      setPullProgress(null);
      setStatusMessage((prev) => prev?.type === 'success' ? prev : { type: 'error', message: 'Connection lost during download' });
    };

    eventSource.onopen = () => {};
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Delete "${modelName}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/models/${encodeURIComponent(modelName)}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ type: 'success', message: `Deleted ${modelName}` });
        fetchData();
        refreshModels();
      } else {
        setStatusMessage({ type: 'error', message: data.error || 'Failed to delete' });
      }
    } catch {
      setStatusMessage({ type: 'error', message: 'Failed to connect to server' });
    }
  };

  const handleSaveApiKey = async (providerName: string) => {
    const apiKey = apiKeyInputs[providerName];
    if (!apiKey?.trim()) return;
    setSavingProvider(providerName);

    try {
      const res = await fetch(`${API_BASE}/api/providers/${providerName}/key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });

      if (res.ok) {
        setStatusMessage({ type: 'success', message: `API key saved for ${providerName}` });
        setApiKeyInputs((prev) => ({ ...prev, [providerName]: '' }));
        fetchData();
        refreshModels();
      } else {
        const data = await res.json();
        setStatusMessage({ type: 'error', message: data.error || 'Failed to save' });
      }
    } catch {
      setStatusMessage({ type: 'error', message: 'Failed to connect to server' });
    } finally {
      setSavingProvider(null);
    }
  };

  const handleToggleProvider = async (providerName: string, enabled: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/api/providers/${providerName}/toggle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        fetchData();
        refreshModels();
      }
    } catch {
    }
  };

  const handleDeleteApiKey = async (providerName: string) => {
    if (!confirm(`Remove API key for ${providerName}?`)) return;

    try {
      const res = await fetch(`${API_BASE}/api/providers/${providerName}/key`, { method: 'DELETE' });
      if (res.ok) {
        setStatusMessage({ type: 'success', message: `API key removed for ${providerName}` });
        fetchData();
        refreshModels();
      }
    } catch {
      setStatusMessage({ type: 'error', message: 'Failed to delete API key' });
    }
  };

  const getProviderDisplayName = (name: string) => {
    const displayNames: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic (Claude)',
      gemini: 'Google Gemini',
      deepseek: 'DeepSeek',
      groq: 'Groq',
      together: 'Together AI',
      openrouter: 'OpenRouter',
    };
    return displayNames[name] || name;
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e3).toFixed(1)} KB`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const normalized = dateStr.replace(/\.(\d{3})\d+/, '.$1');
      const date = new Date(normalized);
      if (isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#050505] overflow-hidden">
      {/* Header */}
      <div className="flex-none border-b border-[var(--border-subtle)] bg-[#050505]/80 backdrop-blur-md">
        <div className="flex items-center gap-4 px-6 h-16">
          <button
            onClick={onBack}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors group"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-zinc-200" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-medium text-zinc-100">Settings</h1>
          </div>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 text-zinc-400 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`settings-tab flex items-center gap-2 pb-3 ${
                activeTab === tab.id ? 'active' : ''
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className="px-6 pt-4">
          <div
            className={`flex items-center gap-3 p-3 rounded-lg text-sm animate-slide-up ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="font-medium">{statusMessage.message}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-6">
          
          {/* Models Tab */}
          {activeTab === 'models' && (
            <div className="animate-fade-in space-y-6">
              {/* Ollama Alert */}
              {ollamaAvailable === false && (
                <div className="card p-6 border-amber-500/20 bg-amber-500/5">
                  <div className="flex gap-4">
                    <div className="p-2 rounded-lg bg-amber-500/10 h-fit">
                      <AlertCircle className="w-6 h-6 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="font-medium text-amber-500 mb-1">Ollama Not Detected</h3>
                      <p className="text-sm text-zinc-400 mb-4 leading-relaxed">
                        To run local AI models, you need to install Ollama. It acts as the engine for models like Llama 3, Mistral, and Gemma.
                      </p>
                      <button
                        onClick={() => openExternal('https://ollama.com/download')}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600 transition-colors"
                      >
                        Download Ollama
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Pull Model */}
              {ollamaAvailable && (
                <section className="card p-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-base font-medium text-zinc-200 flex items-center gap-2">
                        <Download className="w-4 h-4 text-indigo-400" />
                        Download Models
                      </h2>
                      <p className="text-sm text-zinc-500 mt-1">
                        Pull new models from the Ollama registry to run locally.
                      </p>
                    </div>
                    <button
                      onClick={() => openExternal('https://ollama.com/library')}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      Browse Library <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        value={pullModelName}
                        onChange={(e) => setPullModelName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handlePullModel()}
                        placeholder="e.g., llama3.2:3b"
                        className="input-field pl-10"
                      />
                    </div>
                    <button
                      onClick={handlePullModel}
                      disabled={!pullModelName.trim() || isPulling}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      Pull
                    </button>
                  </div>

                  {/* Quick Picks */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['llama3.2:3b', 'mistral:7b', 'gemma:2b', 'qwen:7b'].map((model) => (
                      <button
                        key={model}
                        onClick={() => setPullModelName(model)}
                        className="px-3 py-1.5 text-xs bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-md transition-colors border border-transparent hover:border-zinc-700"
                      >
                        {model}
                      </button>
                    ))}
                  </div>

                  {/* Progress Bar */}
                  {isPulling && (
                    <div className="mt-6 p-4 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                      <div className="flex justify-between text-xs mb-2">
                        <span className="font-medium text-indigo-400 capitalize">{pullProgress?.status || 'Starting...'}</span>
                        <span className="text-zinc-500">
                          {pullProgress && pullProgress.total > 0 && 
                            `${formatSize(pullProgress.completed)} / ${formatSize(pullProgress.total)}`
                          }
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 transition-all duration-300 ease-out"
                          style={{
                            width: pullProgress && pullProgress.total > 0
                              ? `${Math.round((pullProgress.completed / pullProgress.total) * 100)}%`
                              : '0%',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Installed List */}
              {ollamaAvailable && (
                <section className="card p-6">
                  <h2 className="text-base font-medium text-zinc-200 mb-4 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-400" />
                    Installed Models
                    <span className="ml-auto text-xs font-normal text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                      {installedModels.length} models
                    </span>
                  </h2>

                  {isLoading ? (
                    <div className="py-12 flex justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
                    </div>
                  ) : installedModels.length === 0 ? (
                    <div className="py-12 text-center border-2 border-dashed border-zinc-800 rounded-lg">
                      <Box className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                      <p className="text-zinc-500">No models found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-800/50">
                      {installedModels.map((model) => (
                        <div
                          key={model.name}
                          className="py-3 flex items-center justify-between group hover:bg-white/[0.02] -mx-2 px-2 rounded-lg transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center border border-zinc-800">
                              <Box className="w-4 h-4 text-zinc-500" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-zinc-200">{model.name}</p>
                              <div className="flex items-center gap-3 text-xs text-zinc-600 mt-0.5">
                                <span>{formatSize(model.size)}</span>
                                <span>•</span>
                                <span>Updated {formatDate(model.modified_at)}</span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteModel(model.name)}
                            className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 text-zinc-600 rounded-lg transition-all"
                            title="Uninstall Model"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* Providers Tab */}
          {activeTab === 'providers' && (
            <div className="animate-fade-in grid grid-cols-1 gap-4">
              <div className="mb-2">
                <h2 className="text-lg font-medium text-zinc-100 mb-1">Cloud Providers</h2>
                <p className="text-sm text-zinc-500">Configure API keys to access cloud-based models.</p>
              </div>

              {providers
                .filter((p) => p.name !== 'ollama')
                .sort((a, b) => {
                  const indexA = PROVIDER_ORDER.indexOf(a.name);
                  const indexB = PROVIDER_ORDER.indexOf(b.name);
                  if (indexA === -1) return 1;
                  if (indexB === -1) return -1;
                  return indexA - indexB;
                })
                .map((provider) => (
                  <div key={provider.name} className="card p-5 group transition-all hover:border-indigo-500/30">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          provider.configured 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                        }`}>
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-medium text-zinc-200">{getProviderDisplayName(provider.name)}</h3>
                          <p className="text-xs text-zinc-500">
                            {provider.configured ? 'Connected' : 'Not configured'}
                          </p>
                        </div>
                      </div>
                      
                      {provider.configured && (
                        <button
                          onClick={() => handleToggleProvider(provider.name, !provider.enabled)}
                          className={`transition-colors ${provider.enabled ? 'text-emerald-400' : 'text-zinc-600'}`}
                          title={provider.enabled ? 'Disable' : 'Enable'}
                        >
                          {provider.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                        </button>
                      )}
                    </div>

                    <div className="bg-zinc-900/50 p-1 rounded-lg border border-zinc-800/50 flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type={showApiKey[provider.name] ? 'text' : 'password'}
                          value={apiKeyInputs[provider.name] || ''}
                          onChange={(e) =>
                            setApiKeyInputs((prev) => ({ ...prev, [provider.name]: e.target.value }))
                          }
                          placeholder={provider.configured ? '••••••••••••••••' : 'Enter API Key'}
                          className="w-full bg-transparent border-none text-sm px-3 py-2 focus:ring-0 text-zinc-300 placeholder:text-zinc-600"
                        />
                        <button
                          onClick={() =>
                            setShowApiKey((prev) => ({ ...prev, [provider.name]: !prev[provider.name] }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 p-1"
                        >
                          {showApiKey[provider.name] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      
                      <button
                        onClick={() => handleSaveApiKey(provider.name)}
                        disabled={!apiKeyInputs[provider.name]?.trim() || savingProvider === provider.name}
                        className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                      >
                        {savingProvider === provider.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
                      </button>

                      {provider.configured && (
                        <button
                          onClick={() => handleDeleteApiKey(provider.name)}
                          className="px-2 py-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 rounded-md transition-colors"
                          title="Remove Key"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <div className="animate-fade-in space-y-6">
              <div className="card p-8 text-center bg-gradient-to-b from-zinc-900 to-zinc-900/50">
                <div className="w-16 h-16 mx-auto rounded-2xl overflow-hidden shadow-lg shadow-indigo-500/20 mb-4">
                  <img src="/logo-small.png" alt="LocalAI" className="w-full h-full object-contain" />
                </div>
                <h2 className="text-xl font-bold text-white mb-2">LocalAI</h2>
                <p className="text-zinc-400 max-w-sm mx-auto mb-6">
                  A powerful, private multi-agent interface for your local LLMs.
                </p>
                <span className="inline-block px-3 py-1 bg-zinc-800 rounded-full text-xs text-zinc-500 font-mono">
                  v0.0.6
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="card p-5">
                  <h3 className="font-medium text-zinc-200 mb-3 flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-indigo-400" />
                    Shortcuts
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-zinc-500">Send message</span>
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 font-mono">Enter</kbd>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-zinc-500">Mention model</span>
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 font-mono">@</kbd>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-zinc-500">New line</span>
                      <kbd className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 font-mono">Shift + Enter</kbd>
                    </div>
                  </div>
                </div>

                <div className="card p-5">
                  <h3 className="font-medium text-zinc-200 mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Privacy
                  </h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    Your chats and API keys are stored locally on your device in a SQLite database. 
                    Local model inference runs entirely offline via Ollama.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
