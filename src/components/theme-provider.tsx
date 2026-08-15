"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Thin wrapper so the rest of the app imports from `@/components/theme-provider`
 * instead of `next-themes` directly — keeps the provider swappable and gives
 * every future module one place to look for theme config, not `next-themes`'
 * own docs. `attribute="class"` toggles Tailwind's `.dark` selector;
 * next-themes injects a blocking inline script before hydration so the
 * correct class is already present at first paint — no flash of the wrong
 * theme, no need to defer rendering.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false} {...props}>
      {children}
    </NextThemesProvider>
  );
}
