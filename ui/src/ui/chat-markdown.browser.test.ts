import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe("chat markdown rendering", () => {
  it("renders markdown inside tool output sidebar", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;
    await nextFrame();

    const timestamp = Date.now();
    app.chatMessages = [
      {
        role: "assistant",
        content: [
          { type: "toolcall", name: "noop", arguments: {} },
          { type: "toolresult", name: "noop", text: "Hello **world**" },
        ],
        timestamp,
      },
    ];

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    let toolCard: HTMLElement | undefined;
    for (let i = 0; i < 6 && !toolCard; i++) {
      const toolCards = Array.from(app.querySelectorAll<HTMLElement>(".chat-tool-card"));
      toolCard = toolCards.find((card) =>
        card.querySelector(".chat-tool-card__preview, .chat-tool-card__inline"),
      );
      if (!toolCard) {
        await nextFrame();
      }
    }
    expect(toolCard).not.toBeUndefined();
    toolCard?.click();

    await app.updateComplete;
    for (let i = 0; i < 4; i++) {
      await nextFrame();
    }

    const strong = app.querySelector(".sidebar-markdown strong");
    expect(strong?.textContent).toBe("world");
  });
});
