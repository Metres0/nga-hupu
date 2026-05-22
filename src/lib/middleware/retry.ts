import { NetworkError, ServerError } from "./error-handler";

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const baseDelay = options.baseDelay ?? BASE_DELAY;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (err instanceof NetworkError || err instanceof ServerError) {
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.log(`[Retry] 尝试 ${attempt + 1}/${maxRetries}, ${delay}ms 后重试`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      throw err;
    }
  }

  throw lastError;
}
