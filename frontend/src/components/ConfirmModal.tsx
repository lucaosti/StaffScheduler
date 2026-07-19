/**
 * ConfirmModal component.
 *
 * Bootstrap modal (pure CSS classes, no external library) for confirming
 * destructive or irreversible actions before proceeding.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect } from 'react';

interface Props {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

const ConfirmModal: React.FC<Props> = ({
  show,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) => {
  // Close on Escape, matching native dialog behavior for keyboard users.
  useEffect(() => {
    if (!show) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [show, onCancel]);

  if (!show) return null;

  return (
    <div
      className="modal show d-block"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      aria-describedby="confirm-modal-message"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="confirm-modal-title">
              {title}
            </h5>
            <button
              type="button"
              className="btn-close"
              aria-label="Close"
              onClick={onCancel}
            />
          </div>
          <div className="modal-body">
            <p className="mb-0" id="confirm-modal-message">{message}</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="btn btn-danger" onClick={onConfirm} autoFocus>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
