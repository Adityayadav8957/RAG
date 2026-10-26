export const NOTICE_KEY = "notice.freeTier.v1";

export function hasSeenNotice(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markNoticeSeen(): void {
  try {
    window.localStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* storage unavailable: the notice may show again next visit */
  }
}
