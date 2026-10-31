/**
 * Bounding how long a caller waits for a promise.
 *
 * For checks whose whole point is to answer quickly — the health endpoint
 * above all (#970): a dependency that is connected but frozen never rejects,
 * so a check awaiting it hangs exactly when it is most needed, and a load
 * balancer probing it marks the replica dead for the wrong reason. The
 * underlying operation is not cancelled (a promise cannot be); the caller is
 * merely released, with `fallback`, when the limit passes.
 *
 * @author Luca Ostinelli
 */

/** Resolves with `promise`'s value, or with `fallback` once `ms` have passed; a rejection also yields `fallback`. */
export const settleWithin = async <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise.catch(() => fallback), limit]);
  } finally {
    clearTimeout(timer);
  }
};
