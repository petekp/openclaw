import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenClawApp } from "../app.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

async function flushDom() {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createContainer() {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chat view", () => {
  it("renders compacting indicator as a badge", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: true,
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );
    await flushDom();

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("renders completion indicator shortly after compaction", async () => {
    const container = createContainer();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );
    await flushDom();

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", async () => {
    const container = createContainer();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            active: false,
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", async () => {
    const container = createContainer();
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort,
        }),
      ),
      container,
    );
    await flushDom();

    const stopButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Stop",
    );
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a new session button when aborting is unavailable", async () => {
    const container = createContainer();
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );
    await flushDom();

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "New session",
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Stop");
  });

  it("does not render assistant groups for non-renderable assistant content", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              content: [{ type: "unknown_block", payload: "x" }],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".chat-group.assistant")).toBeNull();
  });

  it("uses the latest onReloadMessage callback after rerender", async () => {
    const container = createContainer();
    const firstOnReloadMessage = vi.fn();
    const secondOnReloadMessage = vi.fn();
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "Show me a status summary." }],
        timestamp: Date.now() - 1_000,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Gateway connected." }],
        timestamp: Date.now(),
      },
    ];

    render(
      renderChat(
        createProps({
          onReloadMessage: firstOnReloadMessage,
          messages,
        }),
      ),
      container,
    );
    await flushDom();

    render(
      renderChat(
        createProps({
          onReloadMessage: secondOnReloadMessage,
          messages,
        }),
      ),
      container,
    );
    await flushDom();

    const retryButton = container.querySelector<HTMLButtonElement>(
      '.chat-group.assistant .chat-message-action[aria-label="Retry response"]',
    );
    expect(retryButton).not.toBeNull();
    retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushDom();

    expect(firstOnReloadMessage).not.toHaveBeenCalled();
    expect(secondOnReloadMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps an accessible composer label for screen readers", async () => {
    const container = createContainer();
    render(renderChat(createProps()), container);
    await flushDom();

    const input = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(input).not.toBeNull();
    if (!input) {
      return;
    }

    const label = input.labels?.[0];
    expect(label).not.toBeUndefined();
    expect(label?.textContent).toContain("Message");
  });

  it("scrollToBottom clicks the composer-dock new-messages action", () => {
    const app = new OpenClawApp();
    const action = document.createElement("button");
    action.className = "chat-new-messages";
    const clickSpy = vi.spyOn(action, "click");
    const dock = document.createElement("div");
    dock.className = "chat-compose__scroll";
    dock.append(action);
    app.append(dock);

    app.scrollToBottom();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
