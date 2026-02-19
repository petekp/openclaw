import { html } from "lit";
import type { SessionsListResult } from "../types.ts";
import type { ChatAttachment, ChatQueueItem } from "../ui-types.ts";
import "../components/chat-react-host.ts";

export type CompactionIndicatorStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};

export type ChatEditRequest = {
  text: string;
  parentId: string | null;
  sourceId: string | null;
};

export type ChatReloadRequest = {
  prompt: string;
  parentId: string | null;
  sourceId: string | null;
};

export type ChatProps = {
  sessionKey: string;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  onDraftChange: (next: string) => void;
  onSend: () => void;
  onEditMessage?: (request: ChatEditRequest) => Promise<void> | void;
  onReloadMessage?: (request: ChatReloadRequest) => Promise<void> | void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onNewSession: () => void;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
};

export function renderChat(props: ChatProps) {
  return html`<openclaw-chat-react-host .props=${props}></openclaw-chat-react-host>`;
}
