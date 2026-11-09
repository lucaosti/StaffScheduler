/**
 * Reads the Express router tree the way a request travels it.
 *
 * The authorization matrix suite needs the middleware chain of every mounted
 * operation — to read the `requiredPermission` and `accessRule` tags off it —
 * and Express 5 keeps no record of the prefix a router was mounted under. So
 * instead of reconstructing paths, this follows a concrete request path
 * through the layers with each layer's own matcher, exactly as dispatch does,
 * collecting the middleware it passes on the way to the route that answers.
 *
 * @author Luca Ostinelli
 */

import type { Express } from 'express';

interface Layer {
  match(path: string): boolean;
  path: string;
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

export type Handler = Layer['handle'] & { requiredPermission?: string; accessRule?: unknown };

export interface ResolvedRoute {
  route: object;
  /** Every handler a request runs through, router-level middleware included. */
  chain: Handler[];
}

const rootStack = (app: Express): Layer[] => (app as unknown as { router: { stack: Layer[] } }).router.stack;

const walk = (stack: Layer[], method: string, path: string, chain: Handler[]): ResolvedRoute | null => {
  for (const layer of stack) {
    if (!layer.match(path)) continue;
    if (layer.route) {
      if (!layer.route.methods[method]) continue;
      return { route: layer.route, chain: [...chain, ...layer.route.stack.map((l) => l.handle)] };
    }
    if (layer.handle.stack) {
      const found = walk(layer.handle.stack, method, path.slice(layer.path.length) || '/', chain);
      if (found) return found;
      continue;
    }
    chain = [...chain, layer.handle];
  }
  return null;
};

/** The route answering `method path`, with the chain leading to it, or null. */
export const resolveRoute = (app: Express, method: string, path: string): ResolvedRoute | null =>
  walk(rootStack(app), method.toLowerCase(), path, []);

/** Every route object mounted anywhere in the app. */
export const allRoutes = (app: Express): Array<{ path: string; methods: string[]; route: object }> => {
  const out: Array<{ path: string; methods: string[]; route: object }> = [];
  const visit = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) out.push({ path: layer.route.path, methods: Object.keys(layer.route.methods), route: layer.route });
      else if (layer.handle.stack) visit(layer.handle.stack);
    }
  };
  visit(rootStack(app));
  return out;
};
