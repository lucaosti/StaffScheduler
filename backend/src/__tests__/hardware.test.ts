/**
 * Hardware-aware default tests.
 *
 * Pins the two things that matter about these functions: they derive from
 * `os.availableParallelism()` (not `os.cpus().length`, which misreports
 * inside a cgroup-limited container — see hardware.ts's own header for why),
 * and every default stays within its documented floor/ceiling regardless of
 * how small or large the detected parallelism is.
 */

const mockAvailableParallelism = jest.fn();

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  availableParallelism: () => mockAvailableParallelism(),
}));

import {
  detectedParallelism,
  defaultDbPoolLimit,
  defaultDbQueueLimit,
  defaultSimulationConcurrency,
} from '../config/hardware';

describe('detectedParallelism', () => {
  it('returns what os.availableParallelism() reports', () => {
    mockAvailableParallelism.mockReturnValue(16);
    expect(detectedParallelism()).toBe(16);
  });

  it('floors at 1 rather than propagating a zero/negative reading', () => {
    mockAvailableParallelism.mockReturnValue(0);
    expect(detectedParallelism()).toBe(1);
  });
});

describe('defaultDbPoolLimit', () => {
  it('is 4x the detected cores within the [5, 60] band', () => {
    mockAvailableParallelism.mockReturnValue(8);
    expect(defaultDbPoolLimit()).toBe(32);
  });

  it('floors at 5 for a single-core box (e.g. a small Pi)', () => {
    mockAvailableParallelism.mockReturnValue(1);
    expect(defaultDbPoolLimit()).toBe(5);
  });

  it('caps at 60 for a very large machine', () => {
    mockAvailableParallelism.mockReturnValue(64);
    expect(defaultDbPoolLimit()).toBe(60);
  });
});

describe('defaultDbQueueLimit', () => {
  it('keeps the same ~3.3x ratio to the pool limit as the fixed defaults it replaces', () => {
    mockAvailableParallelism.mockReturnValue(8);
    // pool=32 (within band) -> queue = round(32 * 100/30)
    expect(defaultDbQueueLimit()).toBe(Math.round(32 * (100 / 30)));
  });
});

describe('defaultSimulationConcurrency', () => {
  it('is 3x the detected cores within the [4, 48] band', () => {
    mockAvailableParallelism.mockReturnValue(8);
    expect(defaultSimulationConcurrency()).toBe(24);
  });

  it('floors at 4 for a single-core box', () => {
    mockAvailableParallelism.mockReturnValue(1);
    expect(defaultSimulationConcurrency()).toBe(4);
  });

  it('caps at 48 for a very large machine', () => {
    mockAvailableParallelism.mockReturnValue(64);
    expect(defaultSimulationConcurrency()).toBe(48);
  });
});
