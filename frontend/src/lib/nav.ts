export interface NavSpec {
  id: string;
  href: string;
  label: string;
  active: boolean;
}

/** Sidebar destinations in display order; `active` is derived from the current location. */
export function buildNavItems(pathname: string, view: string | null, admin: boolean): NavSpec[] {
  const toolsView = pathname === "/settings" && view === "tools";
  const items: NavSpec[] = [
    { id: "chat", href: "/", label: "Chat", active: pathname === "/" },
    { id: "documents", href: "/documents", label: "Knowledge base", active: pathname.startsWith("/documents") },
    { id: "tools", href: "/settings?view=tools", label: "Connected tools", active: toolsView },
    { id: "settings", href: "/settings", label: "Settings", active: pathname === "/settings" && !toolsView },
  ];
  if (admin) items.push({ id: "admin", href: "/admin", label: "Admin", active: pathname.startsWith("/admin") });
  return items;
}
