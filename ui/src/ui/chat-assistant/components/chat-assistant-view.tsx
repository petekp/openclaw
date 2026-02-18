import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  useMessage,
} from "@assistant-ui/react";
import React, {
  createElement,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { TOOL_INLINE_THRESHOLD } from "../../chat/constants.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "../../chat/message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "../../chat/message-normalizer.ts";
import { extractToolCards } from "../../chat/tool-cards.ts";
import { formatToolOutputForSidebar, getTruncatedPreview } from "../../chat/tool-helpers.ts";
import { toSanitizedMarkdownHtml } from "../../markdown.ts";
import { detectTextDirection } from "../../text-direction.ts";
import { formatToolDetail, resolveToolDisplay } from "../../tool-display.ts";
import type { ChatProps, CompactionIndicatorStatus } from "../../views/chat.ts";
import {
  buildAssistantThreadMessages,
  createAssistantChatRuntimeAdapterFromMessages,
  type AssistantMessagePart,
} from "../runtime/adapter.ts";
import "../../components/resizable-divider.ts";

const COMPACTION_TOAST_DURATION_MS = 5000;

type RenderContextValue = {
  onOpenSidebar?: (content: string) => void;
  showReasoning: boolean;
  assistantName: string;
  assistantAvatar: string | null;
};

type TextPartProps = {
  text: string;
};

const RenderContext = createContext<RenderContextValue>({
  onOpenSidebar: undefined,
  showReasoning: false,
  assistantName: "Assistant",
  assistantAvatar: null,
});

function MarkdownMessagePart({ text }: TextPartProps) {
  return (
    <div
      className="chat-text"
      dir={detectTextDirection(text)}
      dangerouslySetInnerHTML={{ __html: toSanitizedMarkdownHtml(text) }}
    />
  );
}

const MESSAGE_CONTENT_COMPONENTS = {
  Text: MarkdownMessagePart,
};

function extractAttachmentImageUrl(attachment: {
  content?: Array<{ type?: string; image?: string }>;
  file?: File;
}) {
  const imagePart = attachment.content?.find(
    (part): part is { type: "image"; image: string } =>
      part?.type === "image" && typeof part.image === "string",
  );
  if (imagePart?.image) {
    return imagePart.image;
  }
  if (attachment.file) {
    return URL.createObjectURL(attachment.file);
  }
  return null;
}

function ComposerImageAttachment() {
  const attachment = useAuiState((state) => state.attachment);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = extractAttachmentImageUrl(
      attachment as { content?: Array<{ type?: string; image?: string }>; file?: File },
    );
    if (!next) {
      setPreviewUrl(null);
      return;
    }
    setPreviewUrl(next);
    if (attachment?.file && next.startsWith("blob:")) {
      return () => URL.revokeObjectURL(next);
    }
    return;
  }, [attachment]);

  return (
    <AttachmentPrimitive.Root className="chat-attachment aui-attachment">
      {previewUrl ? (
        <img src={previewUrl} alt="Attachment preview" className="chat-attachment__img" />
      ) : (
        <div className="chat-attachment__img chat-attachment__img--placeholder">
          <AttachmentPrimitive.Name />
        </div>
      )}
      <AttachmentPrimitive.Remove
        className="chat-attachment__remove"
        aria-label="Remove attachment"
      >
        <IconClose />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

const COMPOSER_ATTACHMENT_COMPONENTS = {
  Image: ComposerImageAttachment,
  Attachment: ComposerImageAttachment,
};

function ComposerAttachmentsStrip() {
  const count = useAuiState((state) => state.composer.attachments.length);
  if (!count) {
    return null;
  }
  return (
    <div className="chat-attachments">
      <ComposerPrimitive.Attachments components={COMPOSER_ATTACHMENT_COMPONENTS} />
    </div>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

function IconRetry() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconLoader() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  );
}

function MessageActions({ role }: { role: "user" | "assistant" }) {
  return (
    <ActionBarPrimitive.Root
      className={`chat-message-actions chat-message-actions--${role}`}
      hideWhenRunning={role === "assistant"}
    >
      {role === "assistant" ? (
        <ActionBarPrimitive.Reload
          className="chat-message-action"
          aria-label="Retry response"
          title="Retry response"
        >
          <IconRetry />
        </ActionBarPrimitive.Reload>
      ) : null}
      <ActionBarPrimitive.Copy
        className="chat-message-action chat-message-action--copy"
        aria-label="Copy message"
        title="Copy message"
      >
        <span className="chat-message-action__copy-default" aria-hidden="true">
          <IconCopy />
        </span>
        <span className="chat-message-action__copy-copied" aria-hidden="true">
          <IconCheck />
        </span>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
}

function ToolIcon({ name }: { name: string }) {
  const icon = name.toLowerCase();
  if (icon === "wrench") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }
  if (icon === "filecode") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="m10 13-2 2 2 2" />
        <path d="m14 17 2-2-2-2" />
      </svg>
    );
  }
  if (icon === "edit" || icon === "penline") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (icon === "paperclip") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    );
  }
  if (icon === "globe") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    );
  }
  if (icon === "image") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    );
  }
  if (icon === "smartphone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (icon === "plug") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22v-5" />
        <path d="M9 8V2" />
        <path d="M15 8V2" />
        <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a3 3 0 0 0 6 0v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V5a3 3 0 0 0-3-3z" />
    </svg>
  );
}

function isAvatarUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/");
}

function renderAvatar(role: string, assistantName: string, assistantAvatar: string | null) {
  const normalized = normalizeRoleForGrouping(role);
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "T"
          : "?";

  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return (
        <img className={`chat-avatar ${className}`} src={assistantAvatar} alt={assistantName} />
      );
    }
    return <div className={`chat-avatar ${className}`}>{assistantAvatar}</div>;
  }

  return <div className={`chat-avatar ${className}`}>{initial}</div>;
}

type ImageBlock = {
  url: string;
  alt?: string;
};

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (!Array.isArray(content)) {
    return images;
  }

  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const item = block as Record<string, unknown>;
    if (item.type === "image") {
      const source = item.source as Record<string, unknown> | undefined;
      if (source?.type === "base64" && typeof source.data === "string") {
        const data = source.data;
        const mediaType = typeof source.media_type === "string" ? source.media_type : "image/png";
        const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
        images.push({ url });
      } else if (typeof item.url === "string") {
        images.push({ url: item.url });
      }
    } else if (item.type === "image_url") {
      const imageUrl = item.image_url as Record<string, unknown> | undefined;
      if (typeof imageUrl?.url === "string") {
        images.push({ url: imageUrl.url });
      }
    }
  }

  return images;
}

function ToolCard({
  card,
  onOpenSidebar,
}: {
  card: ReturnType<typeof extractToolCards>[number];
  onOpenSidebar?: (content: string) => void;
}) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());
  const canClick = Boolean(onOpenSidebar);
  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const showCollapsed = hasText && !isShort;
  const showInline = hasText && isShort;
  const isEmpty = !hasText;

  const handleClick = () => {
    if (!onOpenSidebar) {
      return;
    }
    if (hasText && card.text) {
      onOpenSidebar(formatToolOutputForSidebar(card.text));
      return;
    }
    const info = `## ${display.label}\n\n${detail ? `**Command:** \`${detail}\`\n\n` : ""}*No output - tool completed successfully.*`;
    onOpenSidebar(info);
  };

  return (
    <div
      className={`chat-tool-card ${canClick ? "chat-tool-card--clickable" : ""}`}
      role={canClick ? "button" : undefined}
      tabIndex={canClick ? 0 : undefined}
      onClick={canClick ? handleClick : undefined}
      onKeyDown={
        canClick
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              handleClick();
            }
          : undefined
      }
    >
      <div className="chat-tool-card__header">
        <div className="chat-tool-card__title">
          <span className="chat-tool-card__icon">
            <ToolIcon name={display.icon} />
          </span>
          <span>{display.label}</span>
        </div>
        {canClick ? (
          <span className="chat-tool-card__action">
            {hasText ? "View" : ""}
            <IconCheck />
          </span>
        ) : null}
        {isEmpty && !canClick ? (
          <span className="chat-tool-card__status">
            <IconCheck />
          </span>
        ) : null}
      </div>
      {detail ? <div className="chat-tool-card__detail">{detail}</div> : null}
      {isEmpty ? <div className="chat-tool-card__status-text muted">Completed</div> : null}
      {showCollapsed && card.text ? (
        <div className="chat-tool-card__preview mono">{getTruncatedPreview(card.text)}</div>
      ) : null}
      {showInline && card.text ? (
        <div className="chat-tool-card__inline mono">{card.text}</div>
      ) : null}
    </div>
  );
}

function renderGroupedMessageBubble(
  message: unknown,
  options: {
    isStreaming: boolean;
    showReasoning: boolean;
    onOpenSidebar?: (content: string) => void;
  },
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";
  const toolCards = extractToolCards(message);
  const hasToolCards = toolCards.length > 0;
  const images = extractImages(message);
  const hasImages = images.length > 0;
  const extractedText = extractTextCached(message);
  const extractedThinking =
    options.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdown = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;

  const bubbleClasses = ["chat-bubble", options.isStreaming ? "streaming" : "", "fade-in"]
    .filter(Boolean)
    .join(" ");

  if (!markdown && hasToolCards && isToolResult) {
    return (
      <>
        {toolCards.map((card, index) => (
          <ToolCard
            key={`${card.kind}:${card.name}:${index}`}
            card={card}
            onOpenSidebar={options.onOpenSidebar}
          />
        ))}
      </>
    );
  }

  if (!markdown && !hasToolCards && !hasImages) {
    return null;
  }

  return (
    <div className={bubbleClasses}>
      {hasImages ? (
        <div className="chat-message-images">
          {images.map((image, index) => (
            <img
              key={`${image.url}:${index}`}
              src={image.url}
              alt={image.alt ?? "Attached image"}
              className="chat-message-image"
              onClick={() => window.open(image.url, "_blank")}
            />
          ))}
        </div>
      ) : null}
      {reasoningMarkdown ? (
        <div
          className="chat-thinking"
          dangerouslySetInnerHTML={{ __html: toSanitizedMarkdownHtml(reasoningMarkdown) }}
        />
      ) : null}
      {markdown ? (
        <div
          className="chat-text"
          dir={detectTextDirection(markdown)}
          dangerouslySetInnerHTML={{ __html: toSanitizedMarkdownHtml(markdown) }}
        />
      ) : null}
      {toolCards.map((card, index) => (
        <ToolCard
          key={`${card.kind}:${card.name}:${index}`}
          card={card}
          onOpenSidebar={options.onOpenSidebar}
        />
      ))}
    </div>
  );
}

function AssistantThreadMessage() {
  const metadata = useMessage((state) => state.metadata);
  const content = useMessage((state) => state.content);
  const { onOpenSidebar, showReasoning, assistantName, assistantAvatar } =
    useContext(RenderContext);
  const custom = (metadata?.custom ?? {}) as Record<string, unknown>;
  const part = custom.openclawPart as AssistantMessagePart | undefined;

  if (!part) {
    const textPart = content.find(
      (item: unknown): item is { type: "text"; text: string } =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        (item as { type?: unknown }).type === "text",
    );
    if (!textPart || !textPart.text.trim()) {
      return null;
    }
    return (
      <MessagePrimitive.Root className="chat-group assistant">
        {renderAvatar("assistant", assistantName, assistantAvatar)}
        <div className="chat-group-messages">
          <div className="chat-bubble fade-in">
            <MessagePrimitive.Content
              components={MESSAGE_CONTENT_COMPONENTS}
              unstable_showEmptyOnNonTextEnd={false}
            />
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  if (part.type === "divider") {
    return (
      <div className="chat-divider" role="separator" data-ts={String(part.timestamp)}>
        <span className="chat-divider__line"></span>
        <span className="chat-divider__label">{part.label}</span>
        <span className="chat-divider__line"></span>
      </div>
    );
  }

  if (part.type === "reading-indicator") {
    return (
      <MessagePrimitive.Root className="chat-group assistant">
        {renderAvatar("assistant", assistantName, assistantAvatar)}
        <div className="chat-group-messages">
          <div className="chat-bubble chat-reading-indicator" aria-hidden="true">
            <span className="chat-reading-indicator__dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  if (part.type === "stream") {
    const timestamp = new Date(part.startedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return (
      <MessagePrimitive.Root className="chat-group assistant">
        {renderAvatar("assistant", assistantName, assistantAvatar)}
        <div className="chat-group-messages">
          <div className="chat-bubble streaming fade-in">
            <MessagePrimitive.Content
              components={MESSAGE_CONTENT_COMPONENTS}
              unstable_showEmptyOnNonTextEnd={false}
            />
          </div>
          <div className="chat-group-footer">
            <span className="chat-sender-name">{assistantName}</span>
            <span className="chat-group-timestamp">{timestamp}</span>
            <MessageActions role="assistant" />
          </div>
        </div>
      </MessagePrimitive.Root>
    );
  }

  const normalizedRole = normalizeRoleForGrouping(part.role);
  const who =
    normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const actionRole =
    normalizedRole === "user"
      ? ("user" as const)
      : normalizedRole === "assistant"
        ? ("assistant" as const)
        : null;
  const timestamp = new Date(part.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const renderedMessages = part.messages
    .map((item, index) => ({
      key: item.key,
      node: renderGroupedMessageBubble(item.message, {
        isStreaming: part.isStreaming && index === part.messages.length - 1,
        showReasoning,
        onOpenSidebar,
      }),
    }))
    .filter(
      (item): item is { key: string; node: React.ReactNode } =>
        item.node !== null && item.node !== undefined,
    );

  if (renderedMessages.length === 0) {
    return null;
  }

  return (
    <MessagePrimitive.Root className={`chat-group ${roleClass}`}>
      {renderAvatar(part.role, assistantName, assistantAvatar)}
      <div className="chat-group-messages">
        {renderedMessages.map((item) => (
          <React.Fragment key={item.key}>{item.node}</React.Fragment>
        ))}
        <div className="chat-group-footer">
          <span className="chat-sender-name">{who}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
          {actionRole ? <MessageActions role={actionRole} /> : null}
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function ResizableDividerBridge({
  splitRatio,
  onSplitRatioChange,
}: {
  splitRatio: number;
  onSplitRatioChange?: (ratio: number) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onSplitRatioChange) {
      return;
    }
    const handleResize = (event: Event) => {
      const detail = (event as CustomEvent<{ splitRatio: number }>).detail;
      if (typeof detail?.splitRatio !== "number") {
        return;
      }
      onSplitRatioChange(detail.splitRatio);
    };
    el.addEventListener("resize", handleResize as EventListener);
    return () => {
      el.removeEventListener("resize", handleResize as EventListener);
    };
  }, [onSplitRatioChange]);

  useEffect(() => {
    const el = ref.current as (HTMLElement & { splitRatio?: number }) | null;
    if (!el) {
      return;
    }
    el.splitRatio = splitRatio;
  }, [splitRatio]);

  return createElement("resizable-divider", { ref });
}

function CompactionIndicator({ status }: { status: CompactionIndicatorStatus | null | undefined }) {
  if (!status) {
    return null;
  }
  if (status.active) {
    return (
      <div
        className="compaction-indicator compaction-indicator--active"
        role="status"
        aria-live="polite"
      >
        <IconLoader /> Compacting context...
      </div>
    );
  }

  if (status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return (
        <div
          className="compaction-indicator compaction-indicator--complete"
          role="status"
          aria-live="polite"
        >
          <IconCheck /> Context compacted
        </div>
      );
    }
  }
  return null;
}

function MarkdownSidebar({
  content,
  error,
  onClose,
  onOpenSidebar,
}: {
  content: string | null;
  error: string | null;
  onClose: () => void;
  onOpenSidebar?: (content: string) => void;
}) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-header">
        <div className="sidebar-title">Tool Output</div>
        <button type="button" onClick={onClose} className="btn" title="Close sidebar">
          <IconClose />
        </button>
      </div>
      <div className="sidebar-content">
        {error ? (
          <>
            <div className="callout danger">{error}</div>
            <button
              type="button"
              onClick={() => {
                if (!content || !onOpenSidebar) {
                  return;
                }
                onOpenSidebar(`\`\`\`\n${content}\n\`\`\``);
              }}
              className="btn"
              style={{ marginTop: "12px" }}
            >
              View Raw Text
            </button>
          </>
        ) : content ? (
          <div
            className="sidebar-markdown"
            dangerouslySetInnerHTML={{ __html: toSanitizedMarkdownHtml(content) }}
          />
        ) : (
          <div className="muted">No content available</div>
        )}
      </div>
    </div>
  );
}

