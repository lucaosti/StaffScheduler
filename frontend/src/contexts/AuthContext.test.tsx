/**
 * AuthContext unit tests covering:
 *   - useAuth must throw outside provider
 *   - bootstrap with no token marks loading=false / unauth
 *   - bootstrap with token + verify success → authenticated
 *   - bootstrap with token + verify failure → token cleared
 *   - login success / failure
 *   - refresh success / failure
 *   - logout clears the token
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
  localStorage.clear();
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
  it('finishes loading=false when no token', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('authenticates when verify succeeds', async () => {
    localStorage.setItem('token', 't');
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
  });

  it('clears token when verify fails', async () => {
    localStorage.setItem('token', 't');
    mockedAuthService.verifyToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears token when verify rejects', async () => {
    localStorage.setItem('token', 't');
    mockedAuthService.verifyToken.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('AuthProvider actions', () => {
  it('login success persists token + sets user', async () => {
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
    expect(localStorage.getItem('token')).toBe('t');
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('login failure dispatches LOGIN_FAILURE', async () => {
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

  it('logout removes token + sets unauthenticated', async () => {
    localStorage.setItem('token', 't');
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    act(() => result.current.logout());
    expect(localStorage.getItem('token')).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refreshToken without a stored token logs out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refreshToken happy path swaps the token', async () => {
    localStorage.setItem('token', 'old');
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
    expect(localStorage.getItem('token')).toBe('new');
  });

  it('refreshToken failure logs out', async () => {
    localStorage.setItem('token', 'old');
    mockedAuthService.verifyToken.mockResolvedValue({
      success: true,
      data: { id: 1, email: 'a@x', firstName: 'A', lastName: 'B', role: 'admin' } as never,
    });
    mockedAuthService.refreshToken.mockResolvedValue({ success: false } as never);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await act(async () => {
      await result.current.refreshToken();
    });
    expect(result.current.isAuthenticated).toBe(false);
  });
});
