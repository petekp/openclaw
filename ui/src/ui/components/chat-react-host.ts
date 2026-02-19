import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ChatAssistantView } from "../chat-assistant/components/chat-assistant-view.tsx";
import type { ChatProps } from "../views/chat.ts";

export class OpenClawChatReactHost extends HTMLElement {
  private reactRoot: Root | null = null;
  private internalProps: ChatProps | null = null;
  private didSyncInitialRender = false;

  set props(next: ChatProps | null) {
    this.internalProps = next;
    this.renderReact();
  }

  get props(): ChatProps | null {
    return this.internalProps;
  }

  connectedCallback() {
    if (!this.reactRoot) {
      this.reactRoot = createRoot(this);
    }
    this.renderReact();
  }

  disconnectedCallback() {
    if (!this.reactRoot) {
      return;
    }
    this.reactRoot.unmount();
    this.reactRoot = null;
    this.didSyncInitialRender = false;
  }

  private renderReact() {
    if (!this.reactRoot) {
      return;
    }
    const node = this.internalProps
      ? createElement(ChatAssistantView, { props: this.internalProps })
      : null;
    if (!this.didSyncInitialRender && node) {
      // The first host render must be synchronous so Lit reads/layout work right after
      // `.props = ...` can observe the rendered chat DOM in the same frame.
      flushSync(() => {
        this.reactRoot?.render(node);
      });
      this.didSyncInitialRender = true;
      return;
    }
    if (!this.internalProps) {
      this.reactRoot?.render(null);
      return;
    }
    this.reactRoot?.render(node);
  }
}

if (!customElements.get("openclaw-chat-react-host")) {
  customElements.define("openclaw-chat-react-host", OpenClawChatReactHost);
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-chat-react-host": OpenClawChatReactHost;
  }
}
