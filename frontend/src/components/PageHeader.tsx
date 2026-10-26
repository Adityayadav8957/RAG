export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 text-[22px] font-semibold tracking-[-0.015em]">{title}</h1>
        {description && <p className="m-0 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-[10px] bg-err-soft px-3.5 py-3 text-[13px] text-err">
      {children}
    </p>
  );
}
