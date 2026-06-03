import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Monitor, GripVertical, WifiOff, ChevronDown, ChevronRight } from 'lucide-react';

interface DiskDrive {
  drive: string;
  usedGB: number;
  freeGB: number;
  totalGB: number;
  usedPct: number;
}

interface ServerStatus {
  online: boolean;
  FileAppCliente: boolean;
  DOAStatus: boolean;
  lastSeen?: number | null;
  users?: string[];
  cpu?: number;
  ram?: number;
  disk?: DiskDrive[];
  _err?: string;
}

interface ApiResponse {
  data: Record<string, ServerStatus>;
  cachedAt: number;
  error?: string;
}

interface Props {
  isDark: boolean;
}

const REFRESH_MS    = 5 * 60 * 1000;
const AGENT_WARN_MS = 30 * 60 * 1000;

const IP_NAMES: Record<string, string> = {
  '10.104.12.2':  'QV1',
  '10.104.12.6':  'QV2',
  '10.104.12.10': 'QV3',
  '10.104.12.14': 'QV4',
  '10.104.12.18': 'QV5',
  '10.104.12.22': 'QV6',
  '10.104.12.26': 'QV7',
  '10.104.12.30': 'QV8',
  '10.104.12.33': 'QV9',
  '10.104.12.38': 'QV10',
};

const DEFAULT_ORDER = Object.keys(IP_NAMES).sort((a, b) =>
  (IP_NAMES[a] ?? a).localeCompare(IP_NAMES[b] ?? b, undefined, { numeric: true })
);

function loadOrder(): string[] {
  try {
    const saved = localStorage.getItem('server-order');
    if (saved) {
      const parsed = JSON.parse(saved) as string[];
      const known = new Set(parsed);
      const extra = DEFAULT_ORDER.filter(ip => !known.has(ip));
      return [...parsed.filter(ip => DEFAULT_ORDER.includes(ip)), ...extra];
    }
  } catch {}
  return [...DEFAULT_ORDER];
}

function timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 90) return 'ahora';
  return `hace ${Math.floor(sec / 60)} min`;
}

function SectionHeader({ title, open, onToggle }: { title: string; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 w-full text-left group">
      {open
        ? <ChevronDown  className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors shrink-0" />
        : <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors shrink-0" />
      }
      <span className="font-bold uppercase tracking-wider text-[10px] text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors">
        {title}
      </span>
    </button>
  );
}

