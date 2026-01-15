import { Pause, Play, Square } from 'lucide-react';
import { useStore } from '../store';

interface ControlBarProps {
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function ControlBar({ onPause, onResume, onStop }: ControlBarProps) {
  const {
    isConnected,
    isRunning,
    isPaused,
    tokenUsage,
    modelConfigs,
  } = useStore();

  const totalTokens = Object.values(tokenUsage).reduce((a, b) => a + b, 0);

  return (
    <div className="h-10 bg-[#0d0d12] border-b border-zinc-800/50 flex items-center px-3 gap-3 text-xs">
      <div className="flex items-center gap-1.5">
        <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
        <span className="text-zinc-500">{isConnected ? 'Connected' : 'Offline'}</span>
      </div>

      <div className="w-px h-4 bg-zinc-800" />

      <div className="flex items-center gap-1">
        {isRunning && !isPaused ? (
          <button
            onClick={onPause}
            className="p-1.5 rounded hover:bg-zinc-800 transition-colors"
            title="Pause"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        ) : isPaused ? (
          <button
            onClick={onResume}
            className="p-1.5 rounded hover:bg-zinc-800 transition-colors text-green-500"
            title="Resume"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button disabled className="p-1.5 rounded opacity-30">
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={onStop}
          disabled={!isRunning}
          className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30 transition-colors"
          title="Stop"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3 text-zinc-500">
        {modelConfigs.map((config) => (
          <div key={config.short_id} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
            <span>{(tokenUsage[config.name] || 0).toLocaleString()}</span>
          </div>
        ))}
        {totalTokens > 0 && (
          <>
            <span className="text-zinc-700">|</span>
            <span className="text-zinc-400">{totalTokens.toLocaleString()} total</span>
          </>
        )}
      </div>
    </div>
  );
}
