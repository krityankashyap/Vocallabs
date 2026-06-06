import retry, { AbortError } from "p-retry";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string
  ) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  /** Body is serialised to JSON automatically */
  body?: unknown;
  /** Default: 3 */
  retries?: number;
}

async function request(
  method: "GET" | "POST",
  url: string,
  options: RequestOptions = {}
): Promise<Response> {
  const { headers = {}, body, retries = 3 } = options;

  const fetchHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  return retry(
    async () => {
      const fetchOptions: RequestInit = {
        method,
        headers: fetchHeaders,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      };

      const res = await fetch(url, fetchOptions);

      // 429 / 5xx → retry-able; throw AbortError to stop retrying on other 4xx
      if (!res.ok) {
        const text = await res.text();
        const err = new HttpError(res.status, text, url);
        if (res.status !== 429 && res.status < 500) {
          throw new AbortError(err);
        }
        throw err;
      }

      return res;
    },
    {
      retries,
      factor: 2,
      minTimeout: 500,
      maxTimeout: 10_000,
      onFailedAttempt: (err) => {
        console.warn(
          `  [http] attempt ${err.attemptNumber} failed (${err.message}); ` +
            `${err.retriesLeft} retries left`
        );
      },
    }
  );
}

export async function getJson<T>(
  url: string,
  options?: RequestOptions
): Promise<T> {
  const res = await request("GET", url, options);
  return res.json() as Promise<T>;
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options?: RequestOptions
): Promise<T> {
  const res = await request("POST", url, { ...options, body });
  return res.json() as Promise<T>;
}
