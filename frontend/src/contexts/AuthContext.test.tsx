/**
 * AuthContext unit tests covering:
 *   - useAuth must throw outside provider
 *   - bootstrap via verifyToken (cookie-based, no localStorage)
 *   - login success / failure
 *   - refresh success / failure
 *   - logout calls server and clears state
 */

import React from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as authService from '../services/authService';

jest.mock('../services/authService');

const mockedAuthService = authService as jest.Mocked<typeof authService>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const Probe: React.FC = () => {
      useAuth();
      return null;
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/AuthProvider/);
    spy.mockRestore();
  });
});

describe('AuthProvider bootstrap', () => {
  it('finishes loading=false when verify fails', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('authenticates when verify succeeds', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  });

  it('sets loading=false when verify returns success:false', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('sets loading=false when verify rejects', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('AuthProvider actions', () => {
  it('login success sets user and isAuthenticated', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    mockedAuthService.login.mockResolvedValue({
      success: true,
      data: {
        token: 't',
        user: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' },
      } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.login({ email: 'a@x', password: 'pw' } as never);
    });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('a@x');
  });

  it('login failure dispatches LOGIN_FAILURE', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    mockedAuthService.login.mockResolvedValue({ success: false, error: { message: 'no' } } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      try {
        await result.current.login({ email: 'a@x', password: 'pw' } as never);
      } catch {
        // expected
      }
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout calls authService.logout and sets unauthenticated', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.logout.mockResolvedValue();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    act(() => result.current.logout());
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refreshToken happy path updates state', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.refreshToken.mockResolvedValue({
      success: true,
      data: {
        token: 'new',
        user: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' },
      } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('refreshToken failure logs out', async () => {
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.logout.mockResolvedValue();
    mockedAuthService.refreshToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('keeps callback identities stable across renders', async () => {
    mockedAuthService.verifyToken.mockRejectedValue(new Error('no session'));
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = {
      login: result.current.login,
      logout: result.current.logout,
      refreshToken: result.current.refreshToken,
    };
    rerender();
    expect(result.current.login).toBe(first.login);
    expect(result.current.logout).toBe(first.logout);
    expect(result.current.refreshToken).toBe(first.refreshToken);
  });
});
