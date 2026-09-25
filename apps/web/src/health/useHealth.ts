import { useEffect, useRef, useState } from "react";

type ReadyResponse = { status: "ready"; checkedAt: string };
type DegradedResponse = {
  status: "degraded";
  checkedAt: string;
  database: "unavailable" | "schema_missing";
};

export type HealthState =
  | { status: "initial" }
  | { status: "checking" }
  | ReadyResponse
  | DegradedResponse
  | { status: "unavailable"; attemptedAt: string };

type ActiveRequest = {
  id: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

const responseFields = ["status", "checkedAt", "service", "database", "code"];

function validCheckedAt(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function readHealth(body: unknown, httpStatus: number): ReadyResponse | DegradedResponse | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== responseFields.length ||
      !responseFields.every((field) => Object.hasOwn(value, field)) ||
      !validCheckedAt(value.checkedAt) || value.service !== "ok") return null;

  if (httpStatus === 200 && value.status === "ready" &&
      value.database === "ok" && value.code === "OK") {
    return { status: "ready", checkedAt: value.checkedAt };
  }
  if (httpStatus === 503 && value.status === "degraded" &&
      value.database === "unavailable" && value.code === "DATABASE_UNAVAILABLE") {
    return { status: "degraded", checkedAt: value.checkedAt, database: "unavailable" };
  }
  if (httpStatus === 503 && value.status === "degraded" &&
      value.database === "schema_missing" && value.code === "SCHEMA_NOT_READY") {
    return { status: "degraded", checkedAt: value.checkedAt, database: "schema_missing" };
  }
  return null;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener("abort", onAbort); reject(error); }
    );
    if (signal.aborted) onAbort();
  });
}

export function useHealth() {
  const [state, setState] = useState<HealthState>({ status: "initial" });
  const nextId = useRef(0);
  const active = useRef<ActiveRequest | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) {
        clearTimeout(active.current.timer);
        active.current.controller.abort();
        active.current = null;
      }
    };
  }, []);

  function check() {
    if (active.current) {
      clearTimeout(active.current.timer);
      active.current.controller.abort();
      active.current = null;
    }

    const id = ++nextId.current;
    const controller = new AbortController();
    const attemptedAt = new Date().toISOString();
    const isCurrent = () => mounted.current && active.current?.id === id;
    const finish = (nextState: HealthState) => {
      const current = active.current;
      if (!mounted.current || current?.id !== id) return;
      clearTimeout(current.timer);
      active.current = null;
      setState(nextState);
    };

    const timer = setTimeout(() => {
      if (!isCurrent()) return;
      finish({ status: "unavailable", attemptedAt });
      controller.abort();
    }, 10_000);
    active.current = { id, controller, timer };
    setState({ status: "checking" });

    void (async () => {
      try {
        const response = await abortable(
          Promise.resolve(fetch("/api/health/ready", { cache: "no-store", signal: controller.signal })),
          controller.signal
        );
        if (!isCurrent()) return;
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
          finish({ status: "unavailable", attemptedAt });
          return;
        }
        const body: unknown = await abortable(response.json(), controller.signal);
        if (!isCurrent()) return;
        const health = readHealth(body, response.status);
        finish(health ?? { status: "unavailable", attemptedAt });
      } catch {
        finish({ status: "unavailable", attemptedAt });
      }
    })();
  }

  return { state, check };
}
