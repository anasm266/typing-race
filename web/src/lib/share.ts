/** Production origin for static meta tags; runtime uses `window.location.origin`. */
export const SITE_ORIGIN = "https://typing-race.pages.dev";

export function roomShareUrl(
  roomId: string,
  origin = typeof window !== "undefined" ? window.location.origin : SITE_ORIGIN
): string {
  return `${origin}/room/${roomId}`;
}

export function watchInviteMessage(url: string): string {
  return `watch this typing race live — ${url}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export type NativeShareResult = "shared" | "cancelled" | "failed";

export async function nativeShareInvite(options: {
  title: string;
  text: string;
  url: string;
}): Promise<NativeShareResult> {
  if (!canNativeShare()) return "failed";
  try {
    await navigator.share(options);
    return "shared";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    return "failed";
  }
}
