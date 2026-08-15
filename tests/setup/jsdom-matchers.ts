import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Registers jest-dom's matchers (toBeVisible, toHaveAccessibleName, etc.)
 * globally. Safe to load even for the plain-`node`-environment suite —
 * it only extends `expect`, it doesn't require a live DOM to import.
 *
 * Also unmounts + clears `document.body` after every test. RTL only does
 * this automatically when `test.globals: true` is set (so its own
 * `afterEach` hook can self-register) — this project's config leaves
 * `globals` off, so without this, each `render()` keeps appending to the
 * same `document.body` and later tests in a file see leftover elements
 * from earlier ones (a real cross-test DOM leak, not a flaky test).
 */
afterEach(() => {
  cleanup();
});

/**
 * jsdom implements neither `window.matchMedia` nor `ResizeObserver` — both
 * are real browser APIs our components depend on (`use-mobile.ts`'s
 * `useIsMobile` hook, and `cmdk`'s internal item-height measurement), not
 * test-only conveniences. Without these, any test that mounts a component
 * using the sidebar or the command palette throws immediately on mount.
 */
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // @ts-expect-error — jsdom has no ResizeObserver; this is a minimal test-only stub.
    window.ResizeObserver = ResizeObserverStub;
    // Mirror onto the global too — library code (cmdk) reads the bare
    // identifier, not `window.ResizeObserver`. `globalThis` is typed
    // loosely enough here that this assignment doesn't need suppressing.
    globalThis.ResizeObserver = ResizeObserverStub;
  }
  // jsdom doesn't implement layout, so it has no scrollIntoView either —
  // cmdk calls it to keep the highlighted item visible as you type/arrow
  // through results.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
