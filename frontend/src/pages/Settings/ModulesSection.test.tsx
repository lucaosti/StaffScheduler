/**
 * Tests for ModulesSection (Settings → Modules tab, admin only).
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModulesSection from './ModulesSection';

const mockListModules = jest.fn();
const mockListModulesForOrg = jest.fn();
const mockSetModuleEnabled = jest.fn();
const mockSetModuleOrgOverride = jest.fn();
const mockRemoveModuleOrgOverride = jest.fn();

jest.mock('../../services/moduleService', () => ({
  listModules: () => mockListModules(),
  listModulesForOrg: (org: string) => mockListModulesForOrg(org),
  setModuleEnabled: (code: string, isEnabled: boolean, justification?: string) =>
    mockSetModuleEnabled(code, isEnabled, justification),
  setModuleOrgOverride: (code: string, org: string, isEnabled: boolean, justification?: string) =>
    mockSetModuleOrgOverride(code, org, isEnabled, justification),
  removeModuleOrgOverride: (code: string, org: string) => mockRemoveModuleOrgOverride(code, org),
}));

const mockUseAuth = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const MODULES = [
  { id: 1, code: 'scheduling', name: 'Scheduling', description: 'Core scheduling', isEnabled: true, updatedAt: '2024-01-01' },
  { id: 2, code: 'audit', name: 'Audit', description: 'Audit logging', isEnabled: false, updatedAt: '2024-01-01' },
];

const ORG_MODULES = [
  {
    id: 1, code: 'scheduling', name: 'Scheduling', description: null, isEnabled: true, updatedAt: '2024-01-01',
    effectiveEnabled: false, orgOverride: false,
  },
  {
    id: 2, code: 'audit', name: 'Audit', description: null, isEnabled: false, updatedAt: '2024-01-01',
    effectiveEnabled: false, orgOverride: null,
  },
];

beforeEach(() => {
  mockUseAuth.mockReturnValue({ user: { id: 1, organizationName: 'Test Org' } });
  mockListModules.mockResolvedValue({ success: true, data: MODULES });
  mockListModulesForOrg.mockResolvedValue({ success: true, data: ORG_MODULES });
  mockSetModuleEnabled.mockResolvedValue({ success: true, data: { ...MODULES[1], isEnabled: true } });
  mockSetModuleOrgOverride.mockResolvedValue({ success: true, data: {} });
  mockRemoveModuleOrgOverride.mockResolvedValue({ success: true });
});

afterEach(() => jest.clearAllMocks());

describe('<ModulesSection />', () => {
  it('shows a loading spinner initially', () => {
    render(<ModulesSection />);
    expect(screen.getByRole('status', { hidden: true })).toBeInTheDocument();
  });

  it('renders the global module list after loading', async () => {
    render(<ModulesSection />);
    expect(await screen.findByText('Scheduling')).toBeInTheDocument();
    expect(screen.getByText('Audit')).toBeInTheDocument();
    expect(screen.getByText('scheduling')).toBeInTheDocument();
  });

  it('shows correct enabled/disabled badges', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    const rows = screen.getAllByRole('row');
    // first is header row
    const schedulingRow = rows[1];
    expect(within(schedulingRow).getByText('Enabled')).toBeInTheDocument();
    const auditRow = rows[2];
    expect(within(auditRow).getByText('Disabled')).toBeInTheDocument();
  });

  it('opens the justification modal when Disable is clicked', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    await userEvent.click(screen.getByRole('button', { name: /disable module scheduling/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /disable module/i })).toBeInTheDocument();
  });

  it('calls setModuleEnabled with the correct args when confirmed', async () => {
    render(<ModulesSection />);
    await screen.findByText('Audit');

    await userEvent.click(screen.getByRole('button', { name: /enable module audit/i }));

    const textarea = screen.getByLabelText(/justification/i);
    await userEvent.type(textarea, 'Needed for compliance');

    await userEvent.click(screen.getByRole('button', { name: /^enable$/i }));

    expect(mockSetModuleEnabled).toHaveBeenCalledWith('audit', true, 'Needed for compliance');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/enabled globally/i)).toBeInTheDocument();
  });

  it('cancels the modal without calling the API', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    await userEvent.click(screen.getByRole('button', { name: /disable module scheduling/i }));
    // Click the text "Cancel" button (not the × close button)
    const cancelBtn = screen.getAllByRole('button', { name: /cancel/i })[0];
    await userEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockSetModuleEnabled).not.toHaveBeenCalled();
  });

  it('shows error when setModuleEnabled fails', async () => {
    mockSetModuleEnabled.mockRejectedValue(new Error('Permission denied'));
    render(<ModulesSection />);
    await screen.findByText('Audit');

    await userEvent.click(screen.getByRole('button', { name: /enable module audit/i }));
    await userEvent.click(screen.getByRole('button', { name: /^enable$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/permission denied/i)).toBeInTheDocument();
  });

  it('shows error when listModules fails', async () => {
    mockListModules.mockRejectedValue(new Error('Network error'));
    render(<ModulesSection />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });

  it('loads org modules when Load button is clicked', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    const orgInput = screen.getByLabelText(/organisation name/i);
    await userEvent.clear(orgInput);
    await userEvent.type(orgInput, 'My Hospital');

    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    await waitFor(() => expect(mockListModulesForOrg).toHaveBeenCalledWith('My Hospital'));
    expect(await screen.findByText('Per-Organisation Overrides')).toBeInTheDocument();
  });

  it('calls setModuleOrgOverride when an org override is set', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    const orgInput = screen.getByLabelText(/organisation name/i);
    await userEvent.clear(orgInput);
    await userEvent.type(orgInput, 'Test Org');
    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    // Wait for org modules to appear
    await screen.findAllByRole('button', { name: /set org override enabled for scheduling/i });

    await userEvent.click(screen.getByRole('button', { name: /set org override enabled for scheduling/i }));
    await userEvent.click(screen.getByRole('button', { name: /^enable$/i }));

    expect(mockSetModuleOrgOverride).toHaveBeenCalledWith('scheduling', 'Test Org', true, undefined);
  });

  it('calls removeModuleOrgOverride when Reset is clicked', async () => {
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    // Preload with the user's org (pre-filled from user context)
    await userEvent.click(screen.getByRole('button', { name: /load/i }));
    // scheduling has orgOverride=false → Reset button should be visible (aria-label: "Reset override for Scheduling")
    const resetBtn = await screen.findByRole('button', { name: /reset override for scheduling/i });
    await userEvent.click(resetBtn);

    expect(mockRemoveModuleOrgOverride).toHaveBeenCalled();
    expect(await screen.findByText(/override.*removed/i)).toBeInTheDocument();
  });

  it('shows org error when listModulesForOrg fails', async () => {
    mockListModulesForOrg.mockRejectedValue(new Error('Org not found'));
    render(<ModulesSection />);
    await screen.findByText('Scheduling');

    await userEvent.click(screen.getByRole('button', { name: /^load$/i }));

    expect(await screen.findByText(/org not found/i)).toBeInTheDocument();
  });

  it('pre-fills org name from user context', async () => {
    render(<ModulesSection />);
    const orgInput = (await screen.findByLabelText(/organisation name/i)) as HTMLInputElement;
    expect(orgInput.value).toBe('Test Org');
  });
});
