import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => window.history.replaceState({}, '', '/dev/health'));
import App from "../src/App";

const serverCheckedAt = "2020-01-02T03:04:05.000Z";
const ready = {
  status: "ready",
  checkedAt: serverCheckedAt,
  service: "ok",
  database: "ok",
  code: "OK"
} as const;
const databaseDown = {
  status: "degraded",
  checkedAt: serverCheckedAt,
  service: "ok",
  database: "unavailable",
  code: "DATABASE_UNAVAILABLE"
} as const;
const schemaMissing = {
  status: "degraded",
  checkedAt: serverCheckedAt,
  service: "ok",
  database: "schema_missing",
  code: "SCHEMA_NOT_READY"
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (reason: unknown) => void;
  let settled = false;
  const promise = new Promise<Response>((onResolve, onReject) => {
    resolve = (response) => {
      if (settled) return;
      settled = true;
      onResolve(response);
    };
    reject = (reason) => {
      if (settled) return;
      settled = true;
      onReject(reason);
    };
  });
  pendingResponses.push({ resolve, reject });
  return { promise, resolve, reject };
}

const pendingResponses: Array<{
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
}> = [];

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const pending of pendingResponses.splice(0)) pending.resolve(jsonResponse(ready));
  });
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function liveRegions() {
  const regions = [...document.querySelectorAll<HTMLElement>("[aria-live]")].filter(
    (region) => /^(polite|assertive)$/.test(region.getAttribute("aria-live") ?? "")
  );
  expect(regions.length).toBeGreaterThan(0);
  return regions;
}

function expectLiveStatus(expected: RegExp) {
  expect(liveRegions().some((region) => expected.test(region.textContent ?? ""))).toBe(true);
}

function expectNoLiveStatus(unexpected: RegExp) {
  expect(liveRegions().some((region) => unexpected.test(region.textContent ?? ""))).toBe(false);
}

function checkAgain() {
  const button = screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ });
  fireEvent.click(button);
}

function expectNoRawDiagnostics() {
  for (const raw of [
    "PRIVATE_PROBE_VALUE_824",
    "postgresql://handoff:private-password@127.0.0.1:5433/handoff_test",
    "SELECT value FROM bootstrap_probes",
    "private-password"
  ]) {
    expect(document.body).not.toHaveTextContent(raw);
  }
}

const dbAction = /db:up|(?:DB|데이터베이스|저장소).{0,40}(?:실행|시작|설정|확인).{0,25}(?:하세요|해\s*주세요|하십시오)/i;
const apiAction = /dev:api|API.{0,50}(?:프로세스|서버|실행|시작|연결|재시도|다시 확인).{0,25}(?:하세요|해\s*주세요|하십시오)/i;

function expectLabeledInstant(label: string, instant: string) {
  const text = (document.body.textContent ?? "").replace(/\s+/g, " ");
  const labelAt = text.indexOf(label);
  expect(labelAt).toBeGreaterThanOrEqual(0);
  const following = text.slice(labelAt + label.length);
  const nextTimeLabel = following.search(/확인(?: 시도)? 시각/);
  const value = nextTimeLabel < 0 ? following : following.slice(0, nextTimeLabel);
  const date = new Date(instant);
  const iso = value.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/);
  if (iso) {
    expect(new Date(iso[0]).getTime(), `${label} must preserve the server instant`).toBe(date.getTime());
    return;
  }
  const pad = (number: number) => number < 10 ? `0?${number}` : String(number);
  const bounded = (number: number) => `(?<!\\d)${pad(number)}(?!\\d)`;
  const patterns = [
    [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()],
    [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
  ].flatMap(([year, month, day, hour, minute, second]) => {
    const clocks = [hour, hour % 12 || 12].map(
      (displayHour) => `${bounded(displayHour)}:${bounded(minute)}:${bounded(second)}`
    );
    return clocks.flatMap((clock) => [
      new RegExp(`${bounded(year)}\\D+${bounded(month)}\\D+${bounded(day)}.{0,24}${clock}`),
      new RegExp(`${bounded(month)}\\D+${bounded(day)}\\D+${bounded(year)}.{0,24}${clock}`),
      new RegExp(`${bounded(day)}\\D+${bounded(month)}\\D+${bounded(year)}.{0,24}${clock}`)
    ]);
  });
  expect(patterns.some((pattern) => pattern.test(value)), `${label} must show the complete expected date and time`).toBe(true);
}

