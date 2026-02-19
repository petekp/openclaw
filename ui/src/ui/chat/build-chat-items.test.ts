import { describe, expect, it } from "vitest";
import { buildChatItems } from "./build-chat-items.ts";

function makeMessage(index: number, role: string = "user") {
  return {
    id: `${role}-${index}`,
    role,
    content: [{ type: "text", text: `${role} message ${index}` }],
    timestamp: index + 1,
  };
}

describe("buildChatItems", () => {
  it("adds a history truncation notice when history exceeds 200 messages", () => {
    const messages = Array.from({ length: 205 }, (_, index) => makeMessage(index));
    const items = buildChatItems({
      sessionKey: "main",
      messages,
      toolMessages: [],
      showThinking: false,
      stream: null,
      streamStartedAt: null,
    });

    const firstGroup = items[0];
    expect(firstGroup?.kind).toBe("group");
    if (firstGroup?.kind !== "group") {
      return;
    }
    expect(firstGroup.role).toBe("system");
    expect(firstGroup.messages).toHaveLength(1);
    const notice = firstGroup.messages[0]?.message as { content?: unknown };
    expect(notice.content).toBe("Showing last 200 messages (5 hidden).");
  });

  it("adds a compaction divider from __openclaw markers", () => {
    const messages = [
      makeMessage(0, "user"),
      {
        id: "compact-marker",
        role: "assistant",
        content: [{ type: "text", text: "compacting" }],
        timestamp: 20,
        __openclaw: { kind: "compaction", id: "abc123" },
      },
      makeMessage(2, "assistant"),
    ];
    const items = buildChatItems({
      sessionKey: "main",
      messages,
      toolMessages: [],
      showThinking: false,
      stream: null,
      streamStartedAt: null,
    });

    const divider = items.find((item) => item.kind === "divider");
    expect(divider).toBeDefined();
    if (!divider || divider.kind !== "divider") {
      return;
    }
    expect(divider.key).toBe("divider:compaction:abc123");
    expect(divider.label).toBe("Compaction");
  });

  it("filters tool-result history messages when showThinking is false", () => {
    const items = buildChatItems({
      sessionKey: "main",
      messages: [
        makeMessage(0, "user"),
        {
          id: "tool-1",
          role: "toolResult",
          content: [{ type: "text", text: "tool output" }],
          timestamp: 10,
        },
      ],
      toolMessages: [],
      showThinking: false,
      stream: null,
      streamStartedAt: null,
    });

    const allMessages = items.flatMap((item) =>
      item.kind === "group" ? item.messages.map((entry) => entry.message) : [],
    ) as Array<{ id?: string }>;
    expect(allMessages.some((message) => message.id === "tool-1")).toBe(false);
  });

  it("includes toolMessages when showThinking is true", () => {
    const items = buildChatItems({
      sessionKey: "main",
      messages: [makeMessage(0, "user")],
      toolMessages: [
        {
          id: "tool-msg-1",
          role: "toolResult",
          content: [{ type: "text", text: "tool output" }],
          timestamp: 100,
        },
      ],
      showThinking: true,
      stream: null,
      streamStartedAt: null,
    });

    const allMessages = items.flatMap((item) =>
      item.kind === "group" ? item.messages.map((entry) => entry.message) : [],
    ) as Array<{ id?: string }>;
    expect(allMessages.some((message) => message.id === "tool-msg-1")).toBe(true);
  });

  it("adds a reading indicator item for empty streams", () => {
    const items = buildChatItems({
      sessionKey: "main",
      messages: [makeMessage(0, "user")],
      toolMessages: [],
      showThinking: false,
      stream: "",
      streamStartedAt: 123,
    });

    const indicator = items.find((item) => item.kind === "reading-indicator");
    expect(indicator).toEqual({ kind: "reading-indicator", key: "stream:main:123" });
  });

  it("adds a stream item with startedAt when stream has text", () => {
    const items = buildChatItems({
      sessionKey: "main",
      messages: [makeMessage(0, "user")],
      toolMessages: [],
      showThinking: false,
      stream: "partial answer",
      streamStartedAt: 456,
    });

    const streamItem = items.find((item) => item.kind === "stream");
    expect(streamItem).toEqual({
      kind: "stream",
      key: "stream:main:456",
      text: "partial answer",
      startedAt: 456,
    });
  });
});
