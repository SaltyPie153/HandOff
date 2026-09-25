import type { ComponentType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// T013 adds the app module. Until then, assertions below fail on the absent screen.
const appModules = import.meta.glob<{ default?: ComponentType; App?: ComponentType }>("../src/App.tsx", {
  eager: true
});
const appModule = appModules["../src/App.tsx"];
const App = appModule?.default ?? appModule?.App ?? (() => null);

afterEach(cleanup);

function renderStartScreen() {
  render(<App />);
}

function activateFocusedButton(button: HTMLButtonElement, key: "Enter" | " ") {
  button.focus();
  expect(button).toHaveFocus();

  // jsdom does not perform the browser's default keyboard activation of a button.
  fireEvent.keyDown(button, { key });
  if (key === "Enter") fireEvent.click(button);
  fireEvent.keyUp(button, { key });
  if (key === " ") fireEvent.click(button);
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
    "lets a keyboard user start a status check with %s",
    async (key) => {
      renderStartScreen();

      const checkButton = screen.getByRole("button", { name: /상태 확인|연결 확인/ });
      expect(checkButton).toBeInstanceOf(HTMLButtonElement);
      expect(checkButton).toBeEnabled();
      expect(checkButton.tabIndex).toBeGreaterThanOrEqual(0);

      const previousStatus = screen.getByRole("status").textContent;
      activateFocusedButton(checkButton as HTMLButtonElement, key);

      await waitFor(() => {
        expect(screen.getByRole("status").textContent).not.toBe(previousStatus);
      });
    }
  );

  it("does not expose unfinished business menus or records", () => {
    renderStartScreen();

    const businessFeature = /프로젝트|받은함|인수인계|계약|회원 관리/;
    expect(screen.queryByRole("link", { name: businessFeature })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: businessFeature })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: businessFeature })).not.toBeInTheDocument();
    expect(screen.queryByText(/사용자 목록|프로젝트 목록|인수인계 내역|계약 목록/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: businessFeature })).not.toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: businessFeature })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /로그인|가입 승인/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/이메일|비밀번호|토큰/)).not.toBeInTheDocument();
  });
});
