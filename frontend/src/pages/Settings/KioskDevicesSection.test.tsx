/**
 * Tests for KioskDevicesSection (Settings → Kiosk Devices admin tab, #309).
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, within } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import KioskDevicesSection from './KioskDevicesSection';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const getDepartments = jest.fn();
jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...a: unknown[]) => getDepartments(...a),
  getKioskDevices: (...a: unknown[]) => getKioskDevices(...a),
  createKioskDevice: (...a: unknown[]) => createKioskDevice(...a),
  deleteKioskDevice: (...a: unknown[]) => deleteKioskDevice(...a),
}));

const getKioskDevices = jest.fn();
const createKioskDevice = jest.fn();
const deleteKioskDevice = jest.fn();

const device = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Break room tablet',
  departmentId: 10,
  isActive: true,
  createdAt: 'x',
  lastUsedAt: null,
  ...over,
});

const selectDepartment = async () => {
  await screen.findByRole('option', { name: 'Emergency Medicine' });
  await userEvent.selectOptions(screen.getByLabelText(/department/i), '10');
};

beforeEach(() => {
  jest.clearAllMocks();
  getDepartments.mockResolvedValue(okResponse([{ id: 10, name: 'Emergency Medicine' }]));
  getKioskDevices.mockResolvedValue(okResponse([]));
  createKioskDevice.mockResolvedValue(okResponse({ ...device(), token: 'raw-token-value' }));
  deleteKioskDevice.mockResolvedValue(okResponse(undefined));
});

describe('<KioskDevicesSection />', () => {
  it('shows a department picker with no devices visible until one is selected', async () => {
    render(<KioskDevicesSection />);
    expect(await screen.findByLabelText(/department/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add device/i })).not.toBeInTheDocument();
  });

  it('lists kiosk devices for the selected department', async () => {
    getKioskDevices.mockResolvedValue(okResponse([device()]));
    render(<KioskDevicesSection />);

    await selectDepartment();

    expect(await screen.findByText('Break room tablet')).toBeInTheDocument();
    expect(getKioskDevices).toHaveBeenCalledWith(10);
  });

  it('shows the empty state when a department has no kiosk devices', async () => {
    render(<KioskDevicesSection />);
    await selectDepartment();

    expect(await screen.findByText(/no kiosk devices/i)).toBeInTheDocument();
  });

  it('creates a device and reveals its raw token exactly once', async () => {
    render(<KioskDevicesSection />);
    await selectDepartment();

    await userEvent.type(screen.getByPlaceholderText(/device name/i), 'Break room tablet');
    await userEvent.click(screen.getByRole('button', { name: /add device/i }));

    await waitFor(() => expect(createKioskDevice).toHaveBeenCalledWith(10, { name: 'Break room tablet' }));
    expect(await screen.findByDisplayValue('raw-token-value')).toBeInTheDocument();
  });

  it('rejects creating a device with an empty name', async () => {
    render(<KioskDevicesSection />);
    await selectDepartment();

    await userEvent.click(screen.getByRole('button', { name: /add device/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(createKioskDevice).not.toHaveBeenCalled();
  });

  it('revokes a device after confirmation', async () => {
    getKioskDevices.mockResolvedValue(okResponse([device()]));
    render(<KioskDevicesSection />);
    await selectDepartment();
    await userEvent.click(await screen.findByRole('button', { name: /revoke/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(deleteKioskDevice).toHaveBeenCalledWith(10, 1));
  });

  it('disables the revoke action for an already-revoked device', async () => {
    getKioskDevices.mockResolvedValue(okResponse([device({ isActive: false })]));
    render(<KioskDevicesSection />);
    await selectDepartment();

    expect(await screen.findByRole('button', { name: /revoke/i })).toBeDisabled();
  });
});
