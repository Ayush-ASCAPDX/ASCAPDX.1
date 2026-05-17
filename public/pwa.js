(function initPwa() {
  if (!("serviceWorker" in navigator)) return;

  let deferredPrompt = null;
  const installBtn = document.getElementById("installAppBtn");
  const headerInstallBtn = document.getElementById("headerInstallBtn");
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
    const isHidden = isStandalone() || !deferredPrompt;
    if (installBtn) installBtn.hidden = isHidden;
    if (headerInstallBtn) {
      if (isHidden) {
        headerInstallBtn.classList.add("hidden");
      } else {
        headerInstallBtn.classList.remove("hidden");
      }
    }
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

  function showCustomInstallPopup() {
    if (typeof CookieUtil !== 'undefined') {
      CookieUtil.erase('showInstallPopupPostLogin');
    }

    if (isStandalone()) return;

    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop open";
    overlay.style.zIndex = "9999";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.3s ease";
    
    const popup = document.createElement("div");
    popup.className = "share-modal";
    popup.style.textAlign = "center";
    popup.style.padding = "32px 24px";
    popup.style.transform = "translateY(30px) scale(0.95)";
    popup.style.transition = "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    
    popup.innerHTML = `
      <div style="margin-bottom: 24px; display: flex; justify-content: center;">
        <div style="background: linear-gradient(135deg, var(--surface-2), var(--surface)); padding: 16px; border-radius: 24px; box-shadow: 0 12px 30px rgba(0,0,0,0.3); border: 1px solid var(--line);">
          <img src="/ico.png" alt="App Icon" style="width: 72px; height: 72px; border-radius: 16px; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.2));">
        </div>
      </div>
      <h2 class="modal-title" style="margin-bottom: 12px; font-size: 1.6rem; font-weight: 800; background: linear-gradient(to right, #fff, #a1a1aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Get the App</h2>
      <p style="margin-bottom: 32px; color: var(--muted); font-size: 0.95rem; line-height: 1.6;">
        Install our app on your home screen for lightning-fast access, offline support, and seamless notifications.
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="popupInstallBtn" class="modal-btn" style="background: var(--brand); border-color: var(--brand); color: #fff; font-size: 1.05rem; padding: 14px; border-radius: 16px; font-weight: 700; box-shadow: 0 6px 20px rgba(37, 99, 235, 0.4); transition: transform 0.2s, box-shadow 0.2s;">
          Install App Now
        </button>
        <button id="popupCancelBtn" class="modal-btn" style="background: transparent; border-color: transparent; color: var(--muted); font-size: 0.95rem; padding: 10px;">
          Maybe Later
        </button>
      </div>
    `;
    
    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // Trigger animations
    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      popup.style.transform = "translateY(0) scale(1)";
    });

    // Hover effects
    const installBtnEl = document.getElementById("popupInstallBtn");
    installBtnEl.addEventListener("mouseenter", () => {
      installBtnEl.style.transform = "translateY(-2px)";
      installBtnEl.style.boxShadow = "0 8px 25px rgba(37, 99, 235, 0.5)";
    });
    installBtnEl.addEventListener("mouseleave", () => {
      installBtnEl.style.transform = "translateY(0)";
      installBtnEl.style.boxShadow = "0 6px 20px rgba(37, 99, 235, 0.4)";
    });
    
    document.getElementById("popupCancelBtn").addEventListener("click", () => {
      overlay.style.opacity = "0";
      popup.style.transform = "translateY(20px) scale(0.95)";
      setTimeout(() => overlay.remove(), 300);
    });
    
    document.getElementById("popupInstallBtn").addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch (_error) {}
        deferredPrompt = null;
        updateInstallButton();
      } else {
        alert("To install the app, tap 'Share' and then 'Add to Home Screen' in your browser menu.");
      }
      overlay.style.opacity = "0";
      popup.style.transform = "translateY(20px) scale(0.95)";
      setTimeout(() => overlay.remove(), 300);
    });
  }

  window.addEventListener("load", () => {
    getRegistration();
    syncPushSubscription().catch(() => {});

    if (typeof CookieUtil !== 'undefined' && typeof getToken !== 'undefined') {
      if (getToken() && CookieUtil.get('showInstallPopupPostLogin') === 'true') {
        if (!isStandalone()) {
          setTimeout(showCustomInstallPopup, 1500);
        } else {
          CookieUtil.erase('showInstallPopupPostLogin');
        }
      }
    }
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

  if (installBtn) {
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
  }

  if (headerInstallBtn) {
    headerInstallBtn.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch (_error) {
      }
      deferredPrompt = null;
      updateInstallButton();
    });
  }

  updateInstallButton();
})();
