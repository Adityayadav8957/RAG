export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), borderRadius: Math.round(size * 0.27) }}
      className="grid flex-none place-items-center bg-ink font-bold text-bg"
    >
      E
    </div>
  );
}
