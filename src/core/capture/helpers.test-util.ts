import { vi } from "vitest";

export interface XhrPlan {
  status: number;
  body: string;
  fail?: "error" | "abort";
  headers?: string;
}

export class FakeXHR {
  static plan: XhrPlan = { status: 200, body: "" };
  status = 0;
  responseText = "";
  responseType = "";
  private listeners = new Map<string, Array<() => void>>();
  private plan: XhrPlan = FakeXHR.plan;
  listenerCount(ev: string): number {
    return this.listeners.get(ev)?.length ?? 0;
  }
  open(_method: string, _url: string): void {}
  setRequestHeader(_k: string, _v: string): void {}
  getAllResponseHeaders(): string {
    return this.plan.headers ?? "";
  }
  addEventListener(ev: string, fn: () => void): void {
    this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
  }
  private fire(ev: string): void {
    for (const fn of this.listeners.get(ev) ?? []) fn();
  }
  send(_body?: unknown): void {
    this.plan = FakeXHR.plan; // each send uses the plan current at send time (supports instance reuse)
    this.status = 0;
    this.responseText = "";
    queueMicrotask(() => {
      if (this.plan.fail) {
        this.fire(this.plan.fail);
      } else {
        this.status = this.plan.status;
        this.responseText = this.plan.body;
        this.fire("load");
      }
      this.fire("loadend");
    });
  }
}

export function makeWin(fetchImpl?: typeof fetch) {
  const win = {
    console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    fetch: fetchImpl ?? vi.fn(async () => new Response("{}", { status: 200 })),
    XMLHttpRequest: FakeXHR,
    performance,
    innerWidth: 800,
    innerHeight: 600,
    scrollX: 0,
    scrollY: 0,
  };
  return win as unknown as Window & typeof globalThis & typeof win;
}