describe("timestamp assertion fixtures", () => {
  it("accepts the exact server instant in ISO or local presentation", () => {
    const fixture = document.createElement("div");
    document.body.append(fixture);
    try {
      fixture.textContent = `확인 시각 ${serverCheckedAt}`;
      expectLabeledInstant("확인 시각", serverCheckedAt);
      fixture.textContent = `확인 시각 ${new Date(serverCheckedAt).toLocaleString()}`;
      expectLabeledInstant("확인 시각", serverCheckedAt);
    } finally {
      fixture.remove();
    }
  });

  it("rejects wrong day, wrong second, and a timestamp under the wrong label", () => {
    const fixture = document.createElement("div");
    document.body.append(fixture);
    try {
      for (const displayed of [
        "2020-01-03T03:04:05.000Z",
        "2020-01-02T03:04:06.000Z",
        "2020-01-02T13:04:05.000Z",
        "2020. 1. 2. 13:04:05",
        `2032-03-04T05:06:07.000Z 확인 시도 시각 ${serverCheckedAt}`
      ]) {
        fixture.textContent = `확인 시각 ${displayed}`;
        expect(() => expectLabeledInstant("확인 시각", serverCheckedAt)).toThrow(/must preserve|complete expected date and time/);
      }
    } finally {
      fixture.remove();
    }
  });
});

describe("announcement and guidance assertion fixtures", () => {
  it("finds a dynamic announcement after a static aria-live region", () => {
    const staticRegion = document.createElement("div");
    staticRegion.setAttribute("aria-live", "polite");
    staticRegion.textContent = "서비스 상태";
    const dynamicRegion = document.createElement("div");
    dynamicRegion.setAttribute("aria-live", "assertive");
    dynamicRegion.textContent = "확인 중";
    document.body.append(staticRegion, dynamicRegion);
    try {
      expectLiveStatus(/확인 중/);
      expectNoLiveStatus(/준비 완료/);
    } finally {
      staticRegion.remove();
      dynamicRegion.remove();
    }
  });

  it("requires imperative or command guidance rather than descriptive status text", () => {
    expect(dbAction.test("저장소 시작 실패")).toBe(false);
    expect(apiAction.test("API 연결 상태를 확인할 수 있습니다")).toBe(false);
    expect(dbAction.test("DB를 실행하세요")).toBe(true);
    expect(apiAction.test("API 프로세스를 확인하세요")).toBe(true);
  });
});

