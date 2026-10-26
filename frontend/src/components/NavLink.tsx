"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "./icons";

function Pending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <LoaderCircle size={15} className="spin" /> : <>{children}</>;
}

/**
 * A real anchor for primary navigation. Shows a spinner in place of the icon while the navigation is pending,
 * so a click always gives immediate feedback.
 */
export function NavLink({
  href, label, active, expanded, icon, onNavigate, className = "",
}: {
  href: string;
  label: string;
  active: boolean;
  expanded: boolean;
  icon: React.ReactNode;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`flex h-[34px] items-center gap-2.5 whitespace-nowrap rounded-[7px] px-2.5 text-[13px] font-medium hover:bg-hover ${
        active ? "bg-hover text-ink" : "text-muted"
      } ${className}`}
    >
      <Pending>{icon}</Pending>
      {expanded && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
    </Link>
  );
}

/** The brand mark + name, linking home. */
export function BrandLink({ children, onNavigate }: { children: React.ReactNode; onNavigate?: () => void }) {
  return (
    <Link href="/" prefetch onClick={onNavigate} aria-label="Dobby home" className="flex min-w-0 items-center gap-[9px] rounded-md">
      {children}
    </Link>
  );
}
