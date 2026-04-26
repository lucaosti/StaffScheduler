import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { DraggableList, DraggableItem } from './DraggableList';

const Harness: React.FC = () => {
  const [items, setItems] = useState<DraggableItem[]>([
    { id: 1, label: 'A' },
    { id: 2, label: 'B' },
    { id: 3, label: 'C' },
  ]);
  return (
    <div>
      <DraggableList items={items} onReorder={setItems} />
      <span data-testid="order">{items.map((i) => i.label).join(',')}</span>
    </div>
  );
};

describe('<DraggableList />', () => {
  it('renders one li per item with the label', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Reorderable list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('moves an item when dropped onto another', () => {
    render(<Harness />);
    const items = screen.getAllByRole('listitem');
    fireEvent.dragStart(items[0]);
    fireEvent.dragOver(items[2]);
    fireEvent.drop(items[2]);
    expect(screen.getByTestId('order')).toHaveTextContent('B,C,A');
  });

  it('is a no-op when dropping onto itself', () => {
    render(<Harness />);
    const items = screen.getAllByRole('listitem');
    fireEvent.dragStart(items[1]);
    fireEvent.drop(items[1]);
    expect(screen.getByTestId('order')).toHaveTextContent('A,B,C');
  });
});
