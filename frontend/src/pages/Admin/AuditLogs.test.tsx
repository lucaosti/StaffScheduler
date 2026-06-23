/**
 * Tests for AuditLogs page.
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditLogs from './AuditLogs';

jest.mock('../../services/auditLogService', () => ({
  listAuditLogs: jest.fn(),
  buildExportUrl: jest.fn((_, fmt) => `/api/audit-logs/export?format=${fmt}`),
}));

// Keep a typed reference to the mocked module functions.
// jest.requireMock is safe here: the mock is registered above and the module
// is NOT imported at the top of this file, so there is no TDZ issue.
const { listAuditLogs: mockListAuditLogs } =
  jest.requireMock('../../services/auditLogService') as {
    listAuditLogs: jest.Mock;
    buildExportUrl: jest.Mock;
  };

const ENTRY_1 = {
  id: 1,
  userId: 5,
  onBehalfOfUserId: null,
  action: 'module.toggle',
  entityType: 'module',
  entityId: null,
  description: 'Module scheduling enabled',
  justification: 'Needed for Q4',
  beforeSnapshot: { isEnabled: false },
  afterSnapshot: { isEnabled: true },
  ipAddress: '127.0.0.1',
  userAgent: 'Mozilla/5.0',
  requestId: 'req-abc-123',
  createdAt: '2024-01-15T10:30:00.000Z',
};

const ENTRY_2 = {
  id: 2,
  userId: 3,
  onBehalfOfUserId: 7,
  action: 'role.assign',
  entityType: 'user',
  entityId: 7,
  description: 'Role Viewer assigned to user 7',
  justification: null,
  beforeSnapshot: null,
  afterSnapshot: null,
  ipAddress: null,
  userAgent: null,
  requestId: null,
  createdAt: '2024-01-16T09:00:00.000Z',
};

const makePageResponse = (items = [ENTRY_1, ENTRY_2], total = 2) => ({
  success: true,
  data: items,
  meta: { total, page: 1, pageSize: 50, pages: 1 },
});

beforeEach(() => {
  mockListAuditLogs.mockResolvedValue(makePageResponse());
});

afterEach(() => jest.clearAllMocks());

describe('<AuditLogs />', () => {
  it('renders the page heading', async () => {
    render(<AuditLogs />);
    expect(screen.getByRole('heading', { name: /audit log/i })).toBeInTheDocument();
  });

  it('renders entries after loading', async () => {
    render(<AuditLogs />);
    expect(await screen.findByText('module.toggle')).toBeInTheDocument();
    expect(screen.getByText('role.assign')).toBeInTheDocument();
  });

  it('shows the total entry count', async () => {
    render(<AuditLogs />);
    expect(await screen.findByText(/2 entries/i)).toBeInTheDocument();
  });

  it('renders Export CSV and Export JSON buttons', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');
    // The export anchors are always rendered; check they are present by text
    expect(screen.getByText(/export csv/i)).toBeInTheDocument();
    expect(screen.getByText(/export json/i)).toBeInTheDocument();
  });

  it('calls listAuditLogs on mount', () => {
    render(<AuditLogs />);
    expect(mockListAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 50 })
    );
  });

  it('applies filters and re-fetches when Apply is clicked', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    await userEvent.type(screen.getByLabelText(/^action$/i), 'module.toggle');
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'module.toggle' })
      )
    );
  });

  it('resets filters and re-fetches when Reset is clicked', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    await userEvent.type(screen.getByLabelText(/^action$/i), 'module.toggle');
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }));

    const input = screen.getByLabelText(/^action$/i) as HTMLInputElement;
    expect(input.value).toBe('');
    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ action: undefined })
      )
    );
  });

  it('expands a row to show detail when the expand button is clicked', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    const expandBtn = screen.getByRole('button', { name: /expand entry 1/i });
    await userEvent.click(expandBtn);

    expect(screen.getByText(/needed for q4/i)).toBeInTheDocument();
    expect(screen.getByText('req-abc-123')).toBeInTheDocument();
    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('collapses a row when the expand button is clicked a second time', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    const expandBtn = screen.getByRole('button', { name: /expand entry 1/i });
    await userEvent.click(expandBtn);
    expect(screen.getByText(/needed for q4/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse entry 1/i }));
    expect(screen.queryByText(/needed for q4/i)).not.toBeInTheDocument();
  });

  it('shows onBehalfOfUserId in the detail panel when present', async () => {
    render(<AuditLogs />);
    await screen.findByText('role.assign');

    await userEvent.click(screen.getByRole('button', { name: /expand entry 2/i }));
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows "No audit entries" when the list is empty', async () => {
    mockListAuditLogs.mockResolvedValue(makePageResponse([], 0));
    render(<AuditLogs />);
    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
  });

  it('shows an error alert when the API fails', async () => {
    mockListAuditLogs.mockRejectedValue(new Error('Forbidden'));
    render(<AuditLogs />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/forbidden/i)).toBeInTheDocument();
  });

  it('shows pagination controls when there are multiple pages', async () => {
    mockListAuditLogs.mockResolvedValue({
      success: true,
      data: [ENTRY_1],
      meta: { total: 120, page: 1, pageSize: 50, pages: 3 },
    });
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
  });

  it('fetches the next page when Next is clicked', async () => {
    mockListAuditLogs.mockResolvedValue({
      success: true,
      data: [ENTRY_1],
      meta: { total: 120, page: 1, pageSize: 50, pages: 3 },
    });
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() =>
      expect(mockListAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
  });

  it('shows entity type and ID in the table', async () => {
    render(<AuditLogs />);
    await screen.findByText('module.toggle');

    // Entry 1: entityType=module, entityId=null → shows "module"
    expect(screen.getByText('module')).toBeInTheDocument();
    // Entry 2: entityType=user, entityId=7 → shows "user #7"
    expect(screen.getByText('user #7')).toBeInTheDocument();
  });
});
