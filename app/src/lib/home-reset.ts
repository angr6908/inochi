// Handshake between the nav bar and the home timeline: clicking the logo from
// another page asks the timeline to reset to page 1 (no tag) on its next mount.
// The flag is a one-shot stored in sessionStorage so it survives the navigation.
const HOME_LOGO_RESET_KEY = "inochi:home-logo-reset";

/** Nav side: request a reset before navigating home. */
export function requestHomeLogoReset() {
  try {
    sessionStorage.setItem(HOME_LOGO_RESET_KEY, "1");
  } catch {
    // Ignore storage failures; the link still navigates home normally.
  }
}

/** Timeline side: consume a pending reset request (clears it). */
export function consumeHomeLogoReset(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const shouldReset = sessionStorage.getItem(HOME_LOGO_RESET_KEY) === "1";
    if (shouldReset) sessionStorage.removeItem(HOME_LOGO_RESET_KEY);
    return shouldReset;
  } catch {
    return false;
  }
}
