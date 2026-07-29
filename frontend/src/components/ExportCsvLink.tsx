/**
 * The "Export CSV" control, once, for every list and report.
 *
 * WHY AN ANCHOR RATHER THAN A FETCH. The endpoint returns a file with a content
 * type and a `Content-Disposition` filename, and the session travels in a
 * cookie — so the browser can do the whole thing. Pulling it through the typed
 * client into a blob only to hand it back to a synthesized `<a download>`
 * achieves nothing an anchor does not, while losing the filename the server
 * chose and buffering the file twice in memory. The Directory's vCard link made
 * the same call for the same reason.
 *
 * WHAT IT COSTS. An anchor cannot show an error: a 403 renders as the browser
 * navigating to a JSON error body. That is accepted because these endpoints
 * mirror a listing the user is already looking at — if they can see the table,
 * the export of that table will not refuse. It would NOT be acceptable for an
 * export the user cannot already read on screen.
 *
 * PARAMETERS ARE FILTERED, NOT FORWARDED WHOLESALE. Undefined and empty values
 * are dropped rather than sent as `?department=`, which the backend's schemas
 * would reject or, worse, read as a filter for the empty string. The caller
 * passes the same state the table is filtered by, so the file matches what is on
 * screen — which is the whole expectation a user has of an export button.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { API_BASE_URL } from '../services/apiUtils';

interface ExportCsvLinkProps {
  /** Endpoint path under the API base, e.g. `/employees/export`. */
  path: string;
  /** The filters currently applied to the table this exports. */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Button label; defaults to "Export CSV". */
  label?: string;
  className?: string;
  /** Disabled while the table has nothing to export. */
  disabled?: boolean;
}

const ExportCsvLink: React.FC<ExportCsvLinkProps> = ({
  path,
  params = {},
  label = 'Export CSV',
  className = 'btn btn-outline-secondary btn-sm',
  disabled = false,
}) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  const href = `${API_BASE_URL}${path}${qs ? `?${qs}` : ''}`;

  if (disabled) {
    // A disabled anchor is still clickable, so the disabled state is a button.
    return (
      <button type="button" className={className} disabled>
        <i className="bi bi-download me-1" aria-hidden="true"></i>
        {label}
      </button>
    );
  }

  return (
    <a className={className} href={href} download>
      <i className="bi bi-download me-1" aria-hidden="true"></i>
      {label}
    </a>
  );
};

export default ExportCsvLink;
