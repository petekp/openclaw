import type {
  AppendMessage,
  ExternalStoreAdapter,
  ThreadAssistantMessage,
  ThreadMessage,
  ThreadSystemMessage,
  ThreadUserMessage,
} from "@assistant-ui/react";
import { SimpleImageAttachmentAdapter } from "@assistant-ui/react";
import { buildChatItems } from "../../chat/build-chat-items.ts";
import { extractTextCached } from "../../chat/message-extract.ts";
import { normalizeRoleForGrouping } from "../../chat/message-normalizer.ts";
import type { ChatAttachment } from "../../ui-types.ts";
import type { ChatEditRequest, ChatProps, ChatReloadRequest } from "../../views/chat.ts";

export type AssistantMessagePart =
  | {
      type: "group";
      key: string;
      role: string;
      messages: Array<{ key: string; message: unknown }>;
      timestamp: number;
      isStreaming: boolean;
    }
  | { type: "divider"; key: string; label: string; timestamp: number }
  | { type: "stream"; key: string; text: string; startedAt: number }
  | { type: "reading-indicator"; key: string };

export type AssistantChatRuntimeAdapter = ExternalStoreAdapter;

type CustomMetadata = {
  openclawPart: AssistantMessagePart;
};

function makeCustomMetadata(part: AssistantMessagePart): CustomMetadata {
  return {
    openclawPart: part,
  };
}

function makeSystemMetadata(part: AssistantMessagePart): ThreadSystemMessage["metadata"] {
  return {
    custom: makeCustomMetadata(part),
  };
}

function makeUserMetadata(part: AssistantMessagePart): ThreadUserMessage["metadata"] {
  return {
    custom: makeCustomMetadata(part),
  };
}

function makeAssistantMetadata(part: AssistantMessagePart): ThreadAssistantMessage["metadata"] {
  return {
    unstable_state: null,
    unstable_annotations: [],
    unstable_data: [],
    steps: [],
    custom: makeCustomMetadata(part),
  };
}

function threadRole(role: string): "user" | "assistant" | "system" {
  const normalized = normalizeRoleForGrouping(role).toLowerCase();
  if (normalized === "user") {
    return "user";
  }
  if (normalized === "system") {
    return "system";
  }
  return "assistant";
}

function extractGroupText(messages: Array<{ key: string; message: unknown }>): string {
  const text = messages
    .map((item) => extractTextCached(item.message)?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
  return text.trim();
}

function toThreadMessage(part: AssistantMessagePart): ThreadMessage {
  if (part.type === "divider") {
    const message: ThreadSystemMessage = {
      id: part.key,
      role: "system",
      content: [{ type: "text", text: part.label }],
      createdAt: new Date(part.timestamp),
      metadata: makeSystemMetadata(part),
    };
    return message;
  }

  if (part.type === "reading-indicator") {
    const message: ThreadAssistantMessage = {
      id: part.key,
      role: "assistant",
      content: [{ type: "text", text: "…" }],
      createdAt: new Date(),
      status: { type: "running" },
      metadata: makeAssistantMetadata(part),
    };
    return message;
  }

  if (part.type === "stream") {
    const message: ThreadAssistantMessage = {
      id: part.key,
      role: "assistant",
      content: [{ type: "text", text: part.text || "…" }],
      createdAt: new Date(part.startedAt),
      status: { type: "running" },
      metadata: makeAssistantMetadata(part),
    };
    return message;
  }

  const role = threadRole(part.role);
  const text = extractGroupText(part.messages);
  if (role === "assistant") {
    const message: ThreadAssistantMessage = {
      id: part.key,
      role,
      content: [{ type: "text", text: text || " " }],
      createdAt: new Date(part.timestamp),
      status: { type: "complete", reason: "stop" },
      metadata: makeAssistantMetadata(part),
    };
    return message;
  }

  if (role === "user") {
    const message: ThreadUserMessage = {
      id: part.key,
      role,
      content: [{ type: "text", text: text || " " }],
      createdAt: new Date(part.timestamp),
      attachments: [],
      metadata: makeUserMetadata(part),
    };
    return message;
  }

  const message: ThreadSystemMessage = {
    id: part.key,
    role,
    content: [{ type: "text", text: text || " " }],
    createdAt: new Date(part.timestamp),
    metadata: makeSystemMetadata(part),
  };
  return message;
}

function parseAppendMessageText(message: AppendMessage): string {
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseThreadMessageText(message: ThreadMessage): string {
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseUserPromptFromThreadMessage(message: ThreadMessage): string {
  if (message.role === "user") {
    const plain = parseThreadMessageText(message);
    if (plain) {
      return plain;
    }
  }

  const custom = message.metadata?.custom as Record<string, unknown> | undefined;
  const part = custom?.openclawPart as AssistantMessagePart | undefined;
  if (part?.type === "group" && threadRole(part.role) === "user") {
    return extractGroupText(part.messages);
  }

  return "";
}

function resolveReloadPrompt(messages: ThreadMessage[], parentId: string | null): string {
  const searchFromId = parentId ? messages.findIndex((message) => message.id === parentId) : -1;
  const startIndex = searchFromId >= 0 ? searchFromId : messages.length - 1;

  for (let index = startIndex; index >= 0; index -= 1) {
    const prompt = parseUserPromptFromThreadMessage(messages[index]);
    if (prompt) {
      return prompt;
    }
  }

  for (let index = messages.length - 1; index > startIndex; index -= 1) {
    const prompt = parseUserPromptFromThreadMessage(messages[index]);
    if (prompt) {
      return prompt;
    }
  }

  return "";
}

const assistantImageAttachmentAdapter = new SimpleImageAttachmentAdapter();

async function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("File read failed"));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("File read failed")));
    reader.readAsDataURL(file);
  });
}

