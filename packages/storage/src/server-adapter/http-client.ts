import {
  BIZ_ERROR_CODES,
  C4AError,
  DATA_ERROR_CODES,
  INPUT_ERROR_CODES,
  PERM_ERROR_CODES,
  SYS_ERROR_CODES,
  type ErrorCode,
  type ErrorResponse,
} from '@c4a/core';

export type HttpMethod = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';

export interface HttpLogEntry {
  method: HttpMethod;
  url: string;
  status?: number;
  attempt: number;
  duration_ms: number;
  error?: string;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeout?: number;
  retries?: number;
  retryDelayMs?: number;
  maxConnections?: number;
  headers?: Record<string, string>;
  logger?: (entry: HttpLogEntry) => void;
  requestInterceptors?: RequestInterceptor[];
  responseInterceptors?: ResponseInterceptor[];
  fetchFn?: typeof fetch;
}

export interface HttpRequestOptions {
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  allowNotFound?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  url: string;
  method: HttpMethod;
}

export type RequestInterceptor = (
  config: HttpRequestConfig
) => HttpRequestConfig | Promise<HttpRequestConfig>;

export type ResponseInterceptor = (
  response: HttpResponse<unknown>
) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>;

export interface HttpRequestConfig extends HttpRequestOptions {
  method: HttpMethod;
  path: string;
}

