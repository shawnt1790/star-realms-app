// Thin wrapper around the Umami tracking script (loaded in index.html).
// Safe to call even if the script is blocked or hasn't loaded yet.

type UmamiWindow = Window & {
  umami?: { track: (eventName: string, data?: Record<string, unknown>) => void };
};

export function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    (window as UmamiWindow).umami?.track(eventName, data);
  } catch {
    // Analytics must never break the app.
  }
}
