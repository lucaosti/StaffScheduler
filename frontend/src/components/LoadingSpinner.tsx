/**
 * LoadingSpinner component.
 *
 * Centered Bootstrap spinner with an optional message.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Props {
  message?: string;
}

const LoadingSpinner: React.FC<Props> = ({ message }) => (
  <div className="d-flex flex-column align-items-center justify-content-center py-5">
    <div className="spinner-border text-primary" role="status">
      <span className="visually-hidden">Loading...</span>
    </div>
    {message && <p className="mt-3 text-muted">{message}</p>}
  </div>
);

export default LoadingSpinner;
