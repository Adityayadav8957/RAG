import { Suspense } from "react";
import { ChatView } from "@/components/ChatView";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <ChatView />
    </Suspense>
  );
}
