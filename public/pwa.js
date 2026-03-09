(function initPwa() {
  if (!("serviceWorker" in navigator)) return;

  let deferredPrompt = null;
  const installBtn = document.getElementById("installAppBtn");
  let registrationPromise = null;

  function getRegistration() {
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register("/sw.js").catch(() => null);
    }
    return registrationPromise;
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function updateInstallButton() {
    if (!installBtn) return;
    installBtn.hidden = isStandalone() || !deferredPrompt;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function syncPushSubscription() {
    if (typeof getToken !== "function") return;
    const token = getToken();
    if (!token) return;
    if (!("PushManager" in window)) return;

    const registration = await getRegistration();
    if (!registration) return;

    let publicKey = "";
    try {
      const keyRes = await authFetch("/api/push/public-key");
      if (!keyRes.ok) return;
      const data = await keyRes.json();
      publicKey = data.publicKey || "";
    } catch (_) {
      return;
    }

    if (!publicKey) return;

    if ("Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch (_) {
        return;
      }
    }

    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const existingSubscription = await registration.pushManager.getSubscription();
    const subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await authFetch("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ subscription })
    });
  }

  window.addEventListener("load", () => {
    getRegistration();
    syncPushSubscription().catch(() => {});
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    updateInstallButton();
  });

  if (!installBtn) return;

  installBtn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (_error) {
      // Ignore; button state still gets reset below.
    }
    deferredPrompt = null;
    updateInstallButton();
  });

  updateInstallButton();
})();
