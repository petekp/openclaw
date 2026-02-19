import { describe, expect, it } from "vitest";
import { mountApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";

registerAppMountHooks();

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitFrames(count: number) {
  for (let i = 0; i < count; i++) {
    await nextFrame();
  }
}

async function findToolCardWithText(app: HTMLElement, maxFrames = 12): Promise<HTMLElement | null> {
  for (let i = 0; i < maxFrames; i++) {
    const toolCards = Array.from(app.querySelectorAll<HTMLElement>(".chat-tool-card"));
    const toolCard = toolCards.find((card) =>
      card.querySelector(".chat-tool-card__preview, .chat-tool-card__inline"),
    );
    if (toolCard) {
      return toolCard;
    }
    await nextFrame();
  }
  return null;
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
    // Lit updates the custom element property first, then React commits within the host.
    // Wait for a few animation frames so the bridge finishes rendering before querying.
    await waitFrames(6);

    const toolCard = await findToolCardWithText(app);
    expect(toolCard).not.toBeNull();
    toolCard?.click();

    await app.updateComplete;
    await waitFrames(4);

    const strong = app.querySelector(".sidebar-markdown strong");
    expect(strong?.textContent).toBe("world");
  });
});
