import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Monitor } from 'lucide-react';

interface ServerStatus {
  online: boolean;
  FileAppCliente: boolean;
  DOAStatus: boolean;
}

interface ApiResponse {
  data: Record<string, ServerStatus>;
  cachedAt: number;
  error?: string;
}

interface Props {
  isDark: boolean;
}

const REFRESH_MS = 5 * 60 * 1000;

const IP_NAMES: Record<string, string> = {
  '10.104.12.2':  'QV1',
  '10.104.12.6':  'QV2',
  '10.104.12.10': 'QV3',
  '10.104.12.14': 'QV4',
  '10.104.12.18': 'QV5',
  '10.104.12.22': 'QV6',
  '10.104.12.26': 'QV7',
};

function timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 90) return 'ahora';
  const min = Math.floor(sec / 60);
  return `hace ${min} min`;
}

export default function ServerStatusBar({ isDark: _isDark }: Props) {
  const [data, setData] = useState<Record<string, ServerStatus> | null>(null);
  const [cachedAt, setCachedAt] = useState<number>(0);
  const [psError, setPsError] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force ? '/api/servers?refresh=1' : '/api/servers';
      const r = await fetch(url);
      const json = await r.json() as ApiResponse;
      setData(json.data);
      setCachedAt(json.cachedAt);
      setPsError(json.error ?? '');
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Re-render every 30s to update "hace X min"
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const entries = data ? Object.entries(data) : [];

  return (
    <div className="flex items-center gap-2 px-4 py-2 mb-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0 transition-colors overflow-x-auto">
      <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 shrink-0 pr-2 border-r border-slate-200 dark:border-slate-700">
        <Monitor className="w-3.5 h-3.5" />
        <span className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap">Servidores</span>
      </div>

      {loading && !data && (
        <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">Verificando...</span>
      )}

      {entries.map(([ip, status]) => {
        const allOk = status.online && status.FileAppCliente && status.DOAStatus;
        const partial = status.online && (status.FileAppCliente || status.DOAStatus);
        const dotColor = !status.online
          ? 'bg-red-500'
          : allOk
          ? 'bg-emerald-500'
          : partial
          ? 'bg-amber-400'
          : 'bg-red-400';
        const label = IP_NAMES[ip] ?? ip;

        return (
          <div
            key={ip}
            title={`${label} (${ip})\nOnline: ${status.online ? '✓' : '✗'}\nFileAppCliente: ${status.FileAppCliente ? '✓ corriendo' : '✗ detenido'}\nDOAStatus: ${status.DOAStatus ? '✓ corriendo' : '✗ detenido'}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shrink-0 cursor-default select-none"
          >
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
            <span className={`text-[9px] font-bold leading-none ${status.FileAppCliente ? 'text-emerald-500' : 'text-red-400'}`} title="FileAppCliente">F</span>
            <span className={`text-[9px] font-bold leading-none ${status.DOAStatus ? 'text-emerald-500' : 'text-red-400'}`} title="DOAStatus">D</span>
          </div>
        );
      })}

      {psError && (
        <span className="text-[10px] text-amber-500 dark:text-amber-400 italic shrink-0" title={psError}>⚠ error PS</span>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0 pl-2 border-l border-slate-200 dark:border-slate-700">
        {cachedAt > 0 && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
            {timeAgo(cachedAt)}
          </span>
        )}
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 transition-colors disabled:opacity-50"
          title="Actualizar estado de servidores"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
