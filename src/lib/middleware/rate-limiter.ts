import { RateLimitError } from "./error-handler";

const _concurrentLimit = parseInt(process.env.RATE_LIMIT_MAX_CONCURRENT || "3");
const _maxRequestsPerWindow = parseInt(process.env.RATE_LIMIT_MAX_PER_WINDOW || "10");
const _windowDuration = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "1000");

let _activeCount = 0;
let _windowRequests = 0;
let _windowStart = Date.now();

// Promise-based waiting queue for concurrency
const _waitingQueue: Array<() => void> = [];

function notifyNext() {
  if (_waitingQueue.length > 0 && _activeCount < _concurrentLimit) {
    const next = _waitingQueue.shift();
    if (next) next();
  }
}

export function resetForTest() {
  _activeCount = 0;
  _windowRequests = 0;
  _windowStart = Date.now();
  _waitingQueue.length = 0;
}

export async function acquireSlot(): Promise<void> {
  const now = Date.now();

  if (now - _windowStart >= _windowDuration) {
    _windowStart = now;
    _windowRequests = 0;
  }

  if (_windowRequests >= _maxRequestsPerWindow) {
    const waitTime = _windowDuration - (now - _windowStart);
    throw new RateLimitError("请求频率过快，请稍后重试", Math.max(waitTime, 1000));
  }

  if (_activeCount >= _concurrentLimit) {
    // Queue the request instead of immediately rejecting
    await new Promise<void>((resolve) => {
      _waitingQueue.push(resolve);
    });
    // After waking up, check window again
    const now2 = Date.now();
    if (now2 - _windowStart >= _windowDuration) {
      _windowStart = now2;
      _windowRequests = 0;
    }
  }

  _activeCount++;
  _windowRequests++;
}

export function releaseSlot(): void {
  _activeCount = Math.max(0, _activeCount - 1);
  notifyNext();
}

export function getStats() {
  return {
    activeCount: _activeCount,
    windowRequests: _windowRequests,
    windowStart: _windowStart,
    concurrentLimit: _concurrentLimit,
    maxPerWindow: _maxRequestsPerWindow,
    waitingCount: _waitingQueue.length,
  };
}