class RequestPool {
  private maxConnections: number;
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(maxConnections: number) {
    this.maxConnections = Math.max(1, maxConnections);
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.maxConnections) {
      this.active += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private retries: number;
  private retryDelayMs: number;
  private defaultHeaders: Record<string, string>;
  private logger?: (entry: HttpLogEntry) => void;
  private pool: RequestPool;
  private requestInterceptors: RequestInterceptor[];
  private responseInterceptors: ResponseInterceptor[];
  private fetchFn: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.timeout = options.timeout ?? 30_000;
    this.retries = options.retries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 300;
    this.defaultHeaders = options.headers ?? {};
    this.logger = options.logger;
    this.pool = new RequestPool(options.maxConnections ?? 8);
    this.requestInterceptors = options.requestInterceptors ?? [];
    this.responseInterceptors = options.responseInterceptors ?? [];
    this.fetchFn = options.fetchFn ?? fetch;
  }

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  async get<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>({ method: 'GET', path, ...options });
  }

  async post<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>({ method: 'POST', path, ...options });
  }

  async delete<T>(path: string, options?: HttpRequestOptions): Promise<T> {
    return this.request<T>({ method: 'DELETE', path, ...options });
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') {
          url.searchParams.set(key, JSON.stringify(value));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(config: HttpRequestConfig): Promise<T> {
    let nextConfig = { ...config };
    for (const interceptor of this.requestInterceptors) {
      nextConfig = await interceptor(nextConfig);
    }

    const attempts = Math.max(1, this.retries + 1);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const release = await this.pool.acquire();
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      try {
        const url = this.buildUrl(nextConfig.path, nextConfig.query);
        const headers: Record<string, string> = {
          ...this.defaultHeaders,
          ...(nextConfig.headers ?? {}),
        };
        const hasBody =
          this.shouldSendBody(nextConfig.method) && nextConfig.body !== undefined;
        if (hasBody && !('content-type' in headers)) {
          headers['content-type'] = 'application/json';
        }
        const response = await this.fetchFn(url, {
          method: nextConfig.method,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          body: hasBody ? JSON.stringify(nextConfig.body) : undefined,
          signal: nextConfig.signal ?? controller.signal,
        });

        const duration = Date.now() - startedAt;
        this.logger?.({
          method: nextConfig.method,
          url,
          status: response.status,
          attempt,
          duration_ms: duration,
        });

        if (response.status === 404 && nextConfig.allowNotFound) {
          return null as T;
        }

        if (!response.ok) {
          const error = await this.buildHttpError(response);
          if (this.shouldRetry(response.status, error) && attempt < attempts) {
            lastError = error;
            await this.delay(attempt);
            continue;
          }
          throw error;
        }

        const parsed = await this.parseResponse<T>(response);
        let enriched: HttpResponse<unknown> = {
          data: parsed,
          status: response.status,
          headers: response.headers,
          url,
          method: nextConfig.method,
        };
        for (const interceptor of this.responseInterceptors) {
          enriched = await interceptor(enriched);
        }
        return enriched.data as T;
      } catch (error) {
        const normalized = this.normalizeError(error);
        const duration = Date.now() - startedAt;
        this.logger?.({
          method: nextConfig.method,
          url: this.buildUrl(nextConfig.path, nextConfig.query),
          attempt,
          duration_ms: duration,
          error: normalized.message,
        });
        if (this.shouldRetry(undefined, normalized) && attempt < attempts) {
          lastError = normalized;
          await this.delay(attempt);
          continue;
        }
        throw normalized;
      } finally {
        clearTimeout(timeoutId);
        release();
      }
    }

    throw lastError ?? new C4AError(SYS_ERROR_CODES.INTERNAL_ERROR);
  }

  private shouldSendBody(method: HttpMethod): boolean {
    return method === 'POST' || method === 'PUT' || method === 'PATCH';
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    const text = await response.text();
    if (!text) {
      return null as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private async buildHttpError(response: Response): Promise<Error> {
    const contentType = response.headers.get('content-type') || '';
    let payload: unknown = null;
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    } else {
      payload = await response.text();
    }

    const resolved = this.unwrapErrorResponse(payload);
    if (resolved) {
      const details = resolved.details ?? {};
      if (resolved.recoverable_actions) {
        details.recoverable_actions = resolved.recoverable_actions;
      }
      return new C4AError(resolved.code, details, resolved.message);
    }

    const code = mapHttpStatusToErrorCode(response.status);
    const message = typeof payload === 'string' && payload.length > 0
      ? payload
      : response.statusText || `HTTP ${response.status}`;
    return new C4AError(code, { http_status: response.status }, message);
  }

  private isErrorResponse(payload: unknown): payload is ErrorResponse {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as ErrorResponse;
    return typeof value.code === 'string' && typeof value.message === 'string';
  }

  private unwrapErrorResponse(payload: unknown): ErrorResponse | null {
    if (this.isErrorResponse(payload)) {
      return payload;
    }
    if (!payload || typeof payload !== 'object') return null;
    const value = payload as { detail?: unknown };
    if (value.detail && this.isErrorResponse(value.detail)) {
      return value.detail;
    }
    return null;
  }

  private shouldRetry(status?: number, error?: Error): boolean {
    if (status) {
      return status === 408 || status === 429 || status >= 500;
    }
    if (!error) return false;
    if (error instanceof C4AError) {
      return (
        error.code === SYS_ERROR_CODES.MCP_TIMEOUT ||
        error.code === SYS_ERROR_CODES.REMOTE_SERVICE_UNAVAILABLE
      );
    }
    return true;
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof C4AError) {
      return error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return new C4AError(SYS_ERROR_CODES.MCP_TIMEOUT, { reason: 'timeout' }, 'Request timeout');
    }
    const message = error instanceof Error ? error.message : String(error);
    return new C4AError(SYS_ERROR_CODES.REMOTE_SERVICE_UNAVAILABLE, { reason: message }, message);
  }

  private async delay(attempt: number): Promise<void> {
    const backoff = Math.min(3000, this.retryDelayMs * attempt);
    if (backoff <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
}

function mapHttpStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return INPUT_ERROR_CODES.INVALID_FIELD_FORMAT;
    case 401:
      return PERM_ERROR_CODES.AUTHENTICATION_FAILED;
    case 403:
      return PERM_ERROR_CODES.NO_READ_PERMISSION;
    case 404:
      return DATA_ERROR_CODES.ENTITY_NOT_FOUND;
    case 409:
      return DATA_ERROR_CODES.VERSION_CONFLICT;
    case 422:
      return BIZ_ERROR_CODES.CONSISTENCY_CHECK_FAILED;
    case 429:
      return SYS_ERROR_CODES.REMOTE_SERVICE_UNAVAILABLE;
    case 500:
      return SYS_ERROR_CODES.INTERNAL_ERROR;
    case 502:
    case 503:
    case 504:
      return SYS_ERROR_CODES.REMOTE_SERVICE_UNAVAILABLE;
    default:
      return SYS_ERROR_CODES.INTERNAL_ERROR;
  }
}
