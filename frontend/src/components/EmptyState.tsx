/**
 * EmptyState component.
 *
 * Centered card shown when a list has no items to display.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  icon?: string;
  title: string;
  message?: string;
  action?: Action;
}

const EmptyState: React.FC<Props> = ({ icon, title, message, action }) => (
  <div className="card">
    <div className="card-body text-center py-5">
      {icon && (
        <i className={`bi ${icon} text-muted`} style={{ fontSize: '3rem' }} aria-hidden="true"></i>
      )}
      <h5 className={icon ? 'mt-3' : undefined}>{title}</h5>
      {message && <p className="text-muted mb-0">{message}</p>}
      {action && (
        <button className="btn btn-primary mt-3" type="button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  </div>
);

export default EmptyState;
