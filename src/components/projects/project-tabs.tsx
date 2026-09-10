"use client";

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface ProjectTab {
  value: string;
  label: string;
  content: ReactNode;
}

/** The Project detail tab shell — mirrors `Customer360Tabs`' own shape exactly (a thin client wrapper; every tab's content is rendered server-side and passed in already-composed). */
export function ProjectTabs({ tabs, defaultValue }: { tabs: ProjectTab[]; defaultValue?: string }) {
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
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
