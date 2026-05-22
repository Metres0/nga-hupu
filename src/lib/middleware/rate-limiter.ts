import { RateLimitError } from "./error-handler";

const _concurrentLimit = parseInt(process.env.RATE_LIMIT_MAX_CONCURRENT || "3");
const _maxRequestsPerWindow = parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW || "10");
const _windowDuration = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "1000");

let _activeCount = 0;
let _windowRequests = 0;
let _windowStart = Date.now();

export function resetForTest() {
  _activeCount = 0;
  _windowRequests = 0;
  _windowStart = Date.now();
}

export function acquireSlot(): void {
  const now = Date.now();

  if (now - _windowStart >= _windowDuration) {
    _windowStart = now;
    _windowRequests = 0;
  }

  if (_activeCount >= _concurrentLimit) {
    throw new RateLimitError("并发请求过多", 1000);
  }

  if (_windowRequests >= _maxRequestsPerWindow) {
    const waitTime = _windowDuration - (now - _windowStart);
    throw new RateLimitError("请求频率过快，请稍后重试", Math.max(waitTime, 1000));
  }

  _activeCount++;
  _windowRequests++;
}

export function releaseSlot(): void {
  _activeCount = Math.max(0, _activeCount - 1);
}

export function getStats() {
  return {
    activeCount: _activeCount,
    windowRequests: _windowRequests,
    windowStart: _windowStart,
    concurrentLimit: _concurrentLimit,
    maxPerWindow: _maxRequestsPerWindow,
  };
}
