"use client";

import { useEffect, useRef } from "react";

/**
 * Accessible modal built on the native <dialog>: showModal() provides the focus trap, inert background,
 * Escape-to-close and focus restoration. `onClose` fires for Escape, backdrop click and close().
 */
export function Modal({
  titleId,
  onClose,
  children,
  maxWidth = "32rem",
  dismissible = true,
}: {
  titleId: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
  /** When false (e.g. while a request is in flight) Escape and backdrop clicks are ignored. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (!dismissible) e.preventDefault();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) ref.current?.close();
      }}
      style={{ width: `min(${maxWidth}, calc(100vw - 2rem))` }}
      className="modal m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[14px] p-0"
    >
      {children}
    </dialog>
  );
}
