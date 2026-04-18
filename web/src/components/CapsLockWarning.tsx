export function CapsLockWarning({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="text-xs uppercase tracking-[0.15em] text-error border border-error/40 bg-error/8 px-3 py-2">
      caps lock is on
    </div>
  );
}
