/** Loading placeholders that mirror the real page layouts so content swaps in without layout shift. */

export function Skel({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />;
}

function Busy({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

function HeaderSkeleton({ description = true }: { description?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Skel className="h-[22px] w-44" />
        {description && <Skel className="mt-1 h-[14px] w-72 max-w-full" />}
      </div>
    </div>
  );
}

/** Table body rows for a table with `cols` columns. */
export function TableSkeletonRows({ rows = 5, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="td">
              <Skel className={`h-[14px] ${c === 0 ? "w-40 max-w-full" : "w-20"}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

const CONV_WIDTHS = ["w-4/5", "w-3/5", "w-11/12", "w-2/3", "w-1/2"];

export function ConversationListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-1 px-2.5 pt-3">
      <span className="sr-only">Loading conversations</span>
      <Skel className="mb-1 ml-2.5 h-[10px] w-14" />
      {CONV_WIDTHS.map((w, i) => (
        <div key={i} className="flex h-8 items-center px-2.5">
          <Skel className={`h-[13px] ${w}`} />
        </div>
      ))}
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <Busy label="Loading chat" className="relative flex h-full">
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-14 flex-none items-center justify-between gap-3 border-b border-border px-5 max-sm:px-3">
          <Skel className="h-[14px] w-32" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex max-w-[740px] flex-col gap-[30px] px-5 pb-6 pt-7 max-sm:px-3">
            <div className="flex flex-col gap-2.5">
              <Skel className="h-[14px] w-3/4" />
              <Skel className="h-[14px] w-full" />
              <Skel className="h-[14px] w-2/3" />
            </div>
            <div className="flex flex-col items-end gap-2.5">
              <Skel className="h-9 w-1/2" />
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[740px] flex-none px-5 pb-5 max-sm:px-3">
          <Skel className="h-[52px] w-full !rounded-xl" />
        </div>
      </div>
    </Busy>
  );
}

export function DocumentsSkeleton() {
  return (
    <Busy label="Loading knowledge base" className="mx-auto flex max-w-[1080px] flex-col gap-5 px-6 pb-12 pt-7 max-sm:px-3">
      <HeaderSkeleton />
      <div className="flex flex-wrap items-center gap-2.5">
        <Skel className="h-9 min-w-[220px] flex-1 !rounded-lg" />
        <Skel className="h-[36px] w-72 !rounded-lg" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <tbody>
            <TableSkeletonRows rows={6} cols={7} />
          </tbody>
        </table>
      </div>
    </Busy>
  );
}

export function SettingsSkeleton() {
  return (
    <Busy label="Loading settings" className="mx-auto flex max-w-[640px] flex-col gap-5 px-6 pb-12 pt-7 max-sm:px-3">
      <HeaderSkeleton description={false} />
      <div className="flex flex-col rounded-xl border border-border bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b border-border px-[18px] py-4 last:border-b-0">
            <Skel className="h-[14px] w-28" />
            <Skel className="h-[14px] w-40" />
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function AdminSkeleton() {
  return (
    <Busy label="Loading administration" className="mx-auto flex max-w-[1180px] flex-col gap-8 px-6 pb-12 pt-7 max-sm:px-3">
      <HeaderSkeleton />
      <Skel className="h-40 w-full !rounded-xl" />
      <div className="flex flex-col gap-3">
        <Skel className="h-[18px] w-24" />
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <tbody>
              <TableSkeletonRows rows={4} cols={3} />
            </tbody>
          </table>
        </div>
      </div>
    </Busy>
  );
}

export function SectionSkeleton({ label, height = "h-40" }: { label: string; height?: string }) {
  return (
    <Busy label={label}>
      <Skel className={`${height} w-full !rounded-xl`} />
    </Busy>
  );
}
