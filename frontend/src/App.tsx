import { useEffect, useState, useRef, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ControlBar } from './components/ControlBar';
import { Settings } from './components/Settings';
import { useWebSocket } from './hooks/useWebSocket';
import { useStore } from './store';
import type { Session, SessionWithMessages, Message } from './types';

type AppView = 'chat' | 'settings';

const API_BASE = import.meta.env.DEV ? '' : 'http://localhost:8000';

async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE}/api/sessions`);
  return res.json();
}

async function fetchSession(id: string): Promise<SessionWithMessages> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`);
  return res.json();
}

async function createSession(data: { name: string; model_configs: any[]; autonomy_rounds: number }): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function updateSession(id: string, data: any): Promise<Session> {
  const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return res.json();
}

async function deleteSession(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' });
}

export default function App() {
  const {
    currentSession,
    setCurrentSession,
    sessions,
    setSessions,
    modelConfigs,
    autonomyRounds,
    addMessage,
  } = useStore();

  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<AppView>('chat');

  const { sendMessage, pause, resume, stop, updateConfig } = useWebSocket(currentSession?.id || null);

  const isInitialMount = useRef(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-allow-context-menu]')) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  useEffect(() => {
    fetchSessions().then(async (data) => {
      setSessions(data);

      if (data.length > 0) {
        const mostRecent = data[0];
        const fullSession = await fetchSession(mostRecent.id);
        setCurrentSession(
          { ...mostRecent, model_configs: fullSession.model_configs },
          fullSession.messages
        );
      }

      setIsLoading(false);
      setTimeout(() => {
        isInitialMount.current = false;
      }, 1000);
    });
  }, [setSessions, setCurrentSession]);

  const autoSaveConfig = useCallback(async () => {
    if (isInitialMount.current || modelConfigs.length === 0) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (currentSession) {
        await updateSession(currentSession.id, {
          model_configs: modelConfigs,
          autonomy_rounds: autonomyRounds,
        });
        updateConfig();
      } else if (modelConfigs.length > 0) {
        const session = await createSession({
          name: 'New Session',
          model_configs: modelConfigs,
          autonomy_rounds: autonomyRounds,
        });
        setSessions([session, ...sessions]);
        setCurrentSession(session, []);
      }
    }, 1000);
  }, [currentSession, modelConfigs, autonomyRounds, sessions, setSessions, setCurrentSession, updateConfig]);

  useEffect(() => {
    autoSaveConfig();
  }, [modelConfigs, autonomyRounds, autoSaveConfig]);

  const handleSelectSession = async (session: Session) => {
    const fullSession = await fetchSession(session.id);
    setCurrentSession(
      { ...session, model_configs: fullSession.model_configs },
      fullSession.messages
    );
  };

  const handleNewSession = async () => {
    const session = await createSession({
      name: 'New Session',
      model_configs: modelConfigs,
      autonomy_rounds: autonomyRounds,
    });
    setSessions([session, ...sessions]);
    setCurrentSession(session, []);
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id);
    setSessions(sessions.filter((s) => s.id !== id));
    if (currentSession?.id === id) {
      setCurrentSession(null, []);
    }
  };

  const handleRenameSession = async (id: string, name: string) => {
    await updateSession(id, { name });
    setSessions(sessions.map((s) => s.id === id ? { ...s, name } : s));
    if (currentSession?.id === id) {
      setCurrentSession({ ...currentSession, name }, undefined);
    }
  };

  const handleSendMessage = async (content: string, mentionedModels?: string[]) => {
    let sessionId = currentSession?.id;

    if (!sessionId) {
      const session = await createSession({
        name: 'New Session',
        model_configs: modelConfigs,
        autonomy_rounds: autonomyRounds,
      });
      setSessions([session, ...sessions]);
      setCurrentSession(session, []);
      sessionId = session.id;
      await new Promise((r) => setTimeout(r, 300));
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      role: 'user',
      model_id: null,
      model_name: null,
      content,
      round_number: 0,
      tokens_used: 0,
      created_at: new Date().toISOString(),
    };
    addMessage(userMessage);
    sendMessage(content, mentionedModels);

    if (currentSession?.id) {
      updateSession(sessionId, {
        model_configs: modelConfigs,
        autonomy_rounds: autonomyRounds,
      }).then(() => updateConfig());
    }
  };


  if (isLoading) {
    return (
      <div className="flex h-screen bg-[#050505] text-white items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-white">
      <Sidebar
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onOpenSettings={() => setCurrentView('settings')}
      />

      {currentView === 'chat' ? (
        <div className="flex-1 flex flex-col min-w-0">
          <ControlBar onPause={pause} onResume={resume} onStop={stop} />
          <ChatArea onSendMessage={handleSendMessage} onResume={resume} />
        </div>
      ) : (
        <Settings onBack={() => setCurrentView('chat')} />
      )}
    </div>
  );
}
