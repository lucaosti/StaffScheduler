import { renderHook, act } from '@testing-library/react';
import { useIsNarrowViewport } from './useIsNarrowViewport';

describe('useIsNarrowViewport', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reflects an initial match', () => {
    jest.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as MediaQueryList);

    const { result } = renderHook(() => useIsNarrowViewport());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    let onChange: (() => void) | null = null;
    const mql = {
      matches: false,
      media: '',
      addEventListener: jest.fn((_event: string, handler: () => void) => {
        onChange = handler;
      }),
      removeEventListener: jest.fn(),
    };
    jest.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);

    const { result } = renderHook(() => useIsNarrowViewport());
    expect(result.current).toBe(false);

    mql.matches = true;
    act(() => onChange?.());
    expect(result.current).toBe(true);
  });

  it('removes the change listener on unmount', () => {
    const mql = {
      matches: false,
      media: '',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    jest.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);

    const { unmount } = renderHook(() => useIsNarrowViewport());
    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('uses a custom breakpoint in the media query string', () => {
    const matchMediaSpy = jest.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '',
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    } as unknown as MediaQueryList);

    renderHook(() => useIsNarrowViewport(768));

    expect(matchMediaSpy).toHaveBeenCalledWith('(max-width: 768px)');
  });
});
