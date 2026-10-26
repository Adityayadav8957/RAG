"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { buildNavItems } from "@/lib/nav";
import { isAdmin } from "@/lib/types";
import { signOutRequest } from "@/lib/auth";
import { groupConversations } from "@/lib/conversations";
import { BrandMark } from "./BrandMark";
import { useConversations } from "./ConversationsProvider";
import { ChartColumn, BookOpen, LogOut, MessageSquare, Moon, PanelLeft, Plug, Search, Settings, SquarePen, Sun, Trash2, Zap, type IconProps } from "./icons";
import { BrandLink, NavLink } from "./NavLink";
import { ConversationListSkeleton } from "./skeletons";
import { useTheme } from "./ThemeProvider";
import { useUser } from "./UserProvider";

const NAV_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  chat: MessageSquare, documents: BookOpen, tools: Plug, settings: Settings, admin: ChartColumn,
};

function initials(name: string, email: string): string {
  const src = (name || email).trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Sidebar({
  expanded, onToggle, onNavigate, onShowNotice, drawer,
}: {
  /** Whether labels are shown (false = icon rail on desktop). */
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onShowNotice: () => void;
  drawer: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useUser();
  const { resolved, setTheme } = useTheme();
  const { conversations, loaded, error, remove, refresh } = useConversations();
  const [search, setSearch] = useState("");
  const activeConv = pathname === "/" ? params.get("c") : null;
  const groups = groupConversations(conversations, search);
  const items = buildNavItems(pathname, params.get("view"), isAdmin(user));

  async function signOut() {
    await signOutRequest();
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav
      aria-label="Primary"
      className={`flex h-full flex-none flex-col overflow-hidden border-r border-border bg-subtle transition-[width] duration-200 ${
        drawer ? "w-[264px]" : expanded ? "w-[264px]" : "w-[60px]"
      }`}
    >
      <div className="flex h-14 flex-none items-center justify-between gap-2 pl-3.5 pr-3">
        {expanded && (
          <BrandLink onNavigate={onNavigate}>
            <BrandMark />
            <span className="whitespace-nowrap text-sm font-semibold">Dobby</span>
          </BrandLink>
        )}
        <button
          type="button"
          className="icon-btn"
          onClick={onToggle}
          aria-label={drawer ? "Close menu" : expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={drawer ? "Close menu" : expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <div className="flex flex-none flex-col gap-1.5 px-2.5 pb-2.5 pt-1">
        <Link
          href="/"
          prefetch
          onClick={onNavigate}
          title="New chat"
          aria-label="New chat"
          className="flex h-9 items-center gap-2.5 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 text-[13px] font-semibold hover:border-border-strong"
        >
          <SquarePen size={15} />
          {expanded && <span>New chat</span>}
        </Link>
        {expanded && (
          <label className="flex h-[34px] items-center gap-2 rounded-lg bg-hover px-2.5 text-[13px] text-muted">
            <Search size={14} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search conversations"
              placeholder="Search conversations"
              className="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none focus-visible:outline-none"
            />
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5">
        {expanded && (
          <>
            {!loaded && !error && <ConversationListSkeleton />}
            {error && (
              <div role="alert" className="mx-2.5 my-2 flex flex-col items-start gap-1.5 text-[13px] text-err">
                <span>{error}</span>
                <button type="button" className="btn btn-sm" onClick={() => void refresh()}>
                  Retry
                </button>
              </div>
            )}
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="eyebrow px-2.5 pb-1 pt-3">{g.label}</h2>
                <ul>
                  {g.items.map((c) => {
                    const active = c.id === activeConv;
                    return (
                      <li key={c.id} className="group relative">
                        <Link
                          href={`/?c=${c.id}`}
                          prefetch={false}
                          onClick={onNavigate}
                          aria-current={active ? "page" : undefined}
                          className={`block h-8 truncate rounded-[7px] py-[7px] pl-2.5 pr-8 text-[13px] leading-[18px] hover:bg-hover ${active ? "bg-hover" : ""}`}
                        >
                          {c.title || "Untitled"}
                        </Link>
                        <button
                          type="button"
                          aria-label={`Delete conversation ${c.title || "Untitled"}`}
                          title="Delete conversation"
                          onClick={() => {
                            void remove(c).then((ok) => {
                              if (ok && active) router.push("/");
                            });
                          }}
                          className="icon-btn icon-btn-danger absolute right-1 top-1 !h-6 !w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {loaded && conversations.length === 0 && !error && <p className="m-2.5 text-[13px] text-faint">No conversations yet.</p>}
            {conversations.length > 0 && groups.length === 0 && (
              <p className="m-2.5 text-[13px] text-faint">No conversations match “{search}”.</p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-none flex-col gap-0.5 border-t border-border p-2.5">
        {items.map(({ id, href, label, active }) => {
          const Icon = NAV_ICONS[id] ?? MessageSquare;
          return <NavLink key={id} href={href} label={label} active={active} expanded={expanded} icon={<Icon size={15} />} onNavigate={onNavigate} />;
        })}
        <button
          type="button"
          onClick={onShowNotice}
          title="Performance note"
          aria-label="Performance note"
          className="flex h-[34px] items-center gap-2.5 whitespace-nowrap rounded-[7px] border-none bg-transparent px-2.5 text-[13px] font-medium text-muted hover:bg-hover"
        >
          <Zap size={15} />
          {expanded && <span className="min-w-0 flex-1 truncate text-left">Performance note</span>}
        </button>
        <div className="mt-1 flex items-center gap-2.5 border-t border-border px-1.5 pb-0.5 pt-2">
          <div
            title={user?.name || user?.email || ""}
            className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-text"
          >
            {user ? initials(user.name, user.email) : ""}
          </div>
          {expanded && (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold">{user?.name || user?.email || " "}</span>
                <span className="truncate text-[11px] text-faint">{user ? user.roles.join(", ") || "No roles" : ""}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                title={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button type="button" className="icon-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
