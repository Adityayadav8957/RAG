"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { AccountSection } from "@/components/settings/AccountSection";
import { ToolsSection } from "@/components/settings/ToolsSection";

function SettingsInner() {
  const params = useSearchParams();
  // The Jira OAuth callback returns to /settings?jira=..., which belongs on the tools view.
  const tools = params.get("view") === "tools" || params.has("jira");
  return (
    <div className={`mx-auto flex flex-col gap-5 px-6 pb-12 pt-7 max-sm:px-3 ${tools ? "max-w-[880px]" : "max-w-[640px]"}`}>
      {tools ? (
        <>
          <PageHeader
            title="Connected tools"
            description="The assistant acts in these tools as you, with your own permissions."
          />
          <ToolsSection />
        </>
      ) : (
        <>
          <PageHeader title="Settings" />
          <AccountSection />
        </>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}
