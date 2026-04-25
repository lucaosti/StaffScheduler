/**
 * Unit tests for the notify helpers.
 */

import { ApiError } from '../services/apiUtils';
import { errorMessage, notifyError, notifySuccess } from './notify';

describe('errorMessage', () => {
  it('returns the message of an ApiError', () => {
    const err = new ApiError('boom', 500);
    expect(errorMessage(err)).toBe('boom');
  });

  it('returns the message of a plain Error', () => {
    expect(errorMessage(new Error('nope'))).toBe('nope');
  });

  it('returns a string thrown directly', () => {
    expect(errorMessage('thrown string')).toBe('thrown string');
  });

  it('falls back to the provided default for unknown shapes', () => {
    expect(errorMessage({ weird: true }, 'fallback')).toBe('fallback');
  });
});

describe('notifyError / notifySuccess', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('shows the context alone when no error is provided', () => {
    notifyError('Failed to load schedules');
    expect(alertSpy).toHaveBeenCalledWith('Failed to load schedules');
  });

  it('appends the error message to the context', () => {
    notifyError('Failed to save', new Error('network down'));
    expect(alertSpy).toHaveBeenCalledWith('Failed to save: network down');
  });

  it('forwards the success message verbatim', () => {
    notifySuccess('Saved!');
    expect(alertSpy).toHaveBeenCalledWith('Saved!');
  });
});
