/**
 * OrgChart — interactive SVG-based organisation hierarchy viewer.
 *
 * Fetches the org unit tree from GET /api/org/units/tree and renders it as
 * an interactive tree diagram. Each node can be expanded or collapsed by
 * clicking. The root-level nodes are always visible; descendants toggle.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { OrgUnitNode } from '../../services/orgService';
import {
  useOrgTreeQuery,
  useManagerChainQuery,
  useUnitMembersQuery,
} from '../../hooks/useOrg';

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
  highlighted: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

const OrgNode: React.FC<OrgNodeProps> = ({ item, collapsed, hasChildren, highlighted, onSelect, onToggle }) => {
  const { node, x, y } = item;
  const midX = x + NODE_W / 2;
  const midY = y + NODE_H / 2;

  return (
    <g
      role="button"
      aria-label={`${node.name}${highlighted ? ', part of your reporting chain' : ''}${hasChildren ? (collapsed ? ', collapsed' : ', expanded') : ''}`}
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
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
        fill={highlighted ? 'var(--bs-primary-bg-subtle, #cfe2ff)' : 'var(--bs-body-bg, #fff)'}
        stroke="var(--bs-primary, #0d6efd)"
        strokeWidth={highlighted ? 3 : 2}
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
        <g
          role="button"
          aria-label={collapsed ? `Expand ${node.name}` : `Collapse ${node.name}`}
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggle(); }
          }}
          style={{ cursor: 'pointer' }}
        >
          <rect x={x + NODE_W - 26} y={y + NODE_H / 2 - 10} width={20} height={20} fill="transparent" />
          <text
            x={x + NODE_W - 14}
            y={y + NODE_H / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ fontSize: 14, fill: 'var(--bs-primary, #0d6efd)', fontFamily: 'monospace' }}
          >
            {collapsed ? '+' : '−'}
          </text>
        </g>
      )}
    </g>
  );
};

const OrgChart: React.FC = () => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selectedNode, setSelectedNode] = useState<OrgUnitNode | null>(null);

  // Server state via TanStack Query: the tree and the current user's manager
  // chain are cached; a selected node's members are fetched on demand and
  // cached, so re-selecting a node doesn't re-fetch.
  const treeQuery = useOrgTreeQuery();
  const chainQuery = useManagerChainQuery();
  const membersQuery = useUnitMembersQuery(selectedNode?.id ?? null);

  const roots = treeQuery.data ?? [];
  const loading = treeQuery.isLoading;
  const error = treeQuery.isError ? (treeQuery.error as Error).message ?? 'Failed to load org chart.' : null;
  const myChain = useMemo(() => chainQuery.data ?? [], [chainQuery.data]);
  const members = membersQuery.data ?? [];
  const membersLoading = selectedNode !== null && membersQuery.isLoading;
  const membersError = membersQuery.isError
    ? (membersQuery.error as Error).message ?? 'Failed to load members.'
    : null;

  // Units the current user belongs to or reports up through — used to
  // highlight "your" branch of the tree.
  const myUnitIds = useMemo(() => new Set(myChain.map((l) => l.unitId)), [myChain]);

  const toggleNode = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Selecting a node drives useUnitMembersQuery via selectedNode.id.
  const selectNode = (node: OrgUnitNode) => setSelectedNode(node);

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
            <p className="text-muted mb-0 small">Browse every office top-down; click one to see who's in it</p>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={expandAll} aria-label="Expand all nodes">
              <i className="bi bi-arrows-expand me-1" aria-hidden="true"></i>Expand all
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={collapseAll} aria-label="Collapse all nodes">
              <i className="bi bi-arrows-collapse me-1" aria-hidden="true"></i>Collapse all
            </button>
            <button className="btn btn-sm btn-outline-primary" onClick={() => treeQuery.refetch()} aria-label="Refresh org chart">
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

      {myChain.length > 0 && (
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex align-items-center flex-wrap gap-2">
              <span className="text-muted small fw-semibold text-uppercase">Your reporting chain</span>
              {myChain.map((link, i) => (
                <React.Fragment key={link.unitId}>
                  {i > 0 && <i className="bi bi-chevron-right text-muted small" aria-hidden="true"></i>}
                  <span className="small">
                    <span className="fw-semibold">{link.unitName}</span>
                    {link.manager ? (
                      <span className="text-muted"> — {link.manager.firstName} {link.manager.lastName}</span>
                    ) : (
                      <span className="text-muted fst-italic"> — no manager assigned</span>
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
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
                    highlighted={myUnitIds.has(item.node.id)}
                    onSelect={() => void selectNode(item.node)}
                    onToggle={() => toggleNode(item.node.id)}
                  />
                ))}
              </svg>
            </div>
          )}
        </div>
      </div>

      {selectedNode && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${selectedNode.name} details`}>
          <div className="modal-dialog modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {selectedNode.name}
                  {myUnitIds.has(selectedNode.id) && (
                    <span className="badge bg-primary ms-2">You report here</span>
                  )}
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setSelectedNode(null)}></button>
              </div>
              <div className="modal-body">
                {selectedNode.description && (
                  <p className="text-muted small">{selectedNode.description}</p>
                )}
                {membersError && (
                  <div className="alert alert-danger py-2 small" role="alert">{membersError}</div>
                )}
                {membersLoading ? (
                  <div className="d-flex align-items-center justify-content-center py-4">
                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-label="Loading members"></span>Loading…
                  </div>
                ) : members.length === 0 ? (
                  <p className="text-muted small mb-0">No members in this office.</p>
                ) : (
                  <ul className="list-group list-group-flush">
                    {members.map((m) => (
                      <li key={m.userId} className="list-group-item d-flex justify-content-between align-items-center px-0">
                        <div>
                          <div className="fw-semibold">
                            {m.firstName} {m.lastName}
                            {user && Number(user.id) === m.userId && (
                              <span className="badge bg-secondary ms-2">You</span>
                            )}
                          </div>
                          <div className="text-muted small">{m.email}{m.position ? ` · ${m.position}` : ''}</div>
                        </div>
                        {m.isPrimary && <span className="badge bg-success">Primary</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}
    </div>
  );
};

export default OrgChart;
