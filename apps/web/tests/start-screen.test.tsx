import type { ComponentType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// T013 adds the app module. Until then, assertions below fail on the absent screen.
const appModules = import.meta.glob<{ default?: ComponentType; App?: ComponentType }>("../src/App.tsx", {
  eager: true
});
const appModule = appModules["../src/App.tsx"];
const App = appModule?.default ?? appModule?.App ?? (() => null);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderStartScreen() {
  render(<App />);
}

function expectNoBusinessContent() {
  const businessFeature = /프로젝트|받은함|인수인계|계약|회원 관리/;
  expect(screen.queryByRole("link", { name: businessFeature })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: businessFeature })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: businessFeature })).not.toBeInTheDocument();
  expect(screen.queryByText(/사용자 목록|프로젝트 목록|인수인계 내역|계약 목록/)).not.toBeInTheDocument();
  expect(screen.queryByRole("table", { name: businessFeature })).not.toBeInTheDocument();
  expect(screen.queryByRole("grid", { name: businessFeature })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /로그인|가입 승인/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/이메일|비밀번호|토큰/)).not.toBeInTheDocument();
}

describe("development start screen", () => {
  it("identifies HandOff and the development environment", () => {
    renderStartScreen();

    expect(screen.getByRole("heading", { name: /HandOff/i })).toBeVisible();
    expect(screen.getByText(/개발 환경/)).toBeVisible();
  });

  it("shows the initial status as unverified, not ready", () => {
    renderStartScreen();

    expect(screen.getByRole("status")).toHaveTextContent(/미확인|확인 전/);
    expect(screen.queryByText(/준비 완료/)).not.toBeInTheDocument();
  });

  it.each(["Enter", " "] as const)(
    "keeps native status-check activation available for %s",
    (key) => {
      renderStartScreen();

      const checkButton = screen.getByRole("button", { name: /상태 확인|연결 확인/ });
      expect(checkButton).toBeInstanceOf(HTMLButtonElement);
      expect(checkButton).toBeEnabled();
      expect(checkButton.tabIndex).toBeGreaterThanOrEqual(0);
      checkButton.focus();
      expect(checkButton).toHaveFocus();
      expect(fireEvent.keyDown(checkButton, { key, cancelable: true })).toBe(true);
      expect(fireEvent.keyUp(checkButton, { key, cancelable: true })).toBe(true);
    }
  );

  it("finishes a failed status check without exposing business data", async () => {
    const privateUser = "PRIVATE_USER_RECORD_731";
    const privateProject = "PRIVATE_PROJECT_RECORD_824";
    const privateHandoff = "PRIVATE_HANDOFF_RECORD_916";
    const privateRecord = `${privateUser} ${privateProject} ${privateHandoff}`;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(privateRecord)));
    renderStartScreen();

    expect(screen.getByRole("status")).toHaveTextContent(/미확인|확인 전/);
    fireEvent.click(screen.getByRole("button", { name: /상태 확인|연결 확인/ }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/확인 불가|연결 실패/);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent(/확인 중/);
    expect(screen.queryByText(/준비 완료/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /상태 확인|연결 확인|다시 확인/ })).toBeEnabled();
    expect(document.body).not.toHaveTextContent(privateUser);
    expect(document.body).not.toHaveTextContent(privateProject);
    expect(document.body).not.toHaveTextContent(privateHandoff);
    expectNoBusinessContent();
  });

  it("does not expose unfinished business menus or records", () => {
    renderStartScreen();

    expectNoBusinessContent();
  });
});
