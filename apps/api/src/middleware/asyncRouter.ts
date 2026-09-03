import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

/**
 * Make a router forward async rejections instead of hanging.
 *
 * Express 4 does not await route handlers, so a rejected promise inside one is never seen by the
 * error handler and the response is simply never sent. The request hangs until the client gives
 * up — no status, no log line, nothing to search for.
 *
 * That is exactly how a wrong table name in one query turned the Staff page into a permanent
 * spinner: the query threw, `Promise.all` rejected, and the route quietly stopped existing. A 500
 * would have named the problem in seconds.
 *
 * Wrapping the router rather than each handler means routes added later are covered too, which is
 * the only version of this that stays true.
 */
const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'] as const;

function wrap(handler: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = handler(req, res, next) as unknown;
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next);
      }
      return out;
    } catch (error) {
      next(error);
      return undefined;
    }
  };
}

export function forwardAsyncErrors(router: Router): Router {
  for (const verb of VERBS) {
    const original = router[verb].bind(router) as (...args: unknown[]) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any)[verb] = (path: unknown, ...handlers: unknown[]) =>
      original(path, ...handlers.map((h) => (typeof h === 'function' ? wrap(h as RequestHandler) : h)));
  }
  return router;
}
