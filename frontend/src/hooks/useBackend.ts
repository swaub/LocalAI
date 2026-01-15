import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type BackendStatus = 'starting' | 'running' | 'stopped' | 'error';

interface UseBackendReturn {
  status: BackendStatus;
  error: string | null;
  isHealthy: boolean;
  startBackend: () => Promise<void>;
  stopBackend: () => Promise<void>;
  checkHealth: () => Promise<boolean>;
}

export function useBackend(): UseBackendReturn {
  const [status, setStatus] = useState<BackendStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [isHealthy, setIsHealthy] = useState(false);

  const startBackend = useCallback(async () => {
    try {
      setStatus('starting');
      setError(null);
      await invoke('start_backend');
      setStatus('running');
    } catch (e) {
      setError(e as string);
      setStatus('error');
    }
  }, []);

  const stopBackend = useCallback(async () => {
    try {
      await invoke('stop_backend');
      setStatus('stopped');
      setIsHealthy(false);
    } catch (e) {
      setError(e as string);
    }
  }, []);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const healthy = await invoke<boolean>('check_backend_health');
      setIsHealthy(healthy);
      if (healthy && status !== 'running') {
        setStatus('running');
      }
      return healthy;
    } catch {
      setIsHealthy(false);
      return false;
    }
  }, [status]);

  useEffect(() => {
    const unlistenStarted = listen('backend-started', () => {
      setStatus('running');
      setTimeout(() => checkHealth(), 1000);
    });

    const unlistenError = listen<string>('backend-error', (event) => {
      setError(event.payload);
      setStatus('error');
    });

    const unlistenTerminated = listen<number | null>('backend-terminated', () => {
      setStatus('stopped');
      setIsHealthy(false);
    });

    const unlistenLog = listen<string>('backend-log', () => {});

    return () => {
      unlistenStarted.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenTerminated.then(fn => fn());
      unlistenLog.then(fn => fn());
    };
  }, [checkHealth]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (status === 'running') {
        checkHealth();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [status, checkHealth]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      checkHealth();
    }, 2000);

    return () => clearTimeout(timeout);
  }, [checkHealth]);

  return {
    status,
    error,
    isHealthy,
    startBackend,
    stopBackend,
    checkHealth,
  };
}
