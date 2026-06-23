/**
 * OrgChart — interactive SVG-based organisation hierarchy viewer.
 *
 * Fetches the org unit tree from GET /api/org/units/tree and renders it as
 * an interactive tree diagram. Each node can be expanded or collapsed by
 * clicking. The root-level nodes are always visible; descendants toggle.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { getTree, OrgUnitNode } from '../../services/orgService';

const NODE_W = 180;
const NODE_H = 60;
const H_GAP = 40;
const V_GAP = 80;

interface TreeNodeLayout {
  node: OrgUnitNode;
  x: number;
  y: number;
  width: number;
}

interface Edge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

function layoutTree(
  nodes: OrgUnitNode[],
  collapsed: Set<number>,
  startY = 0,
  startX = 0
): { items: TreeNodeLayout[]; edges: Edge[]; totalWidth: number; totalHeight: number } {
  const items: TreeNodeLayout[] = [];
  const edges: Edge[] = [];

  function measureWidth(node: OrgUnitNode): number {
    const isCollapsed = collapsed.has(node.id);
    if (isCollapsed || node.children.length === 0) return NODE_W;
    const childrenW = node.children.reduce((sum, c) => sum + measureWidth(c) + H_GAP, -H_GAP);
    return Math.max(NODE_W, childrenW);
  }

  function place(node: OrgUnitNode, cx: number, y: number): void {
    const isCollapsed = collapsed.has(node.id);
    items.push({ node, x: cx - NODE_W / 2, y, width: NODE_W });

    if (!isCollapsed && node.children.length > 0) {
      const childY = y + NODE_H + V_GAP;
      const widths = node.children.map((c) => measureWidth(c));
      const totalChildrenW = widths.reduce((s, w) => s + w + H_GAP, -H_GAP);
      let cursor = cx - totalChildrenW / 2;

      node.children.forEach((child, i) => {
        const childCx = cursor + widths[i] / 2;
        edges.push({
          fromX: cx,
          fromY: y + NODE_H,
          toX: childCx,
          toY: childY,
        });
        place(child, childCx, childY);
        cursor += widths[i] + H_GAP;
      });
    }
  }

  if (nodes.length === 0) return { items, edges, totalWidth: 0, totalHeight: 0 };

  const widths = nodes.map((n) => measureWidth(n));
  const totalW = widths.reduce((s, w) => s + w + H_GAP, -H_GAP);
  let cursor = startX + totalW / 2 - totalW / 2;
  nodes.forEach((node, i) => {
    const cx = cursor + widths[i] / 2;
    place(node, cx, startY);
    cursor += widths[i] + H_GAP;
  });

  const maxX = items.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const maxY = items.reduce((m, n) => Math.max(m, n.y + NODE_H), 0);

  return { items, edges, totalWidth: maxX + 20, totalHeight: maxY + 20 };
}

interface OrgNodeProps {
  item: TreeNodeLayout;
  collapsed: boolean;
  hasChildren: boolean;
  onClick: () => void;
}

const OrgNode: React.FC<OrgNodeProps> = ({ item, collapsed, hasChildren, onClick }) => {
  const { node, x, y } = item;
  const midX = x + NODE_W / 2;
  const midY = y + NODE_H / 2;

  return (
    <g
      role="button"
      aria-label={`${node.name}${hasChildren ? (collapsed ? ', collapsed' : ', expanded') : ''}`}
      aria-expanded={hasChildren ? !collapsed : undefined}
      tabIndex={0}
      style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      onClick={hasChildren ? onClick : undefined}
      onKeyDown={(e) => {
        if (hasChildren && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); }
      }}
    >
      <rect
        x={x}
        y={y}
        width={NODE_W}
        height={NODE_H}
        rx={8}
        ry={8}
        className="org-node-rect"
        fill="var(--bs-body-bg, #fff)"
        stroke="var(--bs-primary, #0d6efd)"
        strokeWidth={2}
      />
      <text
        x={midX}
        y={midY - 6}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 13, fontWeight: 600, fill: 'var(--bs-body-color, #212529)' }}
      >
        {node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name}
      </text>
      {node.description && (
        <text
          x={midX}
          y={midY + 14}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 10, fill: 'var(--bs-secondary-color, #6c757d)' }}
        >
          {node.description.length > 26 ? node.description.slice(0, 24) + '…' : node.description}
        </text>
      )}
      {hasChildren && (
        <text
          x={x + NODE_W - 14}
          y={y + NODE_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 14, fill: 'var(--bs-primary, #0d6efd)', fontFamily: 'monospace' }}
        >
          {collapsed ? '+' : '−'}
        </text>
      )}
    </g>
  );
};

const OrgChart: React.FC = () => {
  const [roots, setRoots] = useState<OrgUnitNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTree();
      setRoots(res.data ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load org chart.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleNode = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const ids = new Set<number>();
    const visit = (node: OrgUnitNode) => {
      if (node.children.length > 0) { ids.add(node.id); node.children.forEach(visit); }
    };
    roots.forEach(visit);
    setCollapsed(ids);
  };

  const { items, edges, totalWidth, totalHeight } = layoutTree(roots, collapsed, 20, 20);
  const svgW = Math.max(totalWidth + 40, 400);
  const svgH = Math.max(totalHeight + 40, 200);

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Organisation Chart</h1>
            <p className="text-muted mb-0 small">Interactive hierarchy of org units</p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={expandAll} aria-label="Expand all nodes">
              <i className="bi bi-arrows-expand me-1" aria-hidden="true"></i>Expand all
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={collapseAll} aria-label="Collapse all nodes">
              <i className="bi bi-arrows-collapse me-1" aria-hidden="true"></i>Collapse all
            </button>
            <button className="btn btn-sm btn-outline-primary" onClick={load} aria-label="Refresh org chart">
              <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card">
        <div className="card-body p-2">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <span className="spinner-border me-2" role="status" aria-label="Loading org chart"></span>
              <span>Loading…</span>
            </div>
          ) : roots.length === 0 ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-diagram-3 fs-3 d-block mb-2" aria-hidden="true"></i>
              No org units found.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', overflowY: 'auto' }}>
              <svg
                role="img"
                aria-label="Organisation chart"
                width={svgW}
                height={svgH}
                viewBox={`0 0 ${svgW} ${svgH}`}
                style={{ display: 'block', minWidth: svgW }}
              >
                {/* Edges */}
                {edges.map((e, i) => (
                  <line
                    key={i}
                    x1={e.fromX}
                    y1={e.fromY}
                    x2={e.toX}
                    y2={e.toY}
                    stroke="var(--bs-border-color, #dee2e6)"
                    strokeWidth={2}
                  />
                ))}
                {/* Nodes */}
                {items.map((item) => (
                  <OrgNode
                    key={item.node.id}
                    item={item}
                    collapsed={collapsed.has(item.node.id)}
                    hasChildren={item.node.children.length > 0}
                    onClick={() => toggleNode(item.node.id)}
                  />
                ))}
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrgChart;
