import { beforeAll, describe, expect, it, vi } from "vitest";

// A tiny stand-in for the browser's address bar and history, enough for lib/back-navigation.
let url = new URL("http://localhost/");
const listeners: (() => void)[] = [];
const browser = {
  location: {
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get href() {
      return url.href;
    },
  },
  history: {
    pushState: (_d: unknown, _u: string, to?: string) => to && (url = new URL(to, url)),
    replaceState: (_d: unknown, _u: string, to?: string) => to && (url = new URL(to, url)),
  },
};
const back = (to: string) => {
  url = new URL(to, url);
  listeners.forEach((l) => l());
};

let cameBack: () => boolean;
beforeAll(async () => {
  vi.stubGlobal("location", browser.location);
  vi.stubGlobal("history", browser.history);
  vi.stubGlobal("window", { addEventListener: (_: string, l: () => void) => listeners.push(l) });
  ({ cameBack } = await import("@/lib/back-navigation"));
});

describe("cameBack", () => {
  it("is false on a fresh visit and after following a link", () => {
    expect(cameBack()).toBe(false);
    history.pushState({}, "", "/activity?category=salary");
    expect(cameBack()).toBe(false);
  });

  it("is true after Back, however long the page takes, and through Next's same-address tidy-ups", () => {
    back("/");
    history.replaceState({}, "", "/");
    expect(cameBack()).toBe(true);
    expect(cameBack()).toBe(true);
  });

  it("is false again once a link is followed, and on the page it leads to", () => {
    history.pushState({}, "", "/money");
    expect(cameBack()).toBe(false);
    history.pushState({}, "", "/");
    expect(cameBack()).toBe(false);
  });
});
