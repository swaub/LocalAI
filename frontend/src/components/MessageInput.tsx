import { useState, useRef, useCallback } from 'react';
import { Send, X, FileText, Folder } from 'lucide-react';
import { useStore } from '../store';

interface AttachedFile {
  name: string;
  path: string;
  content: string;
  type: 'file' | 'folder';
}

interface MessageInputProps {
  onSendMessage: (content: string, mentionedModels?: string[]) => void;
}

export function MessageInput({ onSendMessage }: MessageInputProps) {
  const [input, setInput] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { modelConfigs, isRunning } = useStore();

  const filteredModels = modelConfigs.filter((mc) =>
    mc.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  const parseMentions = (text: string): string[] => {
    const mentions: string[] = [];
    const regex = /@([\w.-]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const mentionName = match[1].toLowerCase();
      const model = modelConfigs.find((mc) => {
        const baseName = mc.model_id.split(':')[0].toLowerCase();
        return baseName === mentionName ||
               mc.short_id.toLowerCase() === mentionName ||
               mc.name.toLowerCase().startsWith(mentionName);
      });
      if (model && !mentions.includes(model.name)) {
        mentions.push(model.name);
      }
    }

    return mentions;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const pos = e.target.selectionStart || 0;
    setInput(value);
    setCursorPosition(pos);

    const textBeforeCursor = value.slice(0, pos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('[')) {
        setShowMentions(true);
        setMentionFilter(textAfterAt);
        setMentionIndex(0);
        return;
      }
    }

    setShowMentions(false);
  };

  const insertMention = useCallback((modelName: string) => {
    const model = modelConfigs.find(mc => mc.name === modelName);
    if (!model) return;

    const textBeforeCursor = input.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = input.slice(cursorPosition);

    const baseName = model.model_id.split(':')[0];
    const newText = input.slice(0, lastAtIndex) + `@${baseName} ` + textAfterCursor;

    setInput(newText);
    setShowMentions(false);
    setMentionFilter('');

    setTimeout(() => {
      inputRef.current?.focus();
      const newPos = lastAtIndex + baseName.length + 2;
      inputRef.current?.setSelectionRange(newPos, newPos);
    }, 0);
  }, [input, cursorPosition, modelConfigs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredModels.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % filteredModels.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + filteredModels.length) % filteredModels.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredModels[mentionIndex].name);
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || attachedFiles.length > 0) && !isRunning && modelConfigs.length > 0) {
      let fullMessage = input.trim();

      if (attachedFiles.length > 0) {
        const attachmentSection = attachedFiles
          .map(f => `\n\n📎 **${f.name}**\n\`\`\`\n${f.content}\n\`\`\``)
          .join('');
        fullMessage = fullMessage + attachmentSection;
      }

      const mentions = parseMentions(input);
      onSendMessage(fullMessage, mentions.length > 0 ? mentions : undefined);
      setInput('');
      setAttachedFiles([]);
      setShowMentions(false);
    }
  };

  return (
    <div className="p-3 border-t border-zinc-800/50 bg-[#0d0d12] relative">
      {showMentions && filteredModels.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-2 mention-picker rounded-md overflow-hidden animate-fade-in">
          <div className="px-2 py-1.5 border-b border-zinc-800 text-xs text-zinc-500">
            Select model
          </div>
          {filteredModels.map((model, index) => (
            <button
              key={model.short_id}
              onClick={() => insertMention(model.name)}
              className={`mention-picker-item w-full px-2 py-1.5 flex items-center gap-2 text-left text-sm ${
                index === mentionIndex ? 'active' : ''
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: model.color }} />
              <span className="text-zinc-300">{model.name}</span>
              <span className="text-xs text-zinc-600">#{model.short_id}</span>
            </button>
          ))}
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachedFiles.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded px-2 py-1 text-xs"
            >
              {file.type === 'folder' ? (
                <Folder className="w-3 h-3 text-indigo-400" />
              ) : (
                <FileText className="w-3 h-3 text-indigo-400" />
              )}
              <span className="text-indigo-300 max-w-[100px] truncate">{file.name}</span>
              <button onClick={() => removeAttachment(index)} className="hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            modelConfigs.length === 0
              ? 'Add models to chat...'
              : isRunning
              ? 'Models are responding...'
              : 'Message... (@ to mention)'
          }
          disabled={modelConfigs.length === 0}
          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-sm focus:outline-none focus:border-indigo-500 disabled:opacity-50 placeholder-zinc-600"
        />
        <button
          type="submit"
          disabled={(!input.trim() && attachedFiles.length === 0) || modelConfigs.length === 0 || isRunning}
          className="btn-primary px-3 py-2 rounded-md disabled:opacity-30"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
