import { acquireSlot, releaseSlot } from "./rate-limiter";
import { classifyError } from "./error-handler";
import { withRetry } from "./retry";
import { logRequest } from "./logger";

type MiddlewareFn = (req: Request) => Promise<Response>;

export function pipeline(
  handler: (req: Request) => Promise<Response>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const start = Date.now();
    let status = 200;
    let error: string | undefined;

    try {
      await acquireSlot();

      const response = await withRetry(() => handler(req));

      status = response.status;
      return response;
    } catch (err) {
      const classified = classifyError(err);
      status = classified instanceof Error && classified.name === "RateLimitError" ? 429
        : classified instanceof Error && classified.name === "ServerError" ? 502
        : 500;
      error = classified.message;

      return Response.json(
        { error: classified.message, retryAfter: (classified as any).retryAfter || 0 },
        {
          status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        }
      );
    } finally {
      releaseSlot();
      const duration = Date.now() - start;
      logRequest({
        method: req.method,
        url: req.url,
        status,
        duration,
        error,
      });
    }
  };
}