async function parseAppendAttachments(message: AppendMessage): Promise<ChatAttachment[]> {
  const attachments = message.attachments ?? [];
  const result: ChatAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    const imagePart = attachment.content.find(
      (part): part is { type: "image"; image: string } => part.type === "image",
    );

    if (imagePart?.image) {
      result.push({
        id: attachment.id,
        dataUrl: imagePart.image,
        mimeType: attachment.contentType,
      });
      continue;
    }

    if (attachment.file) {
      const dataUrl = await toDataUrl(attachment.file);
      result.push({
        id: attachment.id,
        dataUrl,
        mimeType: attachment.contentType || attachment.file.type || "image/png",
      });
    }
  }

  return result;
}

export function buildAssistantThreadMessages(props: ChatProps): ThreadMessage[] {
  const items = buildChatItems({
    sessionKey: props.sessionKey,
    messages: props.messages,
    toolMessages: props.toolMessages,
    showThinking: props.showThinking,
    stream: props.stream,
    streamStartedAt: props.streamStartedAt,
  });

  return items
    .map((item): AssistantMessagePart => {
      if (item.kind === "group") {
        return {
          type: "group",
          key: item.key,
          role: item.role,
          messages: item.messages.map((m) => ({ key: m.key, message: m.message })),
          timestamp: item.timestamp,
          isStreaming: item.isStreaming,
        };
      }
      if (item.kind === "divider") {
        return {
          type: "divider",
          key: item.key,
          label: item.label,
          timestamp: item.timestamp,
        };
      }
      if (item.kind === "stream") {
        return {
          type: "stream",
          key: item.key,
          text: item.text,
          startedAt: item.startedAt,
        };
      }
      return {
        type: "reading-indicator",
        key: item.key,
      };
    })
    .map((part) => toThreadMessage(part));
}

function createAssistantChatRuntimeAdapterBase(
  props: ChatProps,
  messages: ThreadMessage[],
): AssistantChatRuntimeAdapter {
  const submitEdit = async (request: ChatEditRequest) => {
    if (props.onEditMessage) {
      await props.onEditMessage(request);
      return;
    }
    props.onDraftChange(request.text);
    props.onSend();
  };

  return {
    messages,
    isRunning: props.sending || props.stream !== null,
    isLoading: props.loading,
    isDisabled: !props.connected || !props.canSend,
    onNew: async (message: AppendMessage) => {
      if (!props.connected || !props.canSend) {
        return;
      }
      const text = parseAppendMessageText(message);
      const attachments = await parseAppendAttachments(message);
      props.onAttachmentsChange?.(attachments);
      props.onDraftChange(text);
      props.onSend();
    },
    onEdit: async (message: AppendMessage) => {
      if (!props.connected || !props.canSend) {
        return;
      }
      const text = parseAppendMessageText(message);
      const attachments = await parseAppendAttachments(message);
      props.onAttachmentsChange?.(attachments);
      await submitEdit({
        text,
        parentId: message.parentId ?? null,
        sourceId: message.sourceId ?? null,
      });
    },
    onReload: async (parentId, options) => {
      const prompt = resolveReloadPrompt(messages, parentId);
      const request: ChatReloadRequest = {
        prompt,
        parentId,
        sourceId: options?.sourceId ?? null,
      };
      if (props.onReloadMessage) {
        await props.onReloadMessage(request);
        return;
      }
      if (request.prompt) {
        props.onDraftChange(request.prompt);
      }
      props.onSend();
    },
    onCancel: async () => {
      if (props.onAbort && props.canAbort) {
        props.onAbort();
      }
    },
    adapters: {
      attachments: assistantImageAttachmentAdapter,
    },
  };
}

export function createAssistantChatRuntimeAdapter(props: ChatProps): AssistantChatRuntimeAdapter {
  return createAssistantChatRuntimeAdapterBase(props, buildAssistantThreadMessages(props));
}

export function createAssistantChatRuntimeAdapterFromMessages(
  props: ChatProps,
  messages: ThreadMessage[],
): AssistantChatRuntimeAdapter {
  return createAssistantChatRuntimeAdapterBase(props, messages);
}
