import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphLink } from '../lib/data';

export type LayoutType = 'force' | 'hierarchical' | 'radial';

interface NetworkGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedNode: string | null;
  connectedNodes: Set<string>;
  layoutType: LayoutType;
  isDark: boolean;
  onNodeClick: (node: GraphNode) => void;
}

export default function NetworkGraph({ nodes, links, selectedNode, connectedNodes, layoutType, isDark, onNodeClick }: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<d3.SimulationNodeDatum, undefined> | null>(null);
  const positionsRef = useRef<Record<string, Record<string, { x: number; y: number; fx: number | null; fy: number | null }>>>({});
  const [resetKey, setResetKey] = useState(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/layout')
      .then(r => r.json())
      .then(data => { if (data && typeof data === 'object') positionsRef.current = data; })
      .catch(() => {});
  }, []);

  const savePositions = () => {
    // Debounce: espera 800ms después del último cambio antes de guardar
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch('/api/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(positionsRef.current),
      }).catch(() => {});
    }, 800);
  };

  useEffect(() => {
    if (!containerRef.current || !svgRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous graph

    // Add a group wrapper for zoom support
    const g = svg.append('g');

    // Simple zoom setup
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Filter links based on whether they refer to existing nodes
    const validLinks = links.filter(
      l => nodes.find(n => n.id === (typeof l.source === 'object' ? (l.source as any).id : l.source)) 
        && nodes.find(n => n.id === (typeof l.target === 'object' ? (l.target as any).id : l.target))
    ).map(d => Object.create(d));

    const validNodes = nodes.map(d => Object.create(d));

    // Apply saved positions for this layout
    const savedPos = positionsRef.current[layoutType] ?? {};
    const hasSavedPositions = Object.keys(savedPos).length > 0;
    validNodes.forEach((n: any) => {
      const p = savedPos[n.id];
      if (p) {
        n.x = p.x;
        n.y = p.y;
        if (p.fx != null) n.fx = p.fx;
        if (p.fy != null) n.fy = p.fy;
      }
    });

    // Calculate degrees to display inside nodes
    const nodeDegrees = new Map<string, number>();
    validNodes.forEach(n => nodeDegrees.set(n.id, 0));
    validLinks.forEach(l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      nodeDegrees.set(sid, (nodeDegrees.get(sid) || 0) + 1);
      nodeDegrees.set(tid, (nodeDegrees.get(tid) || 0) + 1);
    });

    const simulation = d3.forceSimulation(validNodes)
    
    // Base collide applied to all layouts
    simulation.force('collide', d3.forceCollide().radius((d: any) => d.type === 'sucursal' ? 18 : 13).iterations(3));

    if (layoutType === 'force') {
      simulation
        .force('link', d3.forceLink(validLinks).id((d: any) => d.id).distance(28))
        .force('charge', d3.forceManyBody().strength(-60))
        .force('center', d3.forceCenter(width / 2, height / 2));
    } else if (layoutType === 'hierarchical') {
      simulation
        .force('link', d3.forceLink(validLinks).id((d: any) => d.id).distance(22))
        .force('charge', d3.forceManyBody().strength(-50))
        .force('y', d3.forceY((d: any) => d.type === 'sucursal' ? height * 0.3 : height * 0.7).strength(0.8))
        .force('x', d3.forceX(width / 2).strength(0.05))
        .force('center', d3.forceCenter(width / 2, height / 2));
    } else if (layoutType === 'radial') {
      simulation
        .force('link', d3.forceLink(validLinks).id((d: any) => d.id).distance(22))
        .force('charge', d3.forceManyBody().strength(-50))
        .force('radial', d3.forceRadial((d: any) => d.type === 'sucursal' ? 60 : 180, width / 2, height / 2).strength(0.9));
    }

    // Detect branches connected to 2+ supervisors
    const supervisorSet = new Set(nodes.filter(n => n.type === 'supervisor').map(n => n.id));
    // Count how many supervisors each branch links to
    const branchSupervisorCount = new Map<string, number>();
    validLinks.forEach((l: any) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      const branchId = sid.startsWith('branch_') ? sid : tid.startsWith('branch_') ? tid : null;
      const otherId = sid.startsWith('branch_') ? tid : tid.startsWith('branch_') ? sid : null;
      if (branchId && otherId && supervisorSet.has(otherId)) {
        branchSupervisorCount.set(branchId, (branchSupervisorCount.get(branchId) ?? 0) + 1);
      }
    });
    // A link is a conflict link if: branch↔supervisor AND that branch has ≥2 supervisors
    const isConflictLink = (l: any): boolean => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      const branchId = sid.startsWith('branch_') ? sid : tid.startsWith('branch_') ? tid : null;
      const otherId = sid.startsWith('branch_') ? tid : tid.startsWith('branch_') ? sid : null;
      return !!branchId && !!otherId && supervisorSet.has(otherId) && (branchSupervisorCount.get(branchId) ?? 0) >= 2;
    };

    // Add SVG defs for dash animation
    const defs = svg.append('defs');
    defs.append('style').text(`
      @keyframes dash-flow {
        to { stroke-dashoffset: -20; }
      }
      .conflict-link {
        stroke: #ef4444;
        stroke-opacity: 0.85;
        stroke-width: 2.5;
        stroke-dasharray: 6 4;
        animation: dash-flow 0.8s linear infinite;
      }
    `);

    simulationRef.current = simulation;

    // Tag each link with _conflict so the selection effect can read it later
    validLinks.forEach((l: any) => { l._conflict = isConflictLink(l); });

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(validLinks)
      .join('line')
      .attr('class', (d: any) => d._conflict ? 'conflict-link' : '')
      .attr('stroke', (d: any) => d._conflict ? '#ef4444' : (isDark ? '#475569' : '#cbd5e1'))
      .attr('stroke-opacity', (d: any) => d._conflict ? 0.85 : 0.6)
      .attr('stroke-width', (d: any) => d._conflict ? 2.5 : 2)
      .attr('stroke-dasharray', (d: any) => d._conflict ? '6 4' : null);

    // Draw nodes
    const node = g.append('g')
      .attr('stroke', isDark ? '#1e293b' : '#fff')
      .attr('stroke-width', 1.5)
      .selectAll('circle')
      .data(validNodes)
      .join('circle')
      .attr('r', (d: any) => d.type === 'sucursal' ? 14 : 10)
      .attr('fill', (d: any) => {
        if (d.type === 'sucursal') return '#3b82f6';
        if (d.type === 'supervisor') return '#a855f7'; // Purple for supervisors
        return '#10b981'; // Green for normal users
      })
      .attr('cursor', 'grab');

    // Drag behaviour – pin node on drag, treat no-movement as click
    const drag = d3.drag<SVGCircleElement, any>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        d._dragging = false;
        d3.select(event.sourceEvent.target).attr('cursor', 'grabbing');
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
        d._dragging = true;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d3.select(event.sourceEvent.target).attr('cursor', 'grab');
        if (!d._dragging) {
          // It was a click — release pin and fire handler
          d.fx = null;
          d.fy = null;
          const originalNode = nodes.find(n => n.id === d.id);
          if (originalNode) onNodeClick(originalNode);
        }
        // If it was a drag, keep node pinned where the user dropped it
        // Persist positions after drag
        if (!positionsRef.current[layoutType]) positionsRef.current[layoutType] = {};
        (validNodes as any[]).forEach((n: any) => {
          positionsRef.current[layoutType][n.id] = { x: n.x, y: n.y, fx: n.fx ?? null, fy: n.fy ?? null };
        });
        savePositions();
      });

    (node as any).call(drag);

    node.append('title')
      .text((d: any) => d.label);

    // Internal node labels (degrees)
    const innerLabels = g.append('g')
      .selectAll('text')
      .data(validNodes)
      .join('text')
      .attr('class', 'inner-label')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#ffffff')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none')
      .text((d: any) => nodeDegrees.get(d.id) || 0);

    // Labels
    const labels = g.append('g')
      .selectAll('text.outer-label')
      .data(validNodes)
      .join('text')
      .attr('class', 'outer-label')
      .attr('dy', 22)
      .attr('text-anchor', 'middle')
      .attr('font-size', 9)
      .attr('fill', isDark ? '#94a3b8' : '#374151')
      .attr('font-weight', '500')
      .text((d: any) => d.label);

    const fitToView = () => {
      const ns = validNodes as any[];
      if (ns.length === 0) return;
      const xs = ns.map(n => n.x as number);
      const ys = ns.map(n => n.y as number);
      const minX = Math.min(...xs) - 30;
      const maxX = Math.max(...xs) + 30;
      const minY = Math.min(...ys) - 30;
      const maxY = Math.max(...ys) + 30;
      const scaleX = width / (maxX - minX);
      const scaleY = height / (maxY - minY);
      const scale = Math.min(scaleX, scaleY, 2) * 0.9;
      const tx = (width - scale * (minX + maxX)) / 2;
      const ty = (height - scale * (minY + maxY)) / 2;
      svg.transition().duration(600).call(
        zoom.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    };

    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);
        
      innerLabels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);

      labels
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);

      // Keep positions ref in sync on every tick
      if (!positionsRef.current[layoutType]) positionsRef.current[layoutType] = {};
      (validNodes as any[]).forEach((n: any) => {
        positionsRef.current[layoutType][n.id] = { x: n.x, y: n.y, fx: n.fx ?? null, fy: n.fy ?? null };
      });
    });

    simulation.on('end', () => {
      if (!positionsRef.current[layoutType]) positionsRef.current[layoutType] = {};
      (validNodes as any[]).forEach((n: any) => {
        positionsRef.current[layoutType][n.id] = { x: n.x, y: n.y, fx: n.fx ?? null, fy: n.fy ?? null };
      });
      savePositions();
      if (!hasSavedPositions) fitToView();
    });

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      simulation.force('center', d3.forceCenter(w / 2, h / 2));
      simulation.alpha(0.3).restart();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      simulation.stop();
    };
  }, [nodes, links, layoutType, isDark, resetKey]);

  // Separate effect for selection to prevent full reset of simulation
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg.selectAll('circle')
      .attr('fill', (d: any) => {
        if (!selectedNode) {
          if (d.type === 'sucursal') return '#3b82f6';
          if (d.type === 'supervisor') return '#a855f7';
          return '#10b981';
        }
        if (selectedNode === d.id) return '#ef4444'; // Highlight selected node
        if (connectedNodes.has(d.id)) {
          if (d.type === 'sucursal') return '#3b82f6';
          if (d.type === 'supervisor') return '#a855f7';
          return '#10b981';
        }
        return isDark ? '#334155' : '#cbd5e1'; // Fade out disconnected
      })
      .attr('opacity', (d: any) => {
        if (!selectedNode) return 1;
        if (selectedNode === d.id || connectedNodes.has(d.id)) return 1;
        return 0.4;
      })
      .attr('r', (d: any) => {
        if (selectedNode === d.id) return d.type === 'sucursal' ? 17 : 13;
        return d.type === 'sucursal' ? 14 : 10;
      });

    svg.selectAll('text.outer-label')
      .attr('fill', (d: any) => {
        if (!selectedNode) return isDark ? '#94a3b8' : '#374151';
        if (selectedNode === d.id || connectedNodes.has(d.id)) return isDark ? '#f8fafc' : '#1e293b';
        return isDark ? '#475569' : '#94a3b8';
      })
      .attr('opacity', (d: any) => {
        if (!selectedNode) return 1;
        if (selectedNode === d.id || connectedNodes.has(d.id)) return 1;
        return 0.4;
      });
      
    svg.selectAll('text.inner-label')
      .attr('opacity', (d: any) => {
        if (!selectedNode) return 1;
        if (selectedNode === d.id || connectedNodes.has(d.id)) return 1;
        return 0.2;
      });

    svg.selectAll<SVGLineElement, any>('line')
      .attr('stroke', (d: any) => {
        const isConflict = d._conflict === true;
        if (!selectedNode) return isConflict ? '#ef4444' : (isDark ? '#475569' : '#cbd5e1');
        const sid = typeof d.source === 'object' ? d.source.id : d.source;
        const tid = typeof d.target === 'object' ? d.target.id : d.target;
        if (sid === selectedNode || tid === selectedNode) return isConflict ? '#ef4444' : '#3b82f6';
        return isDark ? '#0f172a' : '#f1f5f9';
      })
      .attr('stroke-opacity', (d: any) => {
        if (!selectedNode) return 0.6;
        const sid = typeof d.source === 'object' ? d.source.id : d.source;
        const tid = typeof d.target === 'object' ? d.target.id : d.target;
        if (sid === selectedNode || tid === selectedNode) return 0.8;
        return 0.2;
      })
      .attr('stroke-width', (d: any) => {
        if (!selectedNode) return 2;
        const sid = typeof d.source === 'object' ? d.source.id : d.source;
        const tid = typeof d.target === 'object' ? d.target.id : d.target;
        if (sid === selectedNode || tid === selectedNode) return 3;
        return 1;
      });

  }, [selectedNode, connectedNodes, isDark]);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[500px] relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute bottom-4 right-4 flex gap-2">
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(positionsRef.current, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'graph-layout.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          className="px-3 py-1.5 text-xs font-medium bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-lg shadow text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors backdrop-blur-sm"
          title="Exportar posiciones"
        >
          Exportar vista
        </button>
        <label
          className="px-3 py-1.5 text-xs font-medium bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-lg shadow text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors backdrop-blur-sm cursor-pointer"
          title="Importar posiciones"
        >
          Importar vista
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                try {
                  const data = JSON.parse(ev.target?.result as string);
                  positionsRef.current = data;
                  savePositions();
                  setResetKey(k => k + 1);
                } catch {}
              };
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => {
            delete positionsRef.current[layoutType];
            savePositions();
            setResetKey(k => k + 1);
          }}
          className="px-3 py-1.5 text-xs font-medium bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 rounded-lg shadow text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors backdrop-blur-sm"
          title="Restablecer posiciones de esta vista"
        >
          Restablecer vista
        </button>
      </div>
    </div>
  );
}
