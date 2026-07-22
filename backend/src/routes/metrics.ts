/**
 * Prometheus scrape endpoint: GET /metrics.
 *
 * Mounted outside the /api tree (Prometheus scrapes a bare `/metrics`) and
 * deliberately NOT behind the JWT `authenticate` middleware — a scraper is not a
 * user and has no session. Instead it is guarded by a static bearer token: when
 * `METRICS_TOKEN` is configured, a scrape must present `Authorization: Bearer
 * <token>`; the metrics (which include route names and pool internals) are then
 * never exposed unauthenticated. When no token is set the endpoint is open,
 * which is only appropriate for local/dev or a network where `/metrics` is not
 * publicly reachable — the deployment docs call this out.
 *
 * @author Luca Ostinelli
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config';
import { renderMetrics } from '../observability/metrics';

/** Bearer-token guard; a no-op when METRICS_TOKEN is unset (dev/open). */
function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const token = config.metrics.token;
  if (!token) {
    next();
    return;
  }
  const header = req.headers.authorization ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (provided !== token) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid metrics token' },
    });
    return;
  }
  next();
}

export function createMetricsRouter(): Router {
  const router = Router();
  router.get('/', metricsAuth, async (_req: Request, res: Response) => {
    const { contentType, body } = await renderMetrics();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  });
  return router;
}