export default function ServerStatusPanel({ isDark: _isDark }: Props) {
  const [data, setData]         = useState<Record<string, ServerStatus> | null>(null);
  const [cachedAt, setCachedAt] = useState<number>(0);
  const [loading, setLoading]   = useState(false);
  const [order, setOrder]       = useState<string[]>(loadOrder);
  const [expandedIp, setExpandedIp] = useState<string | null>(null);
  const [, setTick]             = useState(0);
  const dragSrc                 = useRef<string | null>(null);

  const [openServers, setOpenServers] = useState(true);
  const [openCpuRam,  setOpenCpuRam]  = useState(true);
  const [openHdd,     setOpenHdd]     = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const r    = await fetch(force ? '/api/servers?refresh=1' : '/api/servers');
      const json = await r.json() as ApiResponse;
      setData(json.data);
      setCachedAt(json.cachedAt);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const saveOrder = (next: string[]) => {
    setOrder(next);
    try { localStorage.setItem('server-order', JSON.stringify(next)); } catch {}
  };

  const onDragStart = (ip: string) => { dragSrc.current = ip; };
  const onDragOver  = (e: React.DragEvent, ip: string) => {
    e.preventDefault();
    if (!dragSrc.current || dragSrc.current === ip) return;
    const next = [...order];
    const from = next.indexOf(dragSrc.current);
    const to   = next.indexOf(ip);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragSrc.current);
    setOrder(next);
  };
  const onDrop = () => { saveOrder(order); dragSrc.current = null; };

  const sortedIps = order.filter(ip => data ? true : DEFAULT_ORDER.includes(ip));

  return (
    <div className="bg-white/90 dark:bg-slate-900/90 p-3 rounded-xl shadow-lg backdrop-blur-sm border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex flex-col gap-3 w-52">

      {/* Título global + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
          <Monitor className="w-3 h-3" />
          <span className="font-bold uppercase tracking-wider text-[10px]">Monitores QV</span>
        </div>
        <div className="flex items-center gap-1.5">
          {cachedAt > 0 && (
            <span className="text-[9px] text-slate-400 dark:text-slate-500">{timeAgo(cachedAt)}</span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors disabled:opacity-50"
            title="Actualizar"
          >
            <RefreshCw className={`w-2.5 h-2.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* ══ SERVIDORES ══ */}
      <div className="flex flex-col gap-1">
        <SectionHeader title="Servidores" open={openServers} onToggle={() => setOpenServers(o => !o)} />
        {openServers && (
          <>
            <div className="grid grid-cols-[12px_1fr_28px_28px] items-center gap-1 px-1">
              <span /><span />
              <span className="text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">F</span>
              <span className="text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">D</span>
            </div>
            {loading && !data && (
              <p className="text-[10px] text-slate-400 italic px-1">Verificando...</p>
            )}
            <div className="flex flex-col gap-0.5">
              {sortedIps.map(ip => {
                const status    = data?.[ip] ?? { online: false, FileAppCliente: false, DOAStatus: false };
                const allOk     = status.online && status.FileAppCliente && status.DOAStatus;
                const partial   = status.online && (status.FileAppCliente || status.DOAStatus);
                const dotColor  = !status.online ? 'bg-red-500' : allOk ? 'bg-emerald-500' : partial ? 'bg-amber-400' : 'bg-red-400';
                const label     = IP_NAMES[ip] ?? ip;
                const now       = Date.now();
                const agentLost = status.lastSeen == null || (now - status.lastSeen) > AGENT_WARN_MS;
                const lastSeenStr = status.lastSeen ? timeAgo(status.lastSeen) : 'nunca';
                const errMsg    = status._err ? `\n⚠ ${status._err}` : '';
                const title     = agentLost
                  ? `${label} (${ip})\n⚠ Agente sin comunicación (último reporte: ${lastSeenStr})\nEstado de procesos desconocido`
                  : `${label} (${ip})\nOnline: ${status.online ? '✓' : '✗'}\nFileAppCliente: ${status.FileAppCliente ? '✓' : '✗'}\nDOAStatus: ${status.DOAStatus ? '✓' : '✗'}${errMsg}`;
                return (
                  <div key={ip}>
                    <div
                      draggable
                      onDragStart={() => onDragStart(ip)}
                      onDragOver={(e) => onDragOver(e, ip)}
                      onDrop={onDrop}
                      onClick={() => setExpandedIp(prev => prev === ip ? null : ip)}
                      title={title}
                      className="grid grid-cols-[12px_1fr_28px_28px] items-center gap-1 px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer select-none group"
                    >
                      <GripVertical className="w-2.5 h-2.5 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex items-center gap-1.5 min-w-0">
                        {agentLost
                          ? <WifiOff className="w-3 h-3 text-amber-500 shrink-0" />
                          : <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
                        }
                        <span className={`font-semibold text-[11px] truncate ${
                          agentLost ? 'text-amber-500 dark:text-amber-400' : 'text-slate-700 dark:text-slate-200'
                        }`}>{label}</span>
                      </div>
                      <span className={`text-center text-[12px] font-bold leading-none ${status.FileAppCliente ? 'text-emerald-500' : 'text-red-400'}`}>
                        {status.FileAppCliente ? '✓' : '✗'}
                      </span>
                      <span className={`text-center text-[12px] font-bold leading-none ${status.DOAStatus ? 'text-emerald-500' : 'text-red-400'}`}>
                        {status.DOAStatus ? '✓' : '✗'}
                      </span>
                    </div>
                    {expandedIp === ip && (
                      <div className="ml-4 mb-1 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
                        {agentLost ? (
                          <p className="text-[10px] text-amber-500 italic py-0.5">Agente sin comunicación</p>
                        ) : (status.users ?? []).length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic py-0.5">Sin usuarios</p>
                        ) : (
                          (status.users ?? []).map(u => (
                            <p key={u} className="text-[10px] text-slate-600 dark:text-slate-300 py-px font-mono">{u}</p>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800" />

      {/* ══ CPU / RAM ══ */}
      <div className="flex flex-col gap-1">
        <SectionHeader title="CPU / RAM" open={openCpuRam} onToggle={() => setOpenCpuRam(o => !o)} />
        {openCpuRam && data && (
          <div className="flex flex-col gap-1.5 mt-0.5">
            {sortedIps.map(ip => {
              const s       = data[ip] ?? { online: false, FileAppCliente: false, DOAStatus: false };
              const label   = IP_NAMES[ip] ?? ip;
              const offline = !s.online;
              return (
                <div key={ip} className="grid grid-cols-[22px_1fr] items-center gap-x-1.5 gap-y-0.5">
                  <span className={`text-[10px] font-bold row-span-2 self-center ${offline ? 'text-slate-400 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>{label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-bold text-slate-400 w-5">CPU</span>
                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${offline ? 'bg-slate-300 dark:bg-slate-600' : (s.cpu ?? 0) > 85 ? 'bg-red-500' : (s.cpu ?? 0) > 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                        style={{ width: offline ? '0%' : `${Math.min(s.cpu ?? 0, 100)}%` }} />
                    </div>
                    <span className={`text-[9px] font-mono w-6 text-right ${offline ? 'text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>{offline ? '—' : `${s.cpu ?? 0}%`}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[8px] font-bold text-slate-400 w-5">RAM</span>
                    <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${offline ? 'bg-slate-300 dark:bg-slate-600' : (s.ram ?? 0) > 85 ? 'bg-red-500' : (s.ram ?? 0) > 60 ? 'bg-amber-400' : 'bg-blue-500'}`}
                        style={{ width: offline ? '0%' : `${Math.min(s.ram ?? 0, 100)}%` }} />
                    </div>
                    <span className={`text-[9px] font-mono w-6 text-right ${offline ? 'text-slate-400' : 'text-slate-600 dark:text-slate-300'}`}>{offline ? '—' : `${s.ram ?? 0}%`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800" />

      {/* ══ HDD ══ */}
      <div className="flex flex-col gap-1">
        <SectionHeader title="HDD" open={openHdd} onToggle={() => setOpenHdd(o => !o)} />
        {openHdd && data && (
          <div className="flex flex-col gap-1.5 mt-0.5">
            {sortedIps.map(ip => {
              const s       = data[ip] ?? { online: false, FileAppCliente: false, DOAStatus: false };
              const label   = IP_NAMES[ip] ?? ip;
              const offline = !s.online;
              const drives  = s.disk ?? [];
              return (
                <div key={ip} className="grid grid-cols-[22px_1fr] items-start gap-x-1.5">
                  <span className={`text-[10px] font-bold self-center ${offline ? 'text-slate-400 dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>{label}</span>
                  <div className="flex flex-col gap-0.5">
                    {offline || drives.length === 0 ? (
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full" />
                        <span className="text-[9px] font-mono w-8 text-right text-slate-400">—</span>
                      </div>
                    ) : drives.map(d => (
                      <div key={d.drive} className="flex items-center gap-1" title={`${d.drive} — Usado: ${d.usedGB} GB / ${d.totalGB} GB`}>
                        <span className="text-[8px] font-bold text-slate-400 w-5">{d.drive}</span>
                        <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${d.usedPct > 90 ? 'bg-red-500' : d.usedPct > 75 ? 'bg-amber-400' : 'bg-sky-500'}`}
                            style={{ width: `${Math.min(d.usedPct, 100)}%` }} />
                        </div>
                        <span className="text-[9px] font-mono w-10 text-right text-slate-600 dark:text-slate-300">{d.freeGB}GB libre</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

