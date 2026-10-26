import { AppShell } from "@/components/AppShell";
import { ConversationsProvider } from "@/components/ConversationsProvider";
import { UserProvider } from "@/components/UserProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserProvider>
      <ConversationsProvider>
        <AppShell>{children}</AppShell>
      </ConversationsProvider>
    </UserProvider>
  );
}
