/**
 * Reorderable list using the HTML5 drag-and-drop API (F11).
 *
 * Pure presentational primitive: callers render their own row content
 * and the list reports the new ordering via `onReorder`. No external
 * drag-and-drop dependency.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';

export interface DraggableItem {
  id: string | number;
  label: string;
}

interface DraggableListProps<T extends DraggableItem> {
  items: T[];
  onReorder: (next: T[]) => void;
  renderItem?: (item: T) => React.ReactNode;
  ariaLabel?: string;
}

export const DraggableList = <T extends DraggableItem>({
  items,
  onReorder,
  renderItem,
  ariaLabel = 'Reorderable list',
}: DraggableListProps<T>): React.ReactElement => {
  const [draggingId, setDraggingId] = useState<string | number | null>(null);

  const onDragStart = (id: string | number): void => setDraggingId(id);
  const onDragEnd = (): void => setDraggingId(null);

  const onDragOver = (e: React.DragEvent<HTMLLIElement>): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (overId: string | number): void => {
    if (draggingId === null || draggingId === overId) return;
    const fromIdx = items.findIndex((i) => i.id === draggingId);
    const toIdx = items.findIndex((i) => i.id === overId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...items];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
    setDraggingId(null);
  };

  return (
    <ul className="list-group" aria-label={ariaLabel}>
      {items.map((item) => (
        <li
          key={item.id}
          className={`list-group-item${draggingId === item.id ? ' opacity-50' : ''}`}
          draggable
          onDragStart={() => onDragStart(item.id)}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={() => onDrop(item.id)}
        >
          <i className="bi bi-grip-vertical me-2 text-muted" aria-hidden="true"></i>
          {renderItem ? renderItem(item) : item.label}
        </li>
      ))}
    </ul>
  );
};

export default DraggableList;
