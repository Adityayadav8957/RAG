"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { BrandMark } from "./BrandMark";
import { NoticeProvider, useNotice } from "./FreeTierNotice";
import { BrandLink } from "./NavLink";
import { Menu } from "./icons";
import { Sidebar } from "./Sidebar";

/** Closes the mobile drawer whenever the route changes. */
function RouteWatcher({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams().toString();
  useEffect(onChange, [pathname, params, onChange]);
  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <NoticeProvider>
      <Shell>{children}</Shell>
    </NoticeProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { open: showNotice } = useNotice();
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const showDrawer = !desktop && drawerOpen;
  return (
    <div className="relative flex h-dvh overflow-hidden bg-bg text-ink">
      <a
        href="#main"
        className="absolute left-2 top-2 z-50 -translate-y-16 rounded-md bg-surface px-3 py-2 text-sm shadow-pop focus:translate-y-0"
      >
        Skip to content
      </a>
      <Suspense fallback={null}>
        <RouteWatcher onChange={closeDrawer} />
      </Suspense>
      {showDrawer && (
        <div aria-hidden="true" className="fixed inset-0 z-30 bg-[var(--scrim)]" onClick={() => setDrawerOpen(false)} />
      )}
      <div className={desktop ? "flex-none" : showDrawer ? "fixed inset-y-0 left-0 z-40 max-w-[88vw] shadow-pop" : "hidden"}>
        <Suspense fallback={<div className="h-full w-[264px] border-r border-border bg-subtle" />}>
          <Sidebar
            expanded={desktop ? !collapsed : true}
            drawer={!desktop}
            onToggle={() => (desktop ? setCollapsed((c) => !c) : setDrawerOpen(false))}
            onNavigate={() => setDrawerOpen(false)}
            onShowNotice={() => {
              setDrawerOpen(false);
              showNotice();
            }}
          />
        </Suspense>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && (
          <div className="flex min-h-12 flex-none items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)]">
            <button type="button" className="icon-btn" aria-label="Open menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
              <Menu size={18} />
            </button>
            <BrandLink>
              <BrandMark size={22} />
              <span className="text-sm font-semibold">Dobby</span>
            </BrandLink>
          </div>
        )}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
