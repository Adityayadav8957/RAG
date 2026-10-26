"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { hasSeenNotice, markNoticeSeen } from "@/lib/notice";
import { DobbyBurst } from "./DobbyBurst";
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
    title: "First request can be slow",
    body: "Everything here runs on free tiers, which go to sleep when idle. The first request after a quiet period can take up to 30 to 60 seconds to wake the services.",
  },
  {
    title: "Database latency",
    body: "Each request makes several round trips to a free-tier managed database, which adds some latency to every answer.",
  },
  {
    title: "Model fallback",
    body: "When a model hits its usage limit, the app automatically falls back to a different one. This keeps answers coming but can add a slight delay.",
  },
  {
    title: "Repeat questions are faster",
    body: "Repeated questions are answered from a permission-checked semantic cache, so they come back much sooner than the first time.",
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
          <h2 id="notice-title" className="m-0 flex items-center gap-2.5 text-lg font-semibold tracking-[-0.01em]">
            <DobbyBurst size={32} mood="waiting" />
            Running on free tiers
          </h2>
          <p className="m-0 text-[13px] leading-normal text-muted">
            Dobby is a portfolio showcase that runs entirely on free tiers, so expect some slowness.
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
