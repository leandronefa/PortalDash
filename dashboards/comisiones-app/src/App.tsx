/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Building2, Users, Briefcase, Search, UsersIcon, MapPin, X, EyeOff, Network, AlignEndVertical, CircleDot, PanelRightClose, PanelRightOpen, UserCog, Moon, Sun, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { fetchData, getParsedData, getGraphData, GraphNode, GraphLink, DataRow } from './lib/data';
import NetworkGraph, { LayoutType } from './components/NetworkGraph';
import { cn } from './lib/utils';

export default function App() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [excludedIds, setExcludedIds] = useState<Set<string>>(
    () => {
      try {
        const saved = localStorage.getItem('excluded-ids');
        return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
      } catch { return new Set<string>(); }
    }
  );
  const [layoutType, setLayoutType] = useState<LayoutType>(
    () => (localStorage.getItem('layout') as LayoutType) ?? 'force'
  );
  const [showSidebar, setShowSidebar] = useState(true);
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem('theme') === 'dark'
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const graphRef = useRef<HTMLElement>(null);
  const [rawRows, setRawRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true); else setRefreshing(true);
    setLoadError(null);
    fetchData()
      .then(rows => {
        setRawRows(rows);
        setLastUpdated(new Date());
      })
      .catch(err => setLoadError(String(err)))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!graphRef.current) return;
    if (!document.fullscreenElement) {
      graphRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem('layout', layoutType);
  }, [layoutType]);

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => loadData(false), 60 * 60 * 1000); // 1 hora
    return () => clearInterval(interval);
  }, [loadData]);

  const parsedData = useMemo(() => getParsedData(rawRows), [rawRows]);
  const baseGraphData = useMemo(() => getGraphData(parsedData), [parsedData]);

  const graphData = useMemo(() => {
    return {
      nodes: baseGraphData.nodes.filter(n => !excludedIds.has(n.id)),
      links: baseGraphData.links.filter(l => {
        const sid = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tid = typeof l.target === 'object' ? (l.target as any).id : l.target;
        return !excludedIds.has(sid) && !excludedIds.has(tid);
      })
    };
  }, [baseGraphData, excludedIds]);

  // Compute stats
  const sucursalCount = useMemo(() => new Set(graphData.nodes.filter(n => n.type === 'sucursal').map(n => n.id)).size, [graphData]);
  const userCount = useMemo(() => new Set(graphData.nodes.filter(n => n.type === 'usuario').map(n => n.id)).size, [graphData]);
  const connectionCount = graphData.links.length;

  const handleNodeClick = (node: GraphNode) => {
    setSelectedNode(node.id === selectedNode ? null : node.id);
  };

  const toggleExclude = (id: string) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem('excluded-ids', JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
    if (selectedNode === id) setSelectedNode(null);
  };

  // Connected nodes
  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    
    // Find all links involving selected node
    const conn = new Set<string>();
    graphData.links.forEach(l => {
      const sid = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tid = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (sid === selectedNode) conn.add(tid);
      if (tid === selectedNode) conn.add(sid);
    });
    return conn;
  }, [selectedNode, graphData.links]);

  const sortedNodes = useMemo(() => {
    return [...graphData.nodes]
      .filter(n => n.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'sucursal' ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }, [graphData.nodes, search]);

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-500 text-sm font-medium">
      Cargando datos...
    </div>
  );

  if (loadError) return (
    <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 text-red-500 text-sm font-medium">
      Error al cargar datos: {loadError}
    </div>
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200 p-8 overflow-hidden transition-colors">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 shrink-0 transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-lg">
            <Briefcase className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Análisis de Asignaciones</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Auditoría de Asignación: Sucursales vs Usuarios</p>
          </div>
        </div>
        
        <div className="flex gap-4 items-center">
          <button 
            onClick={() => loadData(false)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
            title="Actualizar datos"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="text-xs font-medium hidden sm:inline">
              {lastUpdated ? lastUpdated.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </button>
          <button 
            onClick={() => setIsDark(!isDark)}
            className="p-2 mr-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
            title={isDark ? "Modo Claro" : "Modo Oscuro"}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold uppercase tracking-wider border border-blue-100 dark:border-blue-800 flex items-center gap-2">
            <Building2 className="w-4 h-4" /> <span className="font-medium">{sucursalCount}</span> Sucursales
          </div>
          <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold uppercase tracking-wider border border-emerald-100 dark:border-emerald-800 flex items-center gap-2">
            <UsersIcon className="w-4 h-4" /> <span className="font-medium">{userCount}</span> Usuarios
          </div>
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold uppercase tracking-wider border border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Briefcase className="w-4 h-4" /> <span className="font-medium">{connectionCount}</span> Asignaciones
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex gap-8 relative overflow-hidden">
        {/* Graph Area */}
        <main ref={graphRef} className="flex-[2] relative bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden flex flex-col justify-center items-center transition-colors">
          <div className="absolute top-6 left-6 z-10 bg-white/90 dark:bg-slate-900/90 p-4 rounded-xl shadow-lg backdrop-blur-sm border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Leyenda</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span className="font-medium text-slate-700 dark:text-slate-300">Sucursal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="font-medium text-slate-700 dark:text-slate-300">Usuario normal</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                <span className="font-medium text-slate-700 dark:text-slate-300">Supervisor</span>
              </div>
            </div>
          </div>
          
          <div className="absolute top-6 right-6 z-10 bg-white/90 dark:bg-slate-900/90 p-1.5 rounded-xl shadow-lg backdrop-blur-sm border border-slate-100 dark:border-slate-700 flex items-center gap-1 transition-colors">
            <button
              onClick={() => setLayoutType('force')}
              className={cn("p-2 rounded-lg flex items-center justify-center transition-colors group", layoutType === 'force' ? "bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
              title="Grafo Compacto"
            >
              <Network className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLayoutType('hierarchical')}
              className={cn("p-2 rounded-lg flex items-center justify-center transition-colors group", layoutType === 'hierarchical' ? "bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
              title="Árbol Jerárquico"
            >
              <AlignEndVertical className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLayoutType('radial')}
              className={cn("p-2 rounded-lg flex items-center justify-center transition-colors group", layoutType === 'radial' ? "bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900" : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")}
              title="Estrella / Radial"
            >
              <CircleDot className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSidebar(s => !s)}
              className="p-2 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              title={showSidebar ? "Ocultar panel lateral" : "Mostrar panel lateral"}
            >
              {showSidebar ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
            </button>
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>

          <NetworkGraph 
            nodes={graphData.nodes} 
            links={graphData.links} 
            selectedNode={selectedNode}
            connectedNodes={connectedNodeIds}
            layoutType={layoutType}
            isDark={isDark}
            onNodeClick={handleNodeClick}
          />
        </main>

        {/* Sidebar */}
        {showSidebar && (
        <aside className="w-96 flex flex-col shrink-0 gap-4 overflow-hidden bg-transparent">
          <div className="p-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-sm shrink-0 transition-colors">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar por sucursal o usuario..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all"
              />
            </div>
            {selectedNode && (
               <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl text-sm flex items-start justify-between border border-red-100 dark:border-red-800">
                 <div>
                   <p className="font-bold flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                     {graphData.nodes.find(n => n.id === selectedNode)?.type === 'sucursal' 
                       ? <><Building2 className="w-3 h-3" /> Filtro: Sucursal</>
                       : <><UsersIcon className="w-3 h-3" /> Filtro: {graphData.nodes.find(n => n.id === selectedNode)?.type.toUpperCase()}</>
                     }
                   </p>
                   <p className="font-semibold text-slate-800 mt-1">
                     {graphData.nodes.find(n => n.id === selectedNode)?.label}
                   </p>
                 </div>
                  <button 
                  onClick={() => setSelectedNode(null)}
                  className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-lg transition-colors text-red-500 dark:text-red-400"
                 >
                   <X className="w-4 h-4" />
                 </button>
               </div>
            )}
          </div>
          
          {excludedIds.size > 0 && (
            <div className="flex flex-col gap-2 p-4 pt-0 shrink-0">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Filtros Activos (Excluidos):</span>
              <div className="flex flex-wrap gap-2">
                {Array.from(excludedIds).map((id: string) => {
                  const node = baseGraphData.nodes.find(n => n.id === id);
                  if (!node) return null;
                  return (
                    <span key={id} className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-xs font-medium text-slate-600 dark:text-slate-300">
                      {node.label}
                      <button 
                        onClick={() => toggleExclude(id)}
                        className="hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-3 pb-8 px-1 pr-2 custom-scrollbar">
            {sortedNodes.map(node => {
              const isSelected = selectedNode === node.id;
              const isConnected = connectedNodeIds.has(node.id);
              
              // Only dim items if there's a selection and it's neither the selection nor connected to it
              const isDimmed = selectedNode !== null && !isSelected && !isConnected;

              return (
                <div
                  key={node.id}
                  onClick={() => handleNodeClick(node)}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "w-full text-left p-4 bg-white dark:bg-slate-900 border rounded-xl shadow-sm flex items-center justify-between group cursor-pointer transition-all",
                    isSelected 
                      ? "border-blue-600 dark:border-blue-500 ring-4 ring-blue-100 dark:ring-blue-900/50 bg-blue-50 dark:bg-slate-800" 
                      : "border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50",
                    isDimmed && "opacity-50",
                    node.type === 'sucursal' && isSelected && "border-l-4 border-l-blue-600 dark:border-l-blue-500 bg-blue-600 dark:bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900/50",
                    node.type === 'usuario' && isSelected && "border-l-4 border-l-emerald-500 dark:border-l-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-900 dark:text-emerald-100 border-emerald-400 dark:border-emerald-600 ring-4 ring-emerald-100 dark:ring-emerald-900/50",
                    node.type === 'supervisor' && isSelected && "border-l-4 border-l-purple-500 dark:border-l-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-900 dark:text-purple-100 border-purple-400 dark:border-purple-600 ring-4 ring-purple-100 dark:ring-purple-900/50",
                    node.type === 'sucursal' && !isSelected && "border-l-4 border-l-blue-400 dark:border-l-blue-500",
                    node.type === 'usuario' && !isSelected && "border-l-4 border-l-emerald-400 dark:border-l-emerald-500",
                    node.type === 'supervisor' && !isSelected && "border-l-4 border-l-purple-400 dark:border-l-purple-500"
                  )}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={cn(
                      "p-2 rounded-lg shrink-0",
                      node.type === 'sucursal' && !isSelected && "bg-slate-100 dark:bg-slate-800 text-blue-500 dark:text-blue-400",
                      node.type === 'usuario' && !isSelected && "bg-slate-100 dark:bg-slate-800 text-emerald-500 dark:text-emerald-400",
                      node.type === 'supervisor' && !isSelected && "bg-slate-100 dark:bg-slate-800 text-purple-500 dark:text-purple-400",
                      node.type === 'sucursal' && isSelected && "bg-white/20 text-white",
                      node.type === 'usuario' && isSelected && "bg-emerald-200/50 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
                      node.type === 'supervisor' && isSelected && "bg-purple-200/50 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300"
                    )}>
                      {node.type === 'sucursal' ? <MapPin className="w-4 h-4" /> : node.type === 'supervisor' ? <UserCog className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "font-semibold truncate transition-colors",
                        node.type === 'sucursal' && isSelected ? "text-white uppercase" : "text-slate-700 dark:text-slate-200"
                      )}>
                        {node.label}
                      </p>
                      <span className={cn(
                        "text-xs font-mono block truncate mt-0.5",
                        node.type === 'sucursal' && isSelected ? "text-blue-200" : "text-slate-400 dark:text-slate-500"
                      )}>
                        {node.type.toUpperCase()}: {node.id.split('_')[1]}
                      </span>
                    </div>
                  </div>
                  {isSelected ? (
                     <div className={cn(
                       "text-[10px] px-2 py-1 rounded font-bold uppercase shrink-0 transition-all ml-2",
                       node.type === 'sucursal' && "bg-blue-500 text-white",
                       node.type === 'usuario' && "bg-emerald-200 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300",
                       node.type === 'supervisor' && "bg-purple-200 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300"
                     )}>
                       SELEC.
                     </div>
                  ) : (
                     <button
                       type="button"
                       onClick={(e) => {
                         e.stopPropagation();
                         toggleExclude(node.id);
                       }}
                       title="Excluir del gráfico"
                       className="p-1.5 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all opacity-0 group-hover:opacity-100 shrink-0 ml-2"
                     >
                       <EyeOff className="w-4 h-4" />
                     </button>
                  )}
                </div>
              );
            })}
            
            {sortedNodes.length === 0 && (
              <div className="text-center text-sm text-slate-500 dark:text-slate-400 py-8 font-medium">
                No se encontraron resultados
              </div>
            )}
          </div>
        </aside>
        )}
      </div>
      
      {/* Tooltip/Status Bar */}
      <footer className="mt-8 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-6 shrink-0 transition-colors">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Datos Cargados</span>
          <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Sincronización OK</span>
        </div>
        <div>
          Presione en un <strong>Nodo</strong> para aislar sus relaciones jerárquicas.
        </div>
      </footer>
    </div>
  );
}

