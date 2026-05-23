export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter: number = 5000
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class ServerError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "ServerError";
  }
}

export class ParseError extends Error {
  constructor(
    message: string,
    public raw: string
  ) {
    super(message);
    this.name = "ParseError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export function classifyError(err: unknown): Error {
  if (err instanceof RateLimitError || err instanceof ServerError || err instanceof ParseError || err instanceof NetworkError) {
    return err;
  }

  const msg = String(err);
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("频繁")) {
    return new RateLimitError(msg);
  }
  if (msg.includes("502") || msg.includes("503") || msg.includes("504")) {
    return new ServerError(msg, 502);
  }
  if (msg.includes("403")) {
    return new NetworkError("NGA 拒绝访问 (403)");
  }

  return new Error(msg);
}