function ChatThread({
  loading,
  footerContent,
}: {
  loading: boolean;
  footerContent?: React.ReactNode;
}) {
  const components = useMemo(
    () => ({
      UserMessage: AssistantThreadMessage,
      AssistantMessage: AssistantThreadMessage,
      SystemMessage: AssistantThreadMessage,
    }),
    [],
  );

  return (
    <ThreadPrimitive.Root className="chat-thread-root">
      <ThreadPrimitive.Viewport className="chat-thread">
        {loading ? <div className="muted">Loading chat...</div> : null}
        <ThreadPrimitive.Messages components={components} />
      </ThreadPrimitive.Viewport>
      {footerContent ? <div className="chat-thread-footer__content">{footerContent}</div> : null}
    </ThreadPrimitive.Root>
  );
}

function AssistantComposer({
  props,
  canAbort,
  isBusy,
  composePlaceholder,
}: {
  props: ChatProps;
  canAbort: boolean;
  isBusy: boolean;
  composePlaceholder: string;
}) {
  const aui = useAui();
  const lastSyncedDraftRef = useRef<string | null>(null);
  const canCompose = props.connected && props.canSend;

  useEffect(() => {
    if (lastSyncedDraftRef.current === props.draft) {
      return;
    }
    lastSyncedDraftRef.current = props.draft;
    aui.composer().setText(props.draft);
  }, [aui, props.draft]);

  const queueComposerMessage = () => {
    if (!canCompose) {
      return;
    }
    aui.composer().send();
  };

  return (
    <div className="chat-compose">
      {props.onAttachmentsChange ? <ComposerAttachmentsStrip /> : null}

      <div className="chat-compose__dock">
        <div className="chat-compose__scroll">
          <ThreadPrimitive.ScrollToBottom className="btn chat-new-messages">
            New messages <IconArrowDown />
          </ThreadPrimitive.ScrollToBottom>
        </div>

        <ComposerPrimitive.Root className="chat-compose__row aui-composer">
          {props.onAttachmentsChange ? (
            <ComposerPrimitive.AddAttachment
              type="button"
              className="btn chat-compose__attach chat-compose__attach--left"
              disabled={!canCompose}
              title="Add image attachment"
              aria-label="Add image attachment"
            >
              <ToolIcon name="paperclip" />
            </ComposerPrimitive.AddAttachment>
          ) : null}

          <label className="field chat-compose__field aui-composer__input-wrap">
            <span>Message</span>
            <ComposerPrimitive.Input
              className="aui-composer__input"
              submitMode="enter"
              addAttachmentOnPaste
              dir={detectTextDirection(props.draft)}
              disabled={!canCompose}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key !== "Enter") {
                  return;
                }
                const nativeEvent = event.nativeEvent;
                if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
                  return;
                }
                if (event.shiftKey) {
                  return;
                }
                if (!canCompose) {
                  return;
                }
                if (isBusy) {
                  event.preventDefault();
                  queueComposerMessage();
                }
              }}
              onChange={(event) => {
                props.onDraftChange(event.currentTarget.value);
              }}
              placeholder={composePlaceholder}
            />
          </label>

          <div className="chat-compose__actions aui-composer__actions">
            <button
              type="button"
              className="btn"
              disabled={!props.connected || (!canAbort && props.sending)}
              onClick={canAbort ? props.onAbort : props.onNewSession}
            >
              {canAbort ? "Stop" : "New session"}
            </button>
            {isBusy ? (
              <button
                type="button"
                className="btn chat-compose__queue"
                disabled={!canCompose}
                onClick={queueComposerMessage}
              >
                Queue
              </button>
            ) : null}
            <ComposerPrimitive.Send
              className="btn primary chat-compose__send"
              disabled={!canCompose}
            >
              Send
              <kbd className="btn-kbd">↵</kbd>
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </div>
  );
}

