import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { StreamMessage } from '../types';

export function useWebSocket(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const handlersRef = useRef({
    handleStreamMessage: useStore.getState().handleStreamMessage,
    setConnected: useStore.getState().setConnected,
    clearStreaming: useStore.getState().clearStreaming,
  });

  useEffect(() => {
    if (sessionIdRef.current === sessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!sessionId) {
      sessionIdRef.current = null;
      return;
    }

    sessionIdRef.current = sessionId;

    const wsUrl = import.meta.env.DEV
      ? `ws://${window.location.host}/ws/${sessionId}`
      : `ws://localhost:8000/ws/${sessionId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {};

    ws.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data);
        handlersRef.current.handleStreamMessage(msg);
      } catch {
      }
    };

    ws.onerror = () => {
      handlersRef.current.setConnected(false);
    };

    ws.onclose = () => {
      handlersRef.current.setConnected(false);
      handlersRef.current.clearStreaming();
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const sendMessage = useCallback((content: string, mentionedModels?: string[]) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'user_message',
        content,
        mentioned_models: mentionedModels,
      }));
    }
  }, []);

  const pause = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'pause' }));
    }
  }, []);

  const resume = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resume' }));
    }
  }, []);

  const stop = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  const updateConfig = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'update_config' }));
    }
  }, []);

  return {
    sendMessage,
    pause,
    resume,
    stop,
    updateConfig,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
