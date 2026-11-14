import { t } from "../ui/i18n/strings.ts";
import { assetUrl } from "../infrastructure/platform/asset-url.ts";
import { saveIfNeeded } from "./store.ts";

// Opportunistic checks only; the opening check is never throttled.
const CHECK_INTERVAL = 30 * 60 * 1000;
// The waiting worker activates promptly; past this the prompt asks for a retry.
const ACTIVATION_TIMEOUT = 5000;
const PHASE_MESSAGES: Record<string, string> = {
  applying: "updateApplying",
  activateFailed: "updateActivateFailed",
};

export async function prepareOffline(): Promise<void> {
  const banner = document.getElementById("update-banner");
  const message = document.getElementById("update-message");
  const updateButton = document.getElementById("update-now") as HTMLButtonElement | null;
  const laterButton = document.getElementById("update-later") as HTMLButtonElement | null;

  // idle | available | applying | activateFailed
  let phase = "idle";
  let registration: ServiceWorkerRegistration | null = null;
  let reloading = false;
  let lastCheck = 0;
  let activationTimer = 0;
  // A worker found by the opening check activates without a prompt.
  const automatic = new WeakSet<ServiceWorker>();

  function paint(): void {
    if (!(banner && message && updateButton && laterButton)) return;
    message.textContent = t(PHASE_MESSAGES[phase] || "updateAvailable");
    updateButton.textContent = t("updateNow");
    laterButton.textContent = t("updateLater");
  }

  function setPhase(next: string): void {
    phase = next;
    if (!(banner && message && updateButton && laterButton)) return;
    banner.dataset.state = next;
    banner.hidden = next === "idle";
    updateButton.disabled = next === "applying";
    laterButton.disabled = next === "applying";
    paint();
  }

  // The game is written best-effort: a failed write never holds an update back.
  function saved(): void {
    try {
      saveIfNeeded();
    } catch {
      /* the update proceeds; the unsaved game in memory is lost */
    }
  }

  async function activate(): Promise<void> {
    if (phase === "applying") return;
    const worker = registration?.waiting;
    if (!worker) {
      setPhase("idle");
      return;
    }
    setPhase("applying");
    // Let the applying state paint even when the tab is backgrounded.
    const painted = Promise.withResolvers<void>();
    setTimeout(painted.resolve, 0);
    await painted.promise;
    saved();
    if (!registration?.waiting) {
      setPhase("idle");
      return;
    }
    try {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } catch {
      setPhase("activateFailed");
      return;
    }
    clearTimeout(activationTimer);
    activationTimer = setTimeout(() => {
      if (phase === "applying") setPhase("activateFailed");
    }, ACTIVATION_TIMEOUT);
  }

  const languageObserver = new MutationObserver(() => paint());
  languageObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  paint();

  if (banner && message && updateButton && laterButton) {
    updateButton.addEventListener("click", activate);
    laterButton.addEventListener("click", () => {
      setPhase("idle");
    });
  }

  if (!("serviceWorker" in navigator)) {
    paint();
    return;
  }

  // The new worker already owns the cache by this point, so the reload runs
  // even when this window cannot save.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    clearTimeout(activationTimer);
    saved();
    location.reload();
  });

  try {
    const reg = await navigator.serviceWorker.register(assetUrl("sw.js"), {
      updateViaCache: "none",
    });
    registration = reg;
    const installed = (worker: ServiceWorker): void => {
      if (worker.state !== "installed") return;
      if (!navigator.serviceWorker.controller) return;
      if (phase === "applying" || phase === "activateFailed") return;
      setPhase("available");
      if (automatic.has(worker)) void activate();
    };
    const watch = (worker: ServiceWorker | null | undefined): void => {
      if (!worker) return;
      installed(worker);
      worker.addEventListener("statechange", () => installed(worker));
    };
    const adopt = (): void => {
      for (const worker of [reg.installing, reg.waiting]) if (worker) automatic.add(worker);
    };
    watch(reg.installing);
    // An install can finish before this event is delivered, which leaves
    // `installing` empty while the worker already waits.
    reg.addEventListener("updatefound", () => watch(reg.installing ?? reg.waiting));

    // The opening check keeps the app current: it runs before the throttle, and
    // the worker it installs activates without a prompt.
    adopt();
    lastCheck = Date.now();
    await reg.update().catch(() => {});
    adopt();
    watch(reg.installing);
    if (reg.waiting) installed(reg.waiting);

    // Check when the app becomes visible or comes back online. The interval is
    // the only timer and is throttled by CHECK_INTERVAL.
    const checkForUpdate = (force = false): void => {
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastCheck < CHECK_INTERVAL) return;
      lastCheck = now;
      reg.update().catch(() => {});
    };
    window.addEventListener("online", () => checkForUpdate(true));
    window.addEventListener("pageshow", () => checkForUpdate());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdate();
    });
    setInterval(() => checkForUpdate(), CHECK_INTERVAL);
  } catch {
    paint();
  }
}
