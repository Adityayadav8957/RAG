"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { UsageUnavailable } from "@/components/admin/UsageUnavailable";
import { ShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { AdminSkeleton, SectionSkeleton } from "@/components/skeletons";
import { useUser } from "@/components/UserProvider";
import { fetchInvites, fetchUsers, INVITES_KEY, USERS_KEY } from "@/lib/adminQueries";
import { fetchCache } from "@/lib/fetchCache";
import { isAdmin } from "@/lib/types";

// The admin tables are only for admins, so they ship as separate chunks that load in parallel with their data.
const InviteSection = dynamic(() => import("@/components/admin/InviteSection").then((m) => m.InviteSection), {
  ssr: false,
  loading: () => <SectionSkeleton label="Loading invitations" height="h-72" />,
});
const UsersTable = dynamic(() => import("@/components/admin/UsersTable").then((m) => m.UsersTable), {
  ssr: false,
  loading: () => <SectionSkeleton label="Loading users" />,
});
const AuditLog = dynamic(() => import("@/components/admin/AuditLog").then((m) => m.AuditLog), {
  ssr: false,
  loading: () => <SectionSkeleton label="Loading audit log" height="h-64" />,
});

export default function AdminPage() {
  const { user, loading } = useUser();
  const admin = isAdmin(user);

  // Start the data requests now so they run alongside the chunk downloads instead of after them.
  useEffect(() => {
    if (!admin) return;
    void fetchCache.revalidate(USERS_KEY, fetchUsers, 15_000);
    void fetchCache.revalidate(INVITES_KEY, fetchInvites, 15_000);
  }, [admin]);

  if (loading) return <AdminSkeleton />;
  if (!admin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p role="alert" className="m-0 rounded-[10px] bg-warn-soft p-4 text-sm text-warn">
          You are not authorized to view this page.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-6 pb-12 pt-7 max-sm:px-3">
      <PageHeader title="Administration" description="Users, access and audit trail. Prompts and responses are never shown.">
        <span className="badge px-[9px] py-1">
          <ShieldCheck size={14} />
          Admin only
        </span>
      </PageHeader>
      <InviteSection />
      <UsersTable />
      <AuditLog />
      <UsageUnavailable />
    </div>
  );
}
