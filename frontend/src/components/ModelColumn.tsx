import { Loader2 } from 'lucide-react';
import type { ModelConfig } from '../types';

interface ModelColumnProps {
  config: ModelConfig;
  response?: {
    content: string;
    tokens: number;
    isStreaming: boolean;
    isThinking: boolean;
  };
}

export function ModelColumn({ config, response }: ModelColumnProps) {
  if (!response) {
    return null;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: config.color }}
        />
        <span className="text-sm font-medium" style={{ color: config.color }}>
          {config.name}
        </span>
        <span className="text-xs text-gray-500">#{config.short_id}</span>
        {response.tokens > 0 && (
          <span className="text-xs text-gray-500 ml-auto">{response.tokens} tokens</span>
        )}
      </div>

      <div
        className="p-3 rounded-lg bg-surface-light rounded-tl-sm flex-1"
        style={{ borderLeftColor: config.color, borderLeftWidth: 3 }}
      >
        {response.isThinking ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Thinking...</span>
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm">
            {response.content}
            {response.isStreaming && <span className="animate-pulse">|</span>}
          </div>
        )}
      </div>
    </div>
  );
}
