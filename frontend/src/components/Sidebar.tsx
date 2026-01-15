import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Settings, ArrowUp, ArrowDown, Zap, Search, LayoutGrid, MessageSquare, Upload, FolderOpen, Pencil } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { homeDir } from '@tauri-apps/api/path';
import { platform } from '@tauri-apps/plugin-os';
import { useStore } from '../store';
import { MODEL_COLORS, generateShortId } from '../types';
import type { Session, ProviderModel, ModelRole } from '../types';

const MODEL_ROLES: { value: ModelRole; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'planner', label: 'Planner' },
  { value: 'coder', label: 'Coder' },
  { value: 'reviewer', label: 'Reviewer' },
];

interface SidebarProps {
  onSelectSession: (session: Session) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onOpenSettings: () => void;
}

export function Sidebar({ onSelectSession, onNewSession, onDeleteSession, onRenameSession, onOpenSettings }: SidebarProps) {
  const [showSessions, setShowSessions] = useState(true);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>('ollama');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFilePath, setImportFilePath] = useState('');
  const [importModelName, setImportModelName] = useState('');
  const [importing, setImporting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; model: ProviderModel } | null>(null);

  const {
    currentSession,
    sessions,
    modelConfigs,
    addModelConfig,
    updateModelConfig,
    removeModelConfig,
    moveModelConfig,
    autonomyRounds,
    setAutonomyRounds,
    availableModels,
    modelsError,
    refreshModels,
  } = useStore();

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const handleAddModel = (model: ProviderModel) => {
    const colorIndex = modelConfigs.length % MODEL_COLORS.length;
    const shortId = generateShortId(modelConfigs);
    const displayName = model.name.split('/').pop() || model.name;

    addModelConfig({
      model_id: model.id,
      name: `${displayName} ${modelConfigs.length + 1}`,
      short_id: shortId,
      system_prompt: '',
      color: MODEL_COLORS[colorIndex],
      role: 'general',
    });
  };

  const handleImportClick = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'GGUF Models', extensions: ['gguf'] }],
      });

      if (selected && typeof selected === 'string') {
        const fileName = selected.split('/').pop()?.replace('.gguf', '') || 'imported-model';
        setImportFilePath(selected);
        setImportModelName(fileName);
        setShowImportModal(true);
      }
    } catch {
      const path = prompt('Enter the full path to your .gguf file:\n\nExample: /Users/you/.cache/lm-studio/models/model.gguf');
      if (path && path.endsWith('.gguf')) {
        const fileName = path.split('/').pop()?.replace('.gguf', '') || 'imported-model';
        setImportFilePath(path);
        setImportModelName(fileName);
        setShowImportModal(true);
      } else if (path) {
        alert('Please provide a valid .gguf file path');
      }
    }
  };

  const handleImportSubmit = async () => {
    if (!importFilePath || !importModelName.trim()) return;

    setImporting(true);
    const apiBase = import.meta.env.DEV ? '' : 'http://localhost:8000';

    try {
      const res = await fetch(`${apiBase}/api/models/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: importModelName.trim(), file_path: importFilePath }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      await refreshModels();
      setShowImportModal(false);
      setImportFilePath('');
      setImportModelName('');
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setImporting(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, model: ProviderModel) => {
    if (model.provider !== 'ollama') return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, model });
  };

  const handleShowInFinder = async () => {
    if (!contextMenu) return;

    try {
      const home = await homeDir();
      const os = platform();
      let modelsPath: string;

      if (os === 'windows') {
        modelsPath = `${home}\\.ollama\\models`;
      } else {
        modelsPath = `${home}/.ollama/models`;
      }

      await shellOpen(modelsPath);
    } catch (err) {
      console.error('Failed to open models folder:', err);
    }

    setContextMenu(null);
  };

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const modelsByProvider = availableModels.reduce((acc, model) => {
    if (searchQuery && !model.name.toLowerCase().includes(searchQuery.toLowerCase())) return acc;
    
    const provider = model.provider || 'ollama';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {} as Record<string, ProviderModel[]>);

  const providerNames: Record<string, string> = {
    ollama: 'Local',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    deepseek: 'DeepSeek',
    groq: 'Groq',
    together: 'Together',
    openrouter: 'OpenRouter',
  };

  return (
    <div className="w-64 flex-none bg-[#050505] border-r border-[var(--border-subtle)] flex flex-col h-full text-sm select-none">
      <div className="h-12 px-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[#050505]/50 backdrop-blur-sm">
        <span className="font-semibold text-zinc-200 tracking-tight flex items-center gap-2">
          <img src="/logo-small.png" alt="LocalAI" className="w-5 h-5" />
          LocalAI
        </span>
        <button
          onClick={onOpenSettings}
          className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded-md transition-all"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-none py-3 border-b border-[var(--border-subtle)]">
        <div className="px-4 mb-2 flex items-center justify-between">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="text-xs font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 flex items-center gap-1 transition-colors"
          >
            History
            {showSessions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          <button
            onClick={onNewSession}
            className="p-1 hover:bg-indigo-500/10 hover:text-indigo-400 text-zinc-500 rounded transition-colors"
            title="New Chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {showSessions && (
          <div className="max-h-[20vh] overflow-y-auto px-2 space-y-0.5 custom-scrollbar">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`sidebar-item group ${currentSession?.id === session.id ? 'active' : ''}`}
                onClick={() => editingSessionId !== session.id && onSelectSession(session)}
              >
                {editingSessionId === session.id ? (
                  <form
                    className="flex items-center gap-1 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editingName.trim()) {
                        onRenameSession(session.id, editingName.trim());
                      }
                      setEditingSessionId(null);
                    }}
                  >
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                      autoFocus
                      onBlur={() => {
                        if (editingName.trim()) {
                          onRenameSession(session.id, editingName.trim());
                        }
                        setEditingSessionId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setEditingSessionId(null);
                        }
                      }}
                    />
                  </form>
                ) : (
                  <>
                    <div className="flex items-center gap-2 overflow-hidden">
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
                      <span className="truncate">{session.name}</span>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSessionId(session.id);
                          setEditingName(session.name);
                        }}
                        className="p-1 hover:text-indigo-400"
                        title="Rename"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                        className="p-1 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="px-4 py-2 text-xs text-zinc-600 italic">No previous sessions</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        <div className="px-4 py-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Library</span>
            <button
              onClick={handleImportClick}
              className="p-1 hover:bg-indigo-500/10 hover:text-indigo-400 text-zinc-500 rounded transition-colors"
              title="Import GGUF Model"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Filter models..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[var(--border-subtle)] rounded-md py-1.5 pl-8 pr-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar">
          {modelsError && (
            <div className="px-3 py-2 text-xs text-red-400 bg-red-500/5 rounded-md mx-2 mb-2 border border-red-500/10">
              {modelsError}
            </div>
          )}

          {Object.entries(modelsByProvider).map(([provider, models]) => (
            <div key={provider} className="mb-1">
              <button
                onClick={() => setExpandedProvider(expandedProvider === provider ? null : provider)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors rounded-md hover:bg-white/5"
              >
                <span className="font-medium">{providerNames[provider] || provider}</span>
                <div className="flex items-center gap-1">
                  <span className="opacity-50">{models.length}</span>
                  {expandedProvider === provider ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </div>
              </button>

              {expandedProvider === provider && (
                <div className="mt-0.5 ml-2 pl-2 border-l border-[var(--border-subtle)] space-y-0.5">
                  {models.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleAddModel(model)}
                      onContextMenu={(e) => handleContextMenu(e, model)}
                      disabled={modelConfigs.length >= 4}
                      className="w-full text-left px-2 py-1.5 text-xs rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-all truncate"
                      title={model.provider === 'ollama' ? `${model.name} (right-click for options)` : model.name}
                      data-allow-context-menu={model.provider === 'ollama' ? 'true' : undefined}
                    >
                      {model.name.split('/').pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-none bg-[#0a0a0a] border-t border-[var(--border-subtle)]">
        <div className="px-4 py-2 flex items-center justify-between bg-[#111] border-b border-[var(--border-subtle)]">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <LayoutGrid className="w-3 h-3" />
            Active Team ({modelConfigs.length})
          </span>
          
          {modelConfigs.length >= 2 && (
            <div className="flex items-center gap-2">
              <div 
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors cursor-pointer border ${autonomyRounds > 0 ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' : 'bg-zinc-800/50 border-transparent text-zinc-500'}`}
                onClick={() => setAutonomyRounds(autonomyRounds > 0 ? 0 : 3)}
              >
                <Zap className="w-2.5 h-2.5" />
                <span>Auto</span>
              </div>
              {autonomyRounds > 0 && (
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={autonomyRounds}
                  onChange={(e) => setAutonomyRounds(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                  className="w-8 px-1 py-0.5 bg-zinc-800 rounded text-[10px] text-center focus:outline-none border border-transparent focus:border-indigo-500/50"
                />
              )}
            </div>
          )}
        </div>

        <div className="max-h-60 overflow-y-auto p-2 space-y-2">
          {modelConfigs.map((config, index) => (
            <div 
              key={config.short_id} 
              className={`rounded-lg border transition-all duration-200 ${
                expandedModel === config.short_id 
                  ? 'bg-[#151515] border-[var(--border-highlight)] shadow-lg' 
                  : 'bg-[#111] border-[var(--border-subtle)] hover:border-[var(--border-highlight)]'
              }`}
            >
              <div
                className="flex items-center gap-2 p-2 cursor-pointer"
                onClick={() => setExpandedModel(expandedModel === config.short_id ? null : config.short_id)}
              >
                <div 
                  className="w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)]" 
                  style={{ backgroundColor: config.color, boxShadow: `0 0 8px ${config.color}40` }} 
                />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-200 truncate">{config.name}</span>
                    <span className="text-[10px] text-zinc-600 font-mono">#{config.short_id}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 capitalize">{config.role}</div>
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); removeModelConfig(config.short_id); }}
                  className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                  title="Remove from team"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {expandedModel === config.short_id && (
                <div className="p-2 pt-0 pb-3 space-y-2.5 animate-slide-up">
                  <div className="flex gap-1 justify-end px-1 border-t border-white/5 pt-2 mb-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveModelConfig(config.short_id, 'up'); }}
                      disabled={index === 0}
                      className="p-1 hover:bg-white/5 rounded text-zinc-500 hover:text-zinc-300 disabled:opacity-20"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveModelConfig(config.short_id, 'down'); }}
                      disabled={index === modelConfigs.length - 1}
                      className="p-1 hover:bg-white/5 rounded text-zinc-500 hover:text-zinc-300 disabled:opacity-20"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="space-y-2 px-1">
                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Role</label>
                      <div className="grid grid-cols-2 gap-1">
                        {MODEL_ROLES.map((role) => (
                          <button
                            key={role.value}
                            onClick={() => updateModelConfig(config.short_id, { role: role.value })}
                            className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                              config.role === role.value
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                                : 'bg-[#1a1a1a] border-transparent text-zinc-500 hover:bg-[#222]'
                            }`}
                          >
                            {role.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1 block">Prompt</label>
                      <textarea
                        value={config.system_prompt}
                        onChange={(e) => updateModelConfig(config.short_id, { system_prompt: e.target.value })}
                        placeholder="System instructions..."
                        rows={3}
                        className="w-full bg-[#050505] border border-[var(--border-subtle)] rounded p-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 resize-none placeholder:text-zinc-700"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {modelConfigs.length === 0 && (
            <div className="py-8 text-center px-4">
              <div className="w-8 h-8 rounded-full bg-zinc-900 mx-auto flex items-center justify-center mb-2 border border-dashed border-zinc-700">
                <Plus className="w-4 h-4 text-zinc-600" />
              </div>
              <p className="text-xs text-zinc-500">Select models from the library to build your team</p>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed bg-[#1a1a1a] border border-[var(--border-subtle)] rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleShowInFinder}
            className="w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/10 flex items-center gap-2 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Show in Finder
          </button>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
          <div className="bg-[#111] border border-[var(--border-subtle)] rounded-lg p-4 w-80 shadow-xl">
            <h3 className="text-sm font-medium text-zinc-200 mb-3">Import GGUF Model</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">File</label>
                <div className="text-xs text-zinc-400 bg-[#0a0a0a] border border-[var(--border-subtle)] rounded px-2 py-1.5 truncate">
                  {importFilePath.split('/').pop()}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Model Name</label>
                <input
                  type="text"
                  value={importModelName}
                  onChange={(e) => setImportModelName(e.target.value)}
                  className="w-full bg-[#0a0a0a] border border-[var(--border-subtle)] rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50"
                  placeholder="my-model"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    setShowImportModal(false);
                    setImportFilePath('');
                    setImportModelName('');
                  }}
                  className="flex-1 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportSubmit}
                  disabled={importing || !importModelName.trim()}
                  className="flex-1 px-3 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
