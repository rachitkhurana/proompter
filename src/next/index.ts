/** Stub. `withProompter` / `createProompterRoute` land in T03 / T09. */
export interface WithProompterOptions {
  enabled?: boolean;
}

export function withProompter<T extends object>(config: T, _options: WithProompterOptions = {}): T {
  return config;
}
