"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { hasSeenNotice, markNoticeSeen } from "@/lib/notice";
import { Modal } from "./Modal";

const NoticeContext = createContext<{ open: () => void }>({ open: () => undefined });

/** Opens the free-resources notice once per browser after sign-in, and lets any screen re-open it. */
export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasSeenNotice()) setVisible(true);
  }, []);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => {
    markNoticeSeen();
    setVisible(false);
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      {visible && <FreeTierNotice onClose={close} />}
    </NoticeContext.Provider>
  );
}

export function useNotice(): { open: () => void } {
  return useContext(NoticeContext);
}

const POINTS: { title: string; body: string }[] = [
  {
    title: "Backend wake-up",
    body: "The API runs on Render's free web service, which sleeps after about 15 minutes idle. The first request after that can take 30 to 60 seconds.",
  },
  {
    title: "Database latency",
    body: "The database is Neon's free Postgres in Singapore. Each request makes about 10 round trips, roughly 100 to 150 ms each from far-away regions.",
  },
  {
    title: "Model rate limits",
    body: "Models are on the Gemini and Groq free tiers, which have rate limits. If one is busy, the app automatically falls back to the other.",
  },
  {
    title: "Answer speed",
    body: "Repeated questions are answered from a permission-checked semantic cache in about 1 second. First-time questions take roughly 2 to 5 seconds.",
  },
  {
    title: "Where the time goes",
    body: "The Agent activity panel shows exactly how long each step took.",
  },
];

function FreeTierNotice({ onClose }: { onClose: () => void }) {
  return (
    <Modal titleId="notice-title" onClose={onClose} maxWidth="34rem">
      <div className="flex flex-col gap-4 px-[22px] py-5">
        <div className="flex flex-col gap-1.5">
          <h2 id="notice-title" className="m-0 text-lg font-semibold tracking-[-0.01em]">
            Running on free tiers
          </h2>
          <p className="m-0 text-[13px] leading-normal text-muted">
            This is a portfolio showcase that runs entirely on free tiers, so expect some slowness.
          </p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {POINTS.map((p) => (
            <li key={p.title} className="flex flex-col gap-0.5 text-[13px] leading-normal">
              <strong className="font-semibold">{p.title}</strong>
              <span className="text-muted">{p.body}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" onClick={onClose} autoFocus>
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