describe("development health screen", () => {
  it("announces checking while the request is pending and keeps a recheck action", () => {
    const pending = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    render(<App />);

    checkAgain();

    expectLiveStatus(/확인 중|점검 중|검사 중/);
    expectNoLiveStatus(/준비 완료|확인 불가/);
    expect(screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ })).toBeEnabled();
  });

  it("shows ready only after a valid 200 response, with service and storage healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(ready)));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/준비 완료|정상/));
    expect(document.body).toHaveTextContent(/서비스 상태/);
    expect(document.body).toHaveTextContent(/저장소 상태/);
    expect(document.body).toHaveTextContent(/저장소.*(정상|연결됨|사용 가능)/);
    expect(screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ })).toBeEnabled();
  });

  it("treats a valid 503 as degraded storage while the service remains available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(databaseDown, 503)));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/저장소.*(실패|불가)|일부.*(실패|오류)|점검 필요|degraded/i));
    expectNoLiveStatus(/확인 불가|준비 완료/);
    expect(document.body).toHaveTextContent(/서비스 상태/);
    expect(document.body).toHaveTextContent(/저장소 상태/);
    expect(screen.getByText(dbAction)).toBeVisible();
    expect(screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ })).toBeEnabled();
    expectNoRawDiagnostics();
  });

  it("guides migration when the server diagnoses a missing schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(schemaMissing, 503)));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/저장소.*(실패|불가)|일부.*(실패|오류)|점검 필요|degraded/i));
    expect(document.body).toHaveTextContent(/db:migrate/);
    expect(document.body).not.toHaveTextContent(/준비 완료/);
  });

  it("classifies a rejected network request as unavailable and suggests checking the API", async () => {
    const privateError = new Error(
      "SELECT value FROM bootstrap_probes; postgresql://handoff:private-password@127.0.0.1:5433/handoff_test; PRIVATE_PROBE_VALUE_824"
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(privateError));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/확인 불가|연결 실패|응답 없음/));
    expect(document.body).toHaveTextContent(/저장소 상태/);
    expect(document.body).toHaveTextContent(/확인 불가|알 수 없음|미확인/);
    expect(screen.getByText(apiAction)).toBeVisible();
    expect(screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ })).toBeEnabled();
    expectNoRawDiagnostics();
  });

  it("rejects a non-JSON success response without displaying its raw body", async () => {
    const rawBody = "PRIVATE_PROBE_VALUE_824 SELECT value FROM bootstrap_probes private-password";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rawBody, {
      status: 200,
      headers: { "content-type": "text/html" }
    })));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/확인 불가|연결 실패|응답 없음/));
    expectNoLiveStatus(/준비 완료/);
    expectNoRawDiagnostics();
  });

  it.each([
    ["missing checkedAt", { status: "ready", service: "ok", database: "ok", code: "OK" }, 200],
    ["invalid database field", { ...ready, database: "private-password" }, 200],
    ["inconsistent success code", { ...ready, code: "DATABASE_UNAVAILABLE" }, 200],
    ["invalid service in a 503", { ...databaseDown, service: "private-password" }, 503]
  ])("rejects %s as unavailable", async (_name, body, http) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, http)));
    render(<App />);
    checkAgain();

    await waitFor(() => expectLiveStatus(/확인 불가|연결 실패|응답 없음/));
    expectNoLiveStatus(/준비 완료/);
    expectNoRawDiagnostics();
  });

  it("aborts an unanswered request by 9 seconds to leave time for the 10-second screen deadline", async () => {
    vi.useFakeTimers();
    const pending = deferredResponse();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, options?: RequestInit) => {
      requestSignal = options?.signal ?? undefined;
      requestSignal?.addEventListener("abort", () => pending.reject(new DOMException("Aborted", "AbortError")), { once: true });
      return pending.promise;
    }));
    render(<App />);
    checkAgain();

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    await act(async () => { vi.advanceTimersByTime(8_999); });
    expect(requestSignal?.aborted).toBe(false);
    expectLiveStatus(/확인 중|점검 중|검사 중/);

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(requestSignal?.aborted).toBe(true);
    expectLiveStatus(/확인 불가|연결 실패|응답 없음/);
    expectNoLiveStatus(/준비 완료/);
  });

  it("keeps the latest result when an older request resolves afterward", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    checkAgain();
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    checkAgain();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => { second.resolve(jsonResponse(databaseDown, 503)); });
    expectLiveStatus(/저장소.*(실패|불가)|일부.*(실패|오류)|점검 필요|degraded/i);
    await act(async () => { first.resolve(jsonResponse(ready)); });
    expectLiveStatus(/저장소.*(실패|불가)|일부.*(실패|오류)|점검 필요|degraded/i);
    expectNoLiveStatus(/준비 완료/);
  });

  it("keeps server checkedAt distinct from the client time of an unavailable attempt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2032-03-04T05:06:07.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(ready))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    await act(async () => { checkAgain(); });
    expectLiveStatus(/준비 완료|정상/);
    expectLabeledInstant("확인 시각", serverCheckedAt);
    expect(document.body).not.toHaveTextContent(/2032/);

    await act(async () => { checkAgain(); });
    expectLiveStatus(/확인 불가|연결 실패|응답 없음/);
    expectLabeledInstant("확인 시도 시각", "2032-03-04T05:06:07.000Z");
    expect(document.body).not.toHaveTextContent(/2020/);
  });
});
