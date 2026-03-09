(function initCallNotifications() {
  if (window.__sovereignCallAlertsInit) return;
  window.__sovereignCallAlertsInit = true;

  if (typeof io !== "function") return;
  if (typeof getToken !== "function") return;

  const token = getToken();
  if (!token) return;

  const OFFER_STORAGE_KEY = "chat:incoming_offer";
  const MESSAGE_NOTIFICATION_TAG = "incoming-chat-message";
  const CALL_NOTIFICATION_TAG = "incoming-video-call";
  const canShowCallBanner = window.location.pathname !== "/video";
  const existingChatSocket = window.__chatSocket;
  const socket = existingChatSocket || io({ auth: { token } });

  if (!existingChatSocket) {
    window.__globalNotificationSocket = socket;
  }

  let alertEl = null;
  let titleEl = null;
  let subEl = null;
  let acceptBtn = null;
  let declineBtn = null;

  if (canShowCallBanner) {
    alertEl = document.createElement("section");
    alertEl.className = "call-alert hidden";
    alertEl.innerHTML = `
      <div class="call-alert-title" id="callAlertTitle">Incoming call</div>
      <div class="call-alert-sub" id="callAlertSub">Someone is calling you.</div>
      <div class="call-alert-actions">
        <button type="button" id="callAlertAccept" class="chat-send-btn call-alert-btn">Accept</button>
        <button type="button" id="callAlertDecline" class="danger-btn call-alert-btn">Decline</button>
      </div>
    `;
    document.body.appendChild(alertEl);

    titleEl = alertEl.querySelector("#callAlertTitle");
    subEl = alertEl.querySelector("#callAlertSub");
    acceptBtn = alertEl.querySelector("#callAlertAccept");
    declineBtn = alertEl.querySelector("#callAlertDecline");
  }

  let pendingOffer = null;

  function getCurrentUsername() {
    const raw = localStorage.getItem("user");
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      return parsed?.username || "";
    } catch (_) {
      return "";
    }
  }

  function requestNotificationPermissionIfNeeded() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    Notification.requestPermission().catch(() => {});
  }

  function createBrowserNotification(title, options) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      requestNotificationPermissionIfNeeded();
      return;
    }

    const { onClick, ...notificationOptions } = options || {};

    try {
      const notification = new Notification(title, notificationOptions);
      notification.onclick = () => {
        window.focus();
        if (typeof onClick === "function") {
          onClick();
        }
      };
    } catch (_) {
      // Ignore browser notification failures.
    }
  }

  function shouldShowMessageNotification(message) {
    const me = getCurrentUsername();
    if (!message?.from || !message?.to) return false;
    if (me && message.to !== me) return false;
    if (me && message.from === me) return false;

    const onChatPage = window.location.pathname === "/chat";
    const isVisible = document.visibilityState === "visible";
    const activeChat = window.__chatSelectedUser || "";
    if (onChatPage && isVisible && activeChat === message.from) {
      return false;
    }
    return !onChatPage || !isVisible || activeChat !== message.from;
  }

  function notifyForMessage(message) {
    if (!shouldShowMessageNotification(message)) return;

    const isMedia = message.type === "image" || message.type === "video";
    const preview = isMedia
      ? `Sent a ${message.type}`
      : (message.message || "").trim() || "Sent a message";

    createBrowserNotification(`New message from @${message.from}`, {
      body: preview,
      tag: `${MESSAGE_NOTIFICATION_TAG}:${message.from}`,
      onClick: () => {
        const me = getCurrentUsername();
        if (me) {
          localStorage.setItem(`chat:last:${me}`, message.from);
        }
        window.location.href = "/chat";
      }
    });
  }

  function persistOffer(offerData) {
    localStorage.setItem(OFFER_STORAGE_KEY, JSON.stringify({
      ...offerData,
      at: Date.now()
    }));
  }

  function clearOffer() {
    pendingOffer = null;
    localStorage.removeItem(OFFER_STORAGE_KEY);
    if (alertEl) {
      alertEl.classList.add("hidden");
    }
  }

  function showOffer(from) {
    if (!alertEl || !titleEl || !subEl) return;
    titleEl.textContent = `Incoming call from @${from}`;
    subEl.textContent = "Accept to join video now.";
    alertEl.classList.remove("hidden");

    createBrowserNotification("Incoming call", {
      body: `@${from} is calling you`,
      tag: CALL_NOTIFICATION_TAG
    });
  }

  if (canShowCallBanner) {
    socket.on("video-offer", ({ from, offer, callId }) => {
      if (!from || !offer) return;
      pendingOffer = { from, offer, callId: callId || "" };
      persistOffer(pendingOffer);
      showOffer(from);
    });

    socket.on("video-end", ({ from }) => {
      if (!pendingOffer || pendingOffer.from !== from) return;
      clearOffer();
    });

    socket.on("video-decline", ({ from }) => {
      if (!pendingOffer || pendingOffer.from !== from) return;
      clearOffer();
    });
  }

  socket.on("privateMessage", (message) => {
    notifyForMessage(message);
  });

  if (acceptBtn && declineBtn) {
    acceptBtn.addEventListener("click", () => {
      if (!pendingOffer) return;
      persistOffer(pendingOffer);
      const query = new URLSearchParams({
        with: pendingOffer.from,
        incoming: "1",
        callId: pendingOffer.callId || ""
      });
      window.location.href = `/video?${query.toString()}`;
    });

    declineBtn.addEventListener("click", () => {
      if (!pendingOffer) return;
      socket.emit("video-decline", { to: pendingOffer.from, callId: pendingOffer.callId || "" });
      clearOffer();
    });
  }

  if (canShowCallBanner) {
    (function restoreOfferIfAny() {
      const raw = localStorage.getItem(OFFER_STORAGE_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed?.from || !parsed?.offer) return;
        if (Date.now() - Number(parsed.at || 0) > 1000 * 60 * 2) return;
        pendingOffer = parsed;
        showOffer(parsed.from);
      } catch (_) {
        // Ignore malformed localStorage value.
      }
    })();
  }
})();
