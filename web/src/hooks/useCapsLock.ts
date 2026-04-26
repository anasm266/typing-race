import { useEffect, useState } from "react";

export function useCapsLock(active = true) {
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    if (!active) return;

    function syncCapsLock(e: KeyboardEvent) {
      setCapsLockOn(e.getModifierState?.("CapsLock") ?? false);
    }

    function clearCapsLock() {
      setCapsLockOn(false);
    }

    window.addEventListener("keydown", syncCapsLock);
    window.addEventListener("keyup", syncCapsLock);
    window.addEventListener("blur", clearCapsLock);

    return () => {
      window.removeEventListener("keydown", syncCapsLock);
      window.removeEventListener("keyup", syncCapsLock);
      window.removeEventListener("blur", clearCapsLock);
    };
  }, [active]);

  return active ? capsLockOn : false;
}
