const TOKEN_KEY = "access_token";
const API_PREFIX = "/api/v1";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Auth {
  token: string;
  tokenType: "Bearer";
  expiresAt: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** All data goes through the JSON API. The Bearer token is kept in localStorage. */
export class ApiClient {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  async register(input: { name: string; email: string; password: string }): Promise<Auth> {
    return this.saveToken(await this.request<Auth>("POST", "/auth/register", input));
  }

  async login(input: { email: string; password: string }): Promise<Auth> {
    return this.saveToken(await this.request<Auth>("POST", "/auth/login", input));
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>("POST", "/auth/logout");
    } finally {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  me(): Promise<User> {
    return this.request<User>("GET", "/users/me");
  }

  private saveToken(auth: Auth): Auth {
    localStorage.setItem(TOKEN_KEY, auth.token);
    return auth;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = this.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(API_PREFIX + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) {
      return undefined as T;
    }
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
      }
      throw new ApiError(response.status, this.errorMessage(data));
    }
    return data;
  }

  private errorMessage(data: {
    error?: { message?: string; details?: { path: string; message: string }[] };
  }): string {
    const details = data.error?.details;
    if (details && details.length > 0) {
      const lines = [];
      for (const detail of details) {
        lines.push(`${detail.path}: ${detail.message}`);
      }
      return lines.join("\n");
    }
    return data.error?.message ?? "Something went wrong.";
  }
}

export const api = new ApiClient();
