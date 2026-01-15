import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Bot, StopCircle, RefreshCw, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useStore } from '../store';
import { MessageInput } from './MessageInput';
import type { Message, ModelConfig } from '../types';

interface ChatAreaProps {
  onSendMessage: (content: string, mentionedModels?: string[]) => void;
  onResume?: () => void;
}

function CodeBlock({ code, language, showCopy = true }: { code: string; language?: string; showCopy?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4 rounded-xl overflow-hidden border border-zinc-800 bg-[#0a0a0a]">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/50 border-b border-zinc-800">
        <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
          {language || 'code'}
        </span>
        {showCopy && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '16px',
          fontSize: '13px',
          fontFamily: '"JetBrains Mono", monospace',
          background: 'transparent',
          border: 'none',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function MarkdownContent({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  return (
    <ReactMarkdown
      components={{
        code: ({ className, children, node, ...props }) => {
          const match = /language-(\w+)/.exec(className || '');
          const code = String(children).replace(/\n$/, '');
          const isInline = !match && !code.includes('\n');

          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-200 text-[13px] font-mono" {...props}>
                {children}
              </code>
            );
          }

          return <CodeBlock code={code} language={match?.[1]} showCopy={!isStreaming} />;
        },
        pre: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="text-zinc-300">{children}</li>,
        h1: ({ children }) => <h1 className="text-xl font-bold text-white mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold text-white mt-4 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-semibold text-white mt-3 mb-1">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-zinc-700 pl-4 my-2 text-zinc-400 italic">{children}</blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 h-6">
      <div className="typing-dots">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  config,
  isStreaming = false,
  isThinking = false,
  streamingContent = '',
  tokens = 0,
  speed = 0,
}: {
  message?: Message;
  config?: ModelConfig;
  isStreaming?: boolean;
  isThinking?: boolean;
  streamingContent?: string;
  tokens?: number;
  speed?: number;
}) {
  const isUser = message?.role === 'user';
  const content = isStreaming ? streamingContent : message?.content || '';
  const displayName = config?.name || 'Assistant';
  const color = config?.color || '#6366f1';

  if (isUser) {
    return (
      <div className="flex justify-end mb-6 animate-slide-up px-4">
        <div className="flex gap-4 max-w-3xl w-full justify-end">
          <div className="flex flex-col items-end max-w-[85%]">
            <div className="message-bubble message-user shadow-sm">
              <p className="whitespace-pre-wrap text-[15px]">{content}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center mb-8 animate-fade-in px-4">
      <div className="flex gap-4 max-w-3xl w-full">
        <div className="flex-shrink-0 mt-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shadow-lg ring-1 ring-white/5"
            style={{ 
              background: `linear-gradient(135deg, ${color}20, ${color}10)`,
              boxShadow: `0 4px 12px ${color}15` 
            }}
          >
            <Bot className="w-5 h-5" style={{ color }} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-semibold text-sm text-zinc-200">
              {displayName}
            </span>
            {config?.short_id && (
              <span className="text-[11px] text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded">#{config.short_id}</span>
            )}
            
            {(tokens > 0 || isStreaming) && (
              <div className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
                {tokens > 0 && <span>{tokens.toLocaleString()} tok</span>}
                {isStreaming && speed > 0 && (
                  <span className="text-emerald-500/80">{speed.toFixed(0)} t/s</span>
                )}
              </div>
            )}
          </div>

          <div className="message-bubble message-assistant">
            {isThinking ? (
              <TypingIndicator />
            ) : (
              <div className="prose prose-invert max-w-none">
                <MarkdownContent content={content} isStreaming={isStreaming} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatArea({ onSendMessage, onResume }: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const lastScrollTop = useRef(0);
  const programmaticScroll = useRef(false);

  const {
    messages,
    modelConfigs,
    streamingContent,
    streamingTokens,
    streamingSpeed,
    thinkingModels,
    isRunning,
    isPaused,
    checkpointRound,
  } = useStore();

  const isAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!userScrolledUp.current && containerRef.current) {
      programmaticScroll.current = true;
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (programmaticScroll.current) {
      programmaticScroll.current = false;
      lastScrollTop.current = container.scrollTop;
      return;
    }

    if (container.scrollTop < lastScrollTop.current - 10) {
      userScrolledUp.current = true;
    }

    if (isAtBottom()) {
      userScrolledUp.current = false;
    }

    lastScrollTop.current = container.scrollTop;
  }, [isAtBottom]);

  useEffect(() => {
    userScrolledUp.current = false;
    scrollToBottom();
  }, [messages, thinkingModels, scrollToBottom]);

  useEffect(() => {
    if (streamingContent.size > 0) {
      scrollToBottom();
    }
  }, [streamingContent, scrollToBottom]);

  const getModelConfig = (id: string) => modelConfigs.find((c) => c.short_id === id);

  const activeModel = useMemo(() => {
    for (const config of modelConfigs) {
      if (thinkingModels.has(config.short_id)) {
        return { config, isThinking: true, isStreaming: false, content: '', tokens: 0, speed: 0 };
      }
      const streaming = streamingContent.get(config.short_id);
      if (streaming) {
        return {
          config,
          isThinking: false,
          isStreaming: true,
          content: streaming,
          tokens: streamingTokens.get(config.short_id) || 0,
          speed: streamingSpeed.get(config.short_id) || 0,
        };
      }
    }
    return null;
  }, [modelConfigs, thinkingModels, streamingContent, streamingTokens, streamingSpeed]);

  const groupedMessages = useMemo(() => {
    const groups: { user: Message; responses: Message[] }[] = [];
    let currentGroup: { user: Message; responses: Message[] } | null = null;

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = { user: msg, responses: [] };
      } else if (currentGroup) {
        currentGroup.responses.push(msg);
      }
    }
    if (currentGroup) groups.push(currentGroup);
    return groups;
  }, [messages]);

  if (messages.length === 0 && !isRunning) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[#050505]">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center animate-fade-in">
            <div className="w-20 h-20 mx-auto mb-8 rounded-2xl overflow-hidden shadow-2xl shadow-indigo-500/20">
              <img src="/logo-small.png" alt="LocalAI" className="w-full h-full object-contain" />
            </div>
            
            <h2 className="text-2xl font-semibold text-white mb-3 tracking-tight">
              {modelConfigs.length === 0 ? 'Initialize System' : 'Ready to Collaborate'}
            </h2>
            
            <p className="text-zinc-500 mb-8 leading-relaxed">
              {modelConfigs.length === 0
                ? 'Select AI models from the sidebar library to assemble your intelligent team.'
                : 'Your team is ready. Describe your task, and let the multi-agent system handle the rest.'}
            </p>

            {modelConfigs.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3 animate-slide-up">
                {modelConfigs.map((config) => (
                  <div
                    key={config.short_id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 shadow-sm"
                  >
                    <span
                      className="w-2 h-2 rounded-full shadow-[0_0_6px_currentColor]"
                      style={{ color: config.color, backgroundColor: config.color }}
                    />
                    <span className="text-xs font-medium text-zinc-300">{config.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="p-4 md:p-6 lg:px-8 max-w-5xl mx-auto w-full">
          <MessageInput onSendMessage={onSendMessage} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#050505] relative">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar scroll-smooth"
      >
        <div className="w-full py-8 pb-32">
          {groupedMessages.map((group, groupIndex) => (
            <div key={group.user.id} className="mb-12">
              <MessageBubble message={group.user} />

              {group.responses.map((response, idx) => {
                const config = getModelConfig(response.model_id || '');
                const showRoundDivider =
                  idx > 0 && response.round_number > group.responses[idx - 1].round_number;

                return (
                  <div key={response.id}>
                    {showRoundDivider && (
                      <div className="flex items-center gap-4 my-8 px-8 opacity-50">
                        <div className="h-px bg-zinc-800 flex-1" />
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">Round {response.round_number}</span>
                        <div className="h-px bg-zinc-800 flex-1" />
                      </div>
                    )}
                    <MessageBubble
                      message={response}
                      config={config}
                      tokens={response.tokens_used}
                    />
                  </div>
                );
              })}

              {groupIndex === groupedMessages.length - 1 && activeModel && (
                <div className="mt-4">
                  <MessageBubble
                    config={activeModel.config}
                    isThinking={activeModel.isThinking}
                    isStreaming={activeModel.isStreaming}
                    streamingContent={activeModel.content}
                    tokens={activeModel.tokens}
                    speed={activeModel.speed}
                  />
                </div>
              )}
            </div>
          ))}

          {isPaused && checkpointRound !== null && (
            <div className="my-8 animate-scale-in flex justify-center">
              <div className="glass-panel p-6 text-center max-w-sm mx-4 rounded-xl">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                  <StopCircle className="w-6 h-6 text-indigo-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">Autonomy Checkpoint</h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Paused after {checkpointRound} rounds. Review the progress before continuing.
                </p>
                <button
                  onClick={onResume}
                  className="btn-primary w-full justify-center flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Continue Collaboration
                </button>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="h-4" />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 lg:px-8 bg-gradient-to-t from-[#050505] via-[#050505] to-transparent pt-20">
        <div className="max-w-4xl mx-auto w-full">
           <MessageInput onSendMessage={onSendMessage} />
           <div className="text-center mt-2">
             <p className="text-[10px] text-zinc-600">
               AI can make mistakes. Verify important information.
             </p>
           </div>
        </div>
      </div>
    </div>
  );
}
