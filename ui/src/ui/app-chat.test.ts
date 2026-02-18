import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleSendChat,
  isChatStopCommand,
  removeQueuedMessage,
  type ChatHost,
} from "./app-chat.ts";
import type { ChatAttachment } from "./ui-types.ts";

const mocks = vi.hoisted(() => ({
  sendChatMessage: vi.fn(),
  abortChatRun: vi.fn(),
  scheduleChatScroll: vi.fn(),
  setLastActiveSessionKey: vi.fn(),
  resetToolStream: vi.fn(),
}));

vi.mock("./controllers/chat.ts", () => ({
  sendChatMessage: mocks.sendChatMessage,
  abortChatRun: mocks.abortChatRun,
  loadChatHistory: vi.fn(),
}));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: vi.fn(),
}));

vi.mock("./app-scroll.ts", () => ({
  scheduleChatScroll: mocks.scheduleChatScroll,
}));

vi.mock("./app-settings.ts", () => ({
  setLastActiveSessionKey: mocks.setLastActiveSessionKey,
}));

vi.mock("./app-tool-stream.ts", () => ({
  resetToolStream: mocks.resetToolStream,
}));

function createHost(overrides: Partial<ChatHost & Record<string, unknown>> = {}): ChatHost {
  return {
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: null,
    chatSending: false,
    sessionKey: "main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    refreshSessionsAfterChat: new Set<string>(),
    ...overrides,
  } as ChatHost;
}

describe("app-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendChatMessage.mockResolvedValue("run-1");
    mocks.abortChatRun.mockResolvedValue(true);
  });

  it("recognizes all stop command aliases", () => {
    expect(isChatStopCommand("/stop")).toBe(true);
    expect(isChatStopCommand("stop")).toBe(true);
    expect(isChatStopCommand("esc")).toBe(true);
    expect(isChatStopCommand("abort")).toBe(true);
    expect(isChatStopCommand("wait")).toBe(true);
    expect(isChatStopCommand("exit")).toBe(true);
    expect(isChatStopCommand("hello")).toBe(false);
  });

  it("queues messages while chat is busy", async () => {
    const host = createHost({
      chatMessage: "Queued while running",
      chatSending: true,
    });

    await handleSendChat(host);

    expect(host.chatMessage).toBe("");
    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.text).toBe("Queued while running");
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it("routes stop command to abort behavior", async () => {
    const host = createHost({
      chatMessage: "stop",
      chatRunId: "run-in-flight",
    });

    await handleSendChat(host);

    expect(mocks.abortChatRun).toHaveBeenCalledTimes(1);
    expect(host.chatMessage).toBe("");
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it("marks /new sends for post-run session refresh", async () => {
    const host = createHost({
      chatMessage: "/new",
    });

    await handleSendChat(host);

    expect(mocks.sendChatMessage).toHaveBeenCalledTimes(1);
    expect(host.refreshSessionsAfterChat.has("run-1")).toBe(true);
    expect(mocks.setLastActiveSessionKey).toHaveBeenCalledWith(host, "main");
  });

  it("supports attachment-only sends", async () => {
    const attachment: ChatAttachment = {
      id: "a1",
      dataUrl: "data:image/png;base64,AA==",
      mimeType: "image/png",
    };
    const host = createHost({
      chatMessage: "",
      chatAttachments: [attachment],
    });

    await handleSendChat(host);

    expect(mocks.sendChatMessage).toHaveBeenCalledWith(host, "", [attachment]);
    expect(host.chatAttachments).toEqual([]);
  });

  it("removes queued messages by id", () => {
    const host = createHost({
      chatQueue: [
        { id: "a", text: "first", createdAt: Date.now() },
        { id: "b", text: "second", createdAt: Date.now() },
      ],
    });

    removeQueuedMessage(host, "a");

    expect(host.chatQueue).toHaveLength(1);
    expect(host.chatQueue[0]?.id).toBe("b");
  });
});
