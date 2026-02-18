import type { AppendMessage } from "@assistant-ui/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatProps } from "../../views/chat.ts";
import { buildAssistantThreadMessages, createAssistantChatRuntimeAdapter } from "./adapter.ts";

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
    sessions: null,
    focusMode: false,
    sidebarOpen: false,
    sidebarContent: null,
    sidebarError: null,
    splitRatio: 0.6,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    attachments: [],
    onAttachmentsChange: () => undefined,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onAbort: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    onOpenSidebar: () => undefined,
    onCloseSidebar: () => undefined,
    onSplitRatioChange: () => undefined,
    ...overrides,
  };
}

describe("assistant runtime adapter", () => {
  it("maps stream text into a running assistant message", () => {
    const messages = buildAssistantThreadMessages(
      createProps({
        stream: "Streaming",
        streamStartedAt: 1000,
      }),
    );

    const streamMessage = messages.find((message) => message.id?.startsWith("stream:"));
    expect(streamMessage).toBeDefined();
    expect(streamMessage?.role).toBe("assistant");
    expect(streamMessage?.status?.type).toBe("running");
    expect(streamMessage?.metadata?.custom).toMatchObject({
      openclawPart: { type: "stream" },
    });
  });

  it("maps empty stream to a reading indicator message", () => {
    const messages = buildAssistantThreadMessages(
      createProps({
        stream: "",
        streamStartedAt: 1000,
      }),
    );

    const streamMessage = messages.find((message) => message.id?.startsWith("stream:"));
    expect(streamMessage).toBeDefined();
    expect(streamMessage?.metadata?.custom).toMatchObject({
      openclawPart: { type: "reading-indicator" },
    });
  });

  it("hides tool-result history when thinking is disabled", () => {
    const messages = buildAssistantThreadMessages(
      createProps({
        showThinking: false,
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Hello" }],
            timestamp: 1,
          },
          {
            role: "assistant",
            toolCallId: "tool-1",
            content: [{ type: "text", text: "Should be hidden" }],
            timestamp: 2,
          },
        ],
      }),
    );

    const grouped = messages.filter((message) => message.metadata?.custom?.openclawPart);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.content[0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("routes cancel actions to abort when available", async () => {
    const onAbort = vi.fn();
    const onNewSession = vi.fn();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        canAbort: true,
        onAbort,
        onNewSession,
      }),
    );

    await adapter.onCancel?.();

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("ignores cancel actions when abort is unavailable", async () => {
    const onAbort = vi.fn();
    const onNewSession = vi.fn();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        canAbort: false,
        onAbort,
        onNewSession,
      }),
    );

    await adapter.onCancel?.();

    expect(onNewSession).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("enables assistant-ui image attachment support", () => {
    const adapter = createAssistantChatRuntimeAdapter(createProps());

    expect(adapter.adapters?.attachments).toBeDefined();
    expect(adapter.adapters?.attachments?.accept).toBe("image/*");
  });

  it("maps composer attachments into chat attachments before sending", async () => {
    const onAttachmentsChange = vi.fn();
    const onDraftChange = vi.fn();
    const onSend = vi.fn();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        attachments: [{ id: "old", dataUrl: "data:image/png;base64,OLD", mimeType: "image/png" }],
        onAttachmentsChange,
        onDraftChange,
        onSend,
      }),
    );

    await adapter.onNew({
      role: "user",
      content: [{ type: "text", text: "with image" }],
      createdAt: new Date(),
      attachments: [
        {
          id: "new-image",
          type: "image",
          name: "new-image.png",
          contentType: "image/png",
          status: { type: "complete" },
          content: [{ type: "image", image: "data:image/png;base64,AA==" }],
        },
      ],
      metadata: { custom: {} },
      parentId: null,
      sourceId: null,
      runConfig: undefined,
    } as unknown as AppendMessage);

    expect(onDraftChange).toHaveBeenCalledWith("with image");
    expect(onAttachmentsChange).toHaveBeenCalledWith([
      {
        id: "new-image",
        dataUrl: "data:image/png;base64,AA==",
        mimeType: "image/png",
      },
    ]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("propagates an empty attachment list when composer attachments are cleared", async () => {
    const onAttachmentsChange = vi.fn();
    const onDraftChange = vi.fn();
    const onSend = vi.fn();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        attachments: [{ id: "old", dataUrl: "data:image/png;base64,OLD", mimeType: "image/png" }],
        onAttachmentsChange,
        onDraftChange,
        onSend,
      }),
    );

    await adapter.onNew({
      role: "user",
      content: [{ type: "text", text: "plain text" }],
      createdAt: new Date(),
      attachments: [],
      metadata: { custom: {} },
      parentId: null,
      sourceId: null,
      runConfig: undefined,
    } as unknown as AppendMessage);

    expect(onDraftChange).toHaveBeenCalledWith("plain text");
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("disables the runtime adapter when canSend is false", () => {
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        connected: true,
        canSend: false,
      }),
    );

    expect(adapter.isDisabled).toBe(true);
  });

  it("routes edit actions through the assistant-ui onEdit adapter callback", async () => {
    const onEditMessage = vi.fn();
    const onAttachmentsChange = vi.fn();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        onEditMessage,
        onAttachmentsChange,
      }),
    );

    await adapter.onEdit?.({
      role: "user",
      content: [{ type: "text", text: "edited prompt" }],
      createdAt: new Date(),
      attachments: [],
      metadata: { custom: {} },
      parentId: "parent-1",
      sourceId: "source-1",
      runConfig: undefined,
    } as unknown as AppendMessage);

    expect(onEditMessage).toHaveBeenCalledWith({
      text: "edited prompt",
      parentId: "parent-1",
      sourceId: "source-1",
    });
    expect(onAttachmentsChange).toHaveBeenCalledWith([]);
  });

  it("routes reload actions through the assistant-ui onReload adapter callback", async () => {
    const onReloadMessage = vi.fn();
    const baseTime = Date.now();
    const adapter = createAssistantChatRuntimeAdapter(
      createProps({
        onReloadMessage,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "original prompt" }],
            timestamp: baseTime,
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "original answer" }],
            timestamp: baseTime + 1_000,
          },
        ],
      }),
    );

    await adapter.onReload?.("group:assistant:1", {
      parentId: "group:assistant:1",
      sourceId: "source-2",
    } as unknown as NonNullable<Parameters<NonNullable<typeof adapter.onReload>>[1]>);

    expect(onReloadMessage).toHaveBeenCalledWith({
      prompt: "original prompt",
      parentId: "group:assistant:1",
      sourceId: "source-2",
    });
  });
});
