import { describe, expect, it, vi } from "vitest";
import {
  abortChatRun,
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("handleChatEvent", () => {
  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("returns 'final' for final from another run (e.g. sub-agent announce) without clearing state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
  });

  it("processes final from own run and clears state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });

  it("processes aborted from own run and keeps partial assistant message", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const partialMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Partial reply" }],
      timestamp: 2,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Partial reply",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: partialMessage,
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage, partialMessage]);
  });

  it("falls back to streamed partial for invalid aborted assistant payloads", () => {
    const invalidPayloads: ChatEventPayload[] = [
      {
        runId: "run-1",
        sessionKey: "main",
        state: "aborted",
        message: "not-an-assistant-message",
      } as unknown as ChatEventPayload,
      {
        runId: "run-1",
        sessionKey: "main",
        state: "aborted",
        message: {
          role: "user",
          content: [{ type: "text", text: "unexpected" }],
        },
      },
    ];

    for (const payload of invalidPayloads) {
      const existingMessage = {
        role: "user",
        content: [{ type: "text", text: "Hi" }],
        timestamp: 1,
      };
      const state = createState({
        sessionKey: "main",
        chatRunId: "run-1",
        chatStream: "Partial reply",
        chatStreamStartedAt: 100,
        chatMessages: [existingMessage],
      });

      expect(handleChatEvent(state, payload)).toBe("aborted");
      expect(state.chatRunId).toBe(null);
      expect(state.chatStream).toBe(null);
      expect(state.chatStreamStartedAt).toBe(null);
      expect(state.chatMessages).toHaveLength(2);
      expect(state.chatMessages[0]).toEqual(existingMessage);
      expect(state.chatMessages[1]).toMatchObject({
        role: "assistant",
        content: [{ type: "text", text: "Partial reply" }],
      });
    }
  });

  it("processes aborted from own run without message and empty stream", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
    expect(state.chatMessages).toEqual([existingMessage]);
  });

  it("does not append aborted assistant payloads with empty content", () => {
    const existingMessage = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
      timestamp: 1,
    };
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
      chatStreamStartedAt: 100,
      chatMessages: [existingMessage],
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "aborted",
      message: {
        role: "assistant",
        content: [],
      },
    };

    expect(handleChatEvent(state, payload)).toBe("aborted");
    expect(state.chatMessages).toEqual([existingMessage]);
  });
});

describe("loadChatHistory", () => {
  it("keeps legacy assistant string-content history entries", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: "legacy assistant text", timestamp: 1 },
        { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 2 },
      ],
      thinkingLevel: "off",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "legacy assistant text" }],
        timestamp: 1,
      },
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 2 },
    ]);
  });

  it("filters legacy assistant blank string-content entries", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "assistant", content: "   ", timestamp: 1 },
        { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 2 },
      ],
      thinkingLevel: "off",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 2 },
    ]);
  });

  it("filters empty assistant error entries from history", async () => {
    const request = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
        { role: "assistant", stopReason: "error", content: [], timestamp: 2 },
        { role: "assistant", stopReason: "error", timestamp: 3 },
      ],
      thinkingLevel: "off",
    });
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    await loadChatHistory(state);

    expect(state.chatMessages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ]);
    expect(state.chatThinkingLevel).toBe("off");
  });

  it("ignores stale history responses and keeps the newest result", async () => {
    let resolveFirst: ((value: { messages: unknown[]; thinkingLevel: string }) => void) | null =
      null;
    let resolveSecond: ((value: { messages: unknown[]; thinkingLevel: string }) => void) | null =
      null;

    const request = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ messages: unknown[]; thinkingLevel: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<{ messages: unknown[]; thinkingLevel: string }>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const first = loadChatHistory(state);
    const second = loadChatHistory(state);

    resolveSecond?.({
      messages: [{ role: "assistant", content: [{ type: "text", text: "new" }], timestamp: 2 }],
      thinkingLevel: "high",
    });
    await second;

    resolveFirst?.({
      messages: [{ role: "assistant", content: [{ type: "text", text: "old" }], timestamp: 1 }],
      thinkingLevel: "off",
    });
    await first;

    expect(state.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "new" }], timestamp: 2 },
    ]);
    expect(state.chatThinkingLevel).toBe("high");
    expect(state.chatLoading).toBe(false);
  });

  it("ignores a history response when the session key changes mid-flight", async () => {
    let resolveRequest: ((value: { messages: unknown[]; thinkingLevel: string }) => void) | null =
      null;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<{ messages: unknown[]; thinkingLevel: string }>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const state = createState({
      sessionKey: "main",
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const pending = loadChatHistory(state);
    state.sessionKey = "other";
    resolveRequest?.({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "old-main" }], timestamp: 1 },
      ],
      thinkingLevel: "off",
    });
    await pending;

    expect(state.chatMessages).toEqual([]);
    expect(state.chatThinkingLevel).toBe(null);
    expect(state.chatLoading).toBe(false);
  });
});

describe("sendChatMessage", () => {
  it("returns null and does nothing when disconnected", async () => {
    const request = vi.fn();
    const state = createState({
      connected: false,
      client: { request } as unknown as ChatState["client"],
      chatMessages: [{ role: "user", content: [{ type: "text", text: "existing" }], timestamp: 1 }],
    });

    const result = await sendChatMessage(state, "hello");

    expect(result).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(state.chatMessages).toHaveLength(1);
  });

  it("optimistically appends user content and sends attachments in API format", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const runId = await sendChatMessage(state, "hello", [
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,QUJD",
        mimeType: "image/png",
      },
    ]);

    expect(typeof runId).toBe("string");
    expect(state.chatMessages).toHaveLength(1);
    expect(state.chatMessages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "hello" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "data:image/png;base64,QUJD" },
        },
      ],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        sessionKey: "main",
        message: "hello",
        deliver: false,
        attachments: [{ type: "image", mimeType: "image/png", content: "QUJD" }],
      }),
    );
    expect(state.chatSending).toBe(false);
  });

  it("appends an assistant error message on request failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("boom"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
    });

    const runId = await sendChatMessage(state, "hello");

    expect(runId).toBeNull();
    expect(state.lastError).toContain("boom");
    const lastMessage = state.chatMessages[state.chatMessages.length - 1] as {
      role: string;
      content: Array<{ type: string; text?: string }>;
    };
    expect(lastMessage.role).toBe("assistant");
    expect(lastMessage.content[0]?.text).toContain("Error:");
    expect(state.chatSending).toBe(false);
  });
});

describe("abortChatRun", () => {
  it("returns false when disconnected", async () => {
    const request = vi.fn();
    const state = createState({
      connected: false,
      client: { request } as unknown as ChatState["client"],
    });

    const result = await abortChatRun(state);

    expect(result).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("sends runId when present", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-123",
    });

    const result = await abortChatRun(state);

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledWith("chat.abort", {
      sessionKey: "main",
      runId: "run-123",
    });
  });

  it("falls back to session-only abort when runId is missing", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: null,
    });

    const result = await abortChatRun(state);

    expect(result).toBe(true);
    expect(request).toHaveBeenCalledWith("chat.abort", { sessionKey: "main" });
  });

  it("returns false and records lastError on request failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("abort failed"));
    const state = createState({
      connected: true,
      client: { request } as unknown as ChatState["client"],
      chatRunId: "run-1",
    });

    const result = await abortChatRun(state);

    expect(result).toBe(false);
    expect(state.lastError).toContain("abort failed");
  });
});
