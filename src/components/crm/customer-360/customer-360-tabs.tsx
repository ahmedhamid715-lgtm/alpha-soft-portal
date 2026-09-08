"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface Customer360Tab {
  value: string;
  label: string;
  content: ReactNode;
}

/**
 * The Customer 360 tab shell — a thin client wrapper around the shared
 * `Tabs` primitive. Every tab's own content is rendered SERVER-SIDE by
 * the page and passed in already-composed as `content` (a React element,
 * not raw data) — this component owns only tab-switching interactivity,
 * not data. The first real use of `Tabs` in an admin page (see
 * customer-360.md "UI" for why this page's own information density
 * warrants it where every prior single-domain detail page's smaller
 * section count didn't).
 */
export function Customer360Tabs({ tabs, defaultValue }: { tabs: Customer360Tab[]; defaultValue?: string }) {
  return (
    <Tabs defaultValue={defaultValue ?? tabs[0]?.value} className="w-full">
      <TabsList className="flex-wrap h-auto">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="pt-4">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
