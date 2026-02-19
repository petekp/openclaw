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

function createSessionWithReasoning(reasoningLevel: string) {
  return {
    key: "main",
    kind: "direct" as const,
    updatedAt: Date.now(),
    reasoningLevel,
  };
}

function createClipboardItems(files: File[]): DataTransferItemList {
  const list = { length: files.length } as DataTransferItemList & Record<number, DataTransferItem>;
  files.forEach((file, index) => {
    list[index] = {
      kind: "file",
      type: file.type,
      getAsFile: () => file,
      getAsString: () => undefined,
      webkitGetAsEntry: () => null,
    } as unknown as DataTransferItem;
  });
  return list;
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

  it("renders queued messages with remove controls", async () => {
    const container = createContainer();
    const onQueueRemove = vi.fn();
    render(
      renderChat(
        createProps({
          queue: [
            { id: "a", text: "First", createdAt: Date.now() },
            {
              id: "b",
              text: "",
              createdAt: Date.now(),
              attachments: [
                { id: "img", dataUrl: "data:image/png;base64,AA==", mimeType: "image/png" },
              ],
            },
          ],
          onQueueRemove,
        }),
      ),
      container,
    );
    await flushDom();

    const queueTitle = container.querySelector(".chat-queue__title");
    expect(queueTitle?.textContent).toContain("Queued (2)");
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Image (1)");

    const removeButtons = container.querySelectorAll(".chat-queue__remove");
    expect(removeButtons.length).toBe(2);
    removeButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onQueueRemove).toHaveBeenCalledWith("a");
  });

  it("does not render assistant reasoning when session reasoning is off", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          showThinking: true,
          sessions: {
            ...createSessions(),
            sessions: [createSessionWithReasoning("off")],
          },
          messages: [
            {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "hidden chain of thought" },
                { type: "text", text: "Visible answer" },
              ],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".chat-thinking")).toBeNull();
    expect(container.textContent).toContain("Visible answer");
  });

  it("renders assistant reasoning when thinkingLevel prop enables it", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          showThinking: true,
          thinkingLevel: "medium",
          sessions: createSessions(),
          messages: [
            {
              role: "assistant",
              content: [
                { type: "thinking", thinking: "visible chain of thought" },
                { type: "text", text: "Visible answer" },
              ],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".chat-thinking")).not.toBeNull();
    expect(container.textContent).toContain("Visible answer");
  });

  it("does not render footer-only assistant groups for non-renderable content", async () => {
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

  it("renders the new-messages action in the composer dock, not inside the thread viewport", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Older message" }],
              timestamp: Date.now() - 1_000,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Newest message" }],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".chat-compose__scroll .chat-new-messages")).not.toBeNull();
    expect(container.querySelector(".chat-thread .chat-new-messages")).toBeNull();
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

  it("renders user and assistant groups on assistant-ui message primitives", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          messages: [
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
          ],
        }),
      ),
      container,
    );
    await flushDom();

    expect(container.querySelector(".chat-group.user[data-message-id]")).not.toBeNull();
    expect(container.querySelector(".chat-group.assistant[data-message-id]")).not.toBeNull();
  });

  it("renders assistant-ui message action bars for user and assistant turns", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          onReloadMessage: () => undefined,
          messages: [
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
          ],
        }),
      ),
      container,
    );
    await flushDom();

    const userActions = container.querySelector(".chat-group.user .chat-message-actions");
    const assistantActions = container.querySelector(".chat-group.assistant .chat-message-actions");
    expect(userActions).not.toBeNull();
    expect(assistantActions).not.toBeNull();

    const editButton = container.querySelector<HTMLButtonElement>(
      '.chat-group.user .chat-message-action[aria-label="Edit message"]',
    );
    const retryButton = container.querySelector<HTMLButtonElement>(
      '.chat-group.assistant .chat-message-action[aria-label="Retry response"]',
    );
    const copyButton = container.querySelector<HTMLButtonElement>(
      '.chat-group.assistant .chat-message-action--copy[aria-label="Copy message"]',
    );
    expect(editButton).toBeNull();
    expect(retryButton).not.toBeNull();
    expect(copyButton).not.toBeNull();
    expect(retryButton?.querySelector("svg")).not.toBeNull();
    expect(copyButton?.querySelector("svg")).not.toBeNull();
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

  it("does not render an edit action for user messages", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          messages: [
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
          ],
        }),
      ),
      container,
    );
    await flushDom();

    const editButton = container.querySelector<HTMLButtonElement>(
      '.chat-group.user .chat-message-action[aria-label="Edit message"]',
    );
    expect(editButton).toBeNull();
  });

  it("renders streaming assistant bubble inside an assistant-ui message primitive root", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          stream: "Streaming response...",
          streamStartedAt: Date.now(),
        }),
      ),
      container,
    );
    await flushDom();

    const streamingBubble = container.querySelector(
      ".chat-group.assistant[data-message-id] .chat-bubble.streaming",
    );
    expect(streamingBubble).not.toBeNull();
    expect(container.textContent).toContain("Streaming response...");
  });

  it("keeps the latest queued user message root stable when stream completes", async () => {
    const container = createContainer();
    const baseTime = Date.now();

    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "First queued prompt" }],
              timestamp: baseTime - 2_000,
            },
            {
              role: "user",
              content: [{ type: "text", text: "Second queued prompt" }],
              timestamp: baseTime - 1_000,
            },
          ],
          stream: "Streaming response...",
          streamStartedAt: baseTime,
        }),
      ),
      container,
    );
    await flushDom();

    const initialSecondBubble = Array.from(
      container.querySelectorAll<HTMLElement>(".chat-bubble"),
    ).find((node) => node.textContent?.includes("Second queued prompt"));
    const initialSecondRoot = initialSecondBubble?.closest<HTMLElement>("[data-message-id]");
    expect(initialSecondRoot).not.toBeNull();
    if (!initialSecondRoot) {
      return;
    }

    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "First queued prompt" }],
              timestamp: baseTime - 2_000,
            },
            {
              role: "user",
              content: [{ type: "text", text: "Second queued prompt" }],
              timestamp: baseTime - 1_000,
            },
            {
              role: "assistant",
              content: [{ type: "text", text: "Final response" }],
              timestamp: baseTime + 1_000,
            },
          ],
          stream: null,
          streamStartedAt: baseTime,
        }),
      ),
      container,
    );
    await flushDom();

    const finalSecondBubble = Array.from(
      container.querySelectorAll<HTMLElement>(".chat-bubble"),
    ).find((node) => node.textContent?.includes("Second queued prompt"));
    const finalSecondRoot = finalSecondBubble?.closest<HTMLElement>("[data-message-id]");
    expect(finalSecondRoot).not.toBeNull();
    expect(finalSecondRoot).toBe(initialSecondRoot);
  });

  it("queues on Enter while busy", async () => {
    const container = createContainer();
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          sending: true,
          draft: "queued while busy",
          onSend,
        }),
      ),
      container,
    );
    await flushDom();

    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();

    input?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushDom();

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("shows a queue action button while busy", async () => {
    const container = createContainer();
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          sending: true,
          onSend,
        }),
      ),
      container,
    );
    await flushDom();

    const queueButton = container.querySelector(".chat-compose__queue");
    expect(queueButton).not.toBeNull();
    expect(queueButton?.textContent?.trim()).toBe("Queue");

    queueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushDom();

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("sends once when clicking Send", async () => {
    const container = createContainer();
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          onSend,
          connected: true,
          draft: "send from composer",
        }),
      ),
      container,
    );
    await flushDom();

    const sendButton = container.querySelector(".chat-compose__actions .btn.primary");
    expect(sendButton).not.toBeNull();

    sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushDom();

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("disables compose actions when canSend is false", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          connected: true,
          canSend: false,
        }),
      ),
      container,
    );
    await flushDom();

    const sendButton = container.querySelector<HTMLButtonElement>(".chat-compose__send");
    const input = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(sendButton).not.toBeNull();
    expect(input).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);
    expect(input?.disabled).toBe(true);
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

  it("prevents default paste when image files are included", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );
    await flushDom();

    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();

    const file = new File(["x"], "paste.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: createClipboardItems([file]),
        files: [file],
      },
    });

    input?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("renders the attachment button to the left of the message input", async () => {
    const container = createContainer();
    render(
      renderChat(
        createProps({
          onAttachmentsChange: vi.fn(),
        }),
      ),
      container,
    );
    await flushDom();

    const composerRow = container.querySelector(".chat-compose__row.aui-composer");
    const attachButton = composerRow?.querySelector(".chat-compose__attach");
    const inputField = composerRow?.querySelector(".chat-compose__field");

    expect(composerRow).not.toBeNull();
    expect(attachButton).not.toBeNull();
    expect(inputField).not.toBeNull();
    if (!composerRow || !attachButton || !inputField) {
      return;
    }
    expect(composerRow.firstElementChild).toBe(attachButton);
  });
});
