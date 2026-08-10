/**
 * ButtonSpinner component.
 *
 * The small inline spinner a busy submit/confirm button shows next to its
 * "Saving…"/"Deleting…" label — as opposed to LoadingSpinner, which is the
 * centered, full-section spinner for a page or panel still loading its data.
 * Sixteen call sites across the admin/settings/approval pages had copied the
 * same three-attribute `<span>` by hand; this is that span, factored out.
 *
 * @author Luca Ostinelli
 */

import React from 'react';

interface Props {
  /** Spacing before the label that follows. Defaults to the majority convention. */
  className?: string;
}

const ButtonSpinner: React.FC<Props> = ({ className = 'me-1' }) => (
  <span className={`spinner-border spinner-border-sm ${className}`} role="status" aria-hidden="true"></span>
);

export default ButtonSpinner;
