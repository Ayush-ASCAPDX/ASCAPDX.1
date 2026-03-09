(function initNotificationsLoader() {
  if (window.__notificationsLoaderInit) return;
  window.__notificationsLoaderInit = true;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true" || (src.includes("socket.io") && typeof window.io === "function")) {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.body.appendChild(script);
    });
  }

  function schedule(work) {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(work, { timeout: 1500 });
      return;
    }

    window.setTimeout(work, 300);
  }

  function start() {
    schedule(async () => {
      try {
        if (typeof window.io !== "function") {
          await loadScript("/socket.io/socket.io.js");
        }
        await loadScript("/call-notifications.js");
      } catch (_) {
        // Ignore notification loader failures.
      }
    });
  }

  if (document.readyState === "complete") {
    start();
    return;
  }

  window.addEventListener("load", start, { once: true });
})();
