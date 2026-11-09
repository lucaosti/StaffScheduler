/**
 * The process-level safety net (#825).
 *
 * Node's default for an unhandled rejection is to exit the process. A
 * rejection from a database outage is the common case (a background tick, a
 * fire-and-forget write), and with every replica sharing the dependency the
 * default turned one outage into a fleet-wide crash loop. These pin that the
 * net logs and keeps serving, and that installing it is idempotent.
 *
 * @author Luca Ostinelli
 */

import { installProcessSafetyNet, handleUnhandledRejection } from '../processSafety';
import { logger } from '../config/logger';

describe('handleUnhandledRejection', () => {
  it('logs the reason and does not exit', () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    handleUnhandledRejection(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled promise rejection'),
      expect.objectContaining({ message: 'connect ECONNREFUSED', code: 'ECONNREFUSED' })
    );
    expect(exit).not.toHaveBeenCalled();
    error.mockRestore();
    exit.mockRestore();
  });

  it('describes a non-Error reason too', () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    handleUnhandledRejection('plain reason');
    expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'plain reason' }));
    error.mockRestore();
  });
});

describe('installProcessSafetyNet', () => {
  it('registers one unhandledRejection listener however often it is called', () => {
    const before = process.listenerCount('unhandledRejection');
    installProcessSafetyNet();
    installProcessSafetyNet();
    expect(process.listenerCount('unhandledRejection')).toBe(before + 1);
    process.off('unhandledRejection', handleUnhandledRejection);
  });
});
