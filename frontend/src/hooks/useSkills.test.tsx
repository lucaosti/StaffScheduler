import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSkillsQuery, useSkillMutations } from './useSkills';
import { createSkill, deleteSkill, getSkills, updateSkill } from '../services/skillService';

jest.mock('../services/skillService', () => ({
  __esModule: true,
  createSkill: jest.fn(),
  deleteSkill: jest.fn(),
  getSkills: jest.fn(),
  updateSkill: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useSkillsQuery', () => {
  it('passes filters through and defaults to an empty list', async () => {
    (getSkills as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useSkillsQuery({ isActive: true } as never), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSkills).toHaveBeenCalledWith({ isActive: true });
    expect(result.current.data).toEqual([]);
  });
});

describe('useSkillMutations', () => {
  beforeEach(() => {
    (createSkill as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateSkill as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deleteSkill as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('every mutation invalidates the whole catalogue key, never a single row', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSkillMutations(), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ name: 'First Aid' });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    result.current.update.mutate({ id: 1, isActive: false });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateSkill).toHaveBeenCalledWith(1, { isActive: false });

    result.current.remove.mutate(1);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['skills']))).toBe(true);
    expect(spy.mock.calls.length).toBe(3);
  });
});
