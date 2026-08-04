/**
 * Tests for GeofenceSection (Settings → Geofences admin tab, #308).
 *
 * @author Luca Ostinelli
 */

import { render, screen, waitFor, within } from '../../test-utils/renderWithClient';
import userEvent from '@testing-library/user-event';
import GeofenceSection from './GeofenceSection';

const okResponse = <T,>(data: T) => Promise.resolve({ success: true as const, data });

const getDepartments = jest.fn();
jest.mock('../../services/departmentService', () => ({
  __esModule: true,
  getDepartments: (...a: unknown[]) => getDepartments(...a),
  getGeofences: (...a: unknown[]) => getGeofences(...a),
  createGeofence: (...a: unknown[]) => createGeofence(...a),
  updateGeofence: (...a: unknown[]) => updateGeofence(...a),
  deleteGeofence: (...a: unknown[]) => deleteGeofence(...a),
}));

const getGeofences = jest.fn();
const createGeofence = jest.fn();
const updateGeofence = jest.fn();
const deleteGeofence = jest.fn();

const fence = (over: Record<string, unknown> = {}) => ({
  id: 1,
  departmentId: 10,
  name: 'Main office',
  polygon: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }],
  isActive: true,
  createdAt: 'x',
  updatedAt: 'x',
  ...over,
});

/** Waits for the department options to actually load before selecting one. */
const selectDepartment = async () => {
  await screen.findByRole('option', { name: 'Emergency Medicine' });
  await userEvent.selectOptions(screen.getByLabelText(/department/i), '10');
};

beforeEach(() => {
  jest.clearAllMocks();
  getDepartments.mockResolvedValue(okResponse([{ id: 10, name: 'Emergency Medicine' }]));
  getGeofences.mockResolvedValue(okResponse([]));
  createGeofence.mockResolvedValue(okResponse(fence()));
  updateGeofence.mockResolvedValue(okResponse(fence({ name: 'Renamed' })));
  deleteGeofence.mockResolvedValue(okResponse(undefined));
});

describe('<GeofenceSection />', () => {
  it('shows a department picker with no geofences visible until one is selected', async () => {
    render(<GeofenceSection />);
    expect(await screen.findByLabelText(/department/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new geofence/i })).not.toBeInTheDocument();
  });

  it('lists geofences for the selected department', async () => {
    getGeofences.mockResolvedValue(okResponse([fence()]));
    render(<GeofenceSection />);

    await selectDepartment();

    expect(await screen.findByText('Main office')).toBeInTheDocument();
    expect(getGeofences).toHaveBeenCalledWith(10);
  });

  it('shows the empty state when a department has no geofences', async () => {
    render(<GeofenceSection />);
    await selectDepartment();

    expect(await screen.findByText(/no geofences configured/i)).toBeInTheDocument();
  });

  it('creates a geofence with at least 3 points', async () => {
    render(<GeofenceSection />);
    await selectDepartment();
    await userEvent.click(await screen.findByRole('button', { name: /new geofence/i }));

    await userEvent.type(screen.getByLabelText(/^name$/i), 'North gate');
    const latInputs = screen.getAllByPlaceholderText(/latitude/i);
    const lngInputs = screen.getAllByPlaceholderText(/longitude/i);
    await userEvent.type(latInputs[0], '0');
    await userEvent.type(lngInputs[0], '0');
    await userEvent.type(latInputs[1], '0');
    await userEvent.type(lngInputs[1], '1');
    await userEvent.type(latInputs[2], '1');
    await userEvent.type(lngInputs[2], '1');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(createGeofence).toHaveBeenCalledWith(10, {
        name: 'North gate',
        polygon: [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }],
        isActive: true,
      })
    );
  });

  it('rejects a save with fewer than 3 valid points', async () => {
    render(<GeofenceSection />);
    await selectDepartment();
    await userEvent.click(await screen.findByRole('button', { name: /new geofence/i }));

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Too small');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/at least 3 valid coordinate points/i)).toBeInTheDocument();
    expect(createGeofence).not.toHaveBeenCalled();
  });

  it('edits an existing geofence, pre-filling its current points', async () => {
    getGeofences.mockResolvedValue(okResponse([fence()]));
    render(<GeofenceSection />);
    await selectDepartment();
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Main office');
    const latInputs = screen.getAllByPlaceholderText(/latitude/i);
    expect(latInputs[0]).toHaveValue('0');

    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(updateGeofence).toHaveBeenCalledWith(10, 1, expect.objectContaining({ name: 'Main office' })));
  });

  it('deletes a geofence after confirmation', async () => {
    getGeofences.mockResolvedValue(okResponse([fence()]));
    render(<GeofenceSection />);
    await selectDepartment();
    await userEvent.click(await screen.findByRole('button', { name: /delete/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(deleteGeofence).toHaveBeenCalledWith(10, 1));
  });
});
