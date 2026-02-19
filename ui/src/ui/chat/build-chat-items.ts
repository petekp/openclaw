import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";

export type ChatBuildInput = {
  sessionKey: string;
  messages: unknown[];
  toolMessages: unknown[];
  showThinking: boolean;
  stream: string | null;
  streamStartedAt: number | null;
};

const CHAT_HISTORY_RENDER_LIMIT = 200;

export function buildChatItems(input: ChatBuildInput): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(input.messages) ? input.messages : [];
  const tools = Array.isArray(input.toolMessages) ? input.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!input.showThinking && normalized.role.toLowerCase() === "toolresult") {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  if (input.showThinking) {
    for (let i = 0; i < tools.length; i++) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (input.stream !== null) {
    const key = `stream:${input.sessionKey}:${input.streamStartedAt ?? "live"}`;
    if (input.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: input.stream,
        startedAt: input.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

export function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const timestamp = normalized.timestamp || Date.now();

    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

export function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}
