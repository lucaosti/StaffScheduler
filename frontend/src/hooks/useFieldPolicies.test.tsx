import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFieldPoliciesQuery, useSaveFieldPolicy, useDeleteFieldPolicy } from './useFieldPolicies';
import { deleteFieldPolicy, listFieldPolicies, saveFieldPolicy } from '../services/fieldPolicyService';

jest.mock('../services/fieldPolicyService', () => ({
  __esModule: true,
  deleteFieldPolicy: jest.fn(),
  listFieldPolicies: jest.fn(),
  saveFieldPolicy: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useFieldPoliciesQuery', () => {
  it('passes the organization through, defaulting to undefined for the global row', async () => {
    (listFieldPolicies as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useFieldPoliciesQuery(null), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listFieldPolicies).toHaveBeenCalledWith(undefined);
    expect(result.current.data).toEqual({ policies: [], governableCoreFields: [] });
  });

  it('fetches the named organization row', async () => {
    (listFieldPolicies as jest.Mock).mockResolvedValue({ data: { policies: [], governableCoreFields: ['phone'] } });
    renderHook(() => useFieldPoliciesQuery('acme'), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(listFieldPolicies).toHaveBeenCalledWith('acme'));
  });
});

describe('useSaveFieldPolicy', () => {
  it('invalidates only the same organization key it was constructed for', async () => {
    (saveFieldPolicy as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSaveFieldPolicy('acme'), { wrapper: makeWrapper(client) });

    result.current.mutate({
      fieldKey: 'phone',
      isRequired: false,
      visiblePermission: null,
      editPermission: null,
      minLength: null,
      maxLength: null,
      minValue: null,
      maxValue: null,
      pattern: null,
      allowedValues: null,
      helpText: null,
      organizationName: 'acme',
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['field-policies', 'acme'] });
  });
});

describe('useDeleteFieldPolicy', () => {
  it('passes the organization to the service and invalidates the same key', async () => {
    (deleteFieldPolicy as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteFieldPolicy(null), { wrapper: makeWrapper(client) });

    result.current.mutate('phone');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(deleteFieldPolicy).toHaveBeenCalledWith('phone', null);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['field-policies', null] });
  });
});