export function ChatAssistantView({ props }: { props: ChatProps }) {
  const threadMessages = useMemo(
    () => buildAssistantThreadMessages(props),
    [
      props.sessionKey,
      props.messages,
      props.toolMessages,
      props.showThinking,
      props.stream,
      props.streamStartedAt,
    ],
  );
  const runtimeAdapter = useMemo(
    () => createAssistantChatRuntimeAdapterFromMessages(props, threadMessages),
    [props.canAbort, props.connected, props.loading, props.sending, props.stream, threadMessages],
  );
  const runtime = useExternalStoreRuntime(runtimeAdapter);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = props.thinkingLevel ?? activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const isBusy = props.sending || props.stream !== null;
  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);
  const assistantAvatar = props.assistantAvatar ?? props.assistantAvatarUrl ?? null;
  const composePlaceholder = props.connected
    ? hasAttachments
      ? "Add context for these images (Enter to send)"
      : "Message OpenClaw... (Enter to send, Shift+Enter for a new line)"
    : "Connect to the gateway to start chatting...";

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <RenderContext.Provider
        value={{
          onOpenSidebar: props.onOpenSidebar,
          showReasoning,
          assistantName: props.assistantName,
          assistantAvatar,
        }}
      >
        <section className="card chat">
          {props.disabledReason ? <div className="callout">{props.disabledReason}</div> : null}
          {props.error ? <div className="callout danger">{props.error}</div> : null}

          {props.focusMode ? (
            <button
              className="chat-focus-exit"
              type="button"
              onClick={props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              <IconClose />
            </button>
          ) : null}

          <div
            className={`chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}`}
          >
            <div
              className="chat-main"
              style={{ flex: sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%" }}
            >
              <ChatThread
                loading={props.loading}
                footerContent={
                  <>
                    {props.queue.length ? (
                      <div className="chat-queue" role="status" aria-live="polite">
                        <div className="chat-queue__title">Queued ({props.queue.length})</div>
                        <div className="chat-queue__list">
                          {props.queue.map((item) => (
                            <div key={item.id} className="chat-queue__item">
                              <div className="chat-queue__text">
                                {item.text ||
                                  (item.attachments?.length
                                    ? `Image (${item.attachments.length})`
                                    : "")}
                              </div>
                              <button
                                className="btn chat-queue__remove"
                                type="button"
                                aria-label="Remove queued message"
                                onClick={() => props.onQueueRemove(item.id)}
                              >
                                <IconClose />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <CompactionIndicator status={props.compactionStatus} />

                    <AssistantComposer
                      props={props}
                      canAbort={canAbort}
                      isBusy={isBusy}
                      composePlaceholder={composePlaceholder}
                    />
                  </>
                }
              />
            </div>

            {sidebarOpen ? (
              <>
                <ResizableDividerBridge
                  splitRatio={splitRatio}
                  onSplitRatioChange={props.onSplitRatioChange}
                />
                <div className="chat-sidebar">
                  <MarkdownSidebar
                    content={props.sidebarContent ?? null}
                    error={props.sidebarError ?? null}
                    onClose={props.onCloseSidebar!}
                    onOpenSidebar={props.onOpenSidebar}
                  />
                </div>
              </>
            ) : null}
          </div>
        </section>
      </RenderContext.Provider>
    </AssistantRuntimeProvider>
  );
}
