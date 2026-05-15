(function bootCallNotifications() {
  const STYLE_ID = "global-notification-ui-style";
  const OFFER_STORAGE_KEY = "chat:incoming_offer";
  const MESSAGE_NOTIFICATION_TAG = "incoming-chat-message";
  const CALL_NOTIFICATION_TAG = "incoming-video-call";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .global-notification-stack {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2200;
        width: min(390px, calc(100vw - 24px));
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      }

      .global-toast,
      .call-alert {
        pointer-events: auto;
        border: 1px solid rgba(116, 159, 207, 0.28);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(19, 40, 63, 0.96), rgba(11, 27, 47, 0.96));
        color: #d3e3ff;
        box-shadow: 0 20px 52px rgba(0, 7, 20, 0.42);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        overflow: hidden;
        animation: global-notification-in 180ms ease-out;
      }

      .global-toast {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 12px;
      }

      .global-toast-avatar,
      .call-alert-avatar {
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: #43b8ea;
        color: #073249;
        font-weight: 800;
        box-shadow: 0 0 0 4px rgba(67, 184, 234, 0.12);
      }

      .global-toast-avatar {
        width: 44px;
        height: 44px;
        font-size: 16px;
      }

      .global-toast-main {
        min-width: 0;
      }

      .global-toast-title,
      .call-alert-title {
        color: #e3efff;
        font-size: 0.95rem;
        font-weight: 800;
        line-height: 1.2;
      }

      .global-toast-text,
      .call-alert-sub {
        margin-top: 4px;
        color: #9fb4cf;
        font-size: 0.84rem;
        line-height: 1.35;
      }

      .global-toast-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .global-toast-close {
        width: 34px;
        height: 34px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        color: #b7c8de;
        cursor: pointer;
      }

      .global-toast-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #78d2ff;
      }

      .call-alert {
        padding: 16px;
      }

      .call-alert-top {
        display: flex;
        gap: 13px;
        align-items: center;
      }

      .call-alert-avatar {
        position: relative;
        width: 52px;
        height: 52px;
        flex: 0 0 52px;
        font-size: 20px;
      }

      .call-alert-avatar::after {
        content: "";
        position: absolute;
        inset: -6px;
        border-radius: inherit;
        border: 2px solid rgba(67, 184, 234, 0.42);
        animation: call-pulse 1.35s ease-out infinite;
      }

      .call-alert-copy {
        min-width: 0;
      }

      .call-alert-actions {
        margin-top: 14px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .call-alert-btn {
        min-height: 44px;
        border: 0;
        border-radius: 14px;
        cursor: pointer;
        font-weight: 800;
        transition: transform 150ms ease, filter 150ms ease;
      }

      .call-alert-btn:hover {
        filter: brightness(1.05);
      }

      .call-alert-btn:active {
        transform: scale(0.97);
      }

      .call-alert-accept {
        background: #43b8ea;
        color: #073249;
      }

      .call-alert-decline {
        background: rgba(255, 255, 255, 0.07);
        color: #ffb4ab;
      }

      .hidden {
        display: none !important;
      }

      @keyframes global-notification-in {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes call-pulse {
        from {
          opacity: 0.75;
          transform: scale(0.86);
        }
        to {
          opacity: 0;
          transform: scale(1.28);
        }
      }

      @media (max-width: 768px) {
        .global-notification-stack {
          left: 12px;
          right: 12px;
          bottom: calc(92px + env(safe-area-inset-bottom));
          width: auto;
        }

        .global-toast,
        .call-alert {
          border-radius: 16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureStack() {
    ensureStyles();
    let stack = document.querySelector(".global-notification-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "global-notification-stack";
      stack.setAttribute("aria-live", "polite");
      stack.setAttribute("aria-relevant", "additions");
      document.body.appendChild(stack);
    }
    return stack;
  }

  function getInitial(value) {
    return String(value || "?").replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

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
        if (typeof onClick === "function") onClick();
      };
    } catch (_) {
      // Ignore browser notification failures.
    }
  }

  function navigateToChat(username) {
    const me = getCurrentUsername();
    if (me && username) {
      localStorage.setItem(`chat:last:${me}`, username);
    }
    if (window.navigateTo) {
      window.navigateTo("/chat");
    } else {
      window.location.href = "/chat";
    }
  }

  function showMessageToast(message, preview) {
    const stack = ensureStack();
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "global-toast";
    toast.innerHTML = `
      <span class="global-toast-avatar">${escapeHtml(getInitial(message.from))}</span>
      <span class="global-toast-main">
        <span class="global-toast-title">New message from @${escapeHtml(message.from)}</span>
        <span class="global-toast-text">${escapeHtml(preview)}</span>
      </span>
      <span class="global-toast-close" aria-label="Dismiss notification" role="button">&times;</span>
    `;

    toast.addEventListener("click", (event) => {
      if (event.target.closest(".global-toast-close")) {
        toast.remove();
        return;
      }
      toast.remove();
      navigateToChat(message.from);
    });

    stack.prepend(toast);
    window.setTimeout(() => toast.remove(), 6500);
  }

  function shouldShowMessageNotification(message) {
    const me = getCurrentUsername();
    if (!message?.from || !message?.to) return false;
    if (me && message.to !== me) return false;
    if (me && message.from === me) return false;

    const onChatPage = window.location.pathname === "/chat";
    const isVisible = document.visibilityState === "visible";
    const activeChat = window.__chatSelectedUser || "";
    return !onChatPage || !isVisible || activeChat !== message.from;
  }

  function notifyForMessage(message) {
    if (!shouldShowMessageNotification(message)) return;

    const isMedia = message.type === "image" || message.type === "video";
    const preview = isMedia
      ? `Sent a ${message.type}`
      : (message.message || "").trim() || "Sent a message";

    if (document.visibilityState === "visible") {
      showMessageToast(message, preview);
    }

    createBrowserNotification(`New message from @${message.from}`, {
      body: preview,
      tag: `${MESSAGE_NOTIFICATION_TAG}:${message.from}`,
      onClick: () => navigateToChat(message.from)
    });
  }

  function startCallNotifications() {
    if (window.__sovereignCallAlertsInit) return;

    if (typeof io !== "function") return;
    if (typeof getToken !== "function") return;

    const token = getToken();
    if (!token) return;

    window.__sovereignCallAlertsInit = true;

    const canShowCallBanner = window.location.pathname !== "/video";
    const existingChatSocket = window.__chatSocket;
    const socket = existingChatSocket || io({ auth: { token } });

    if (!existingChatSocket) {
      window.__globalNotificationSocket = socket;
    }

    let alertEl = null;
    let titleEl = null;
    let subEl = null;
    let avatarEl = null;
    let acceptBtn = null;
    let declineBtn = null;
    let pendingOffer = null;

    function persistOffer(offerData) {
      localStorage.setItem(OFFER_STORAGE_KEY, JSON.stringify({
        ...offerData,
        at: Date.now()
      }));
    }

    function clearOffer() {
      pendingOffer = null;
      localStorage.removeItem(OFFER_STORAGE_KEY);
      if (alertEl) alertEl.classList.add("hidden");
    }

    function showOffer(from) {
      if (!alertEl || !titleEl || !subEl || !avatarEl) return;
      avatarEl.textContent = getInitial(from);
      titleEl.textContent = `Incoming call from @${from}`;
      subEl.textContent = "Accept to join the video call now.";
      alertEl.classList.remove("hidden");

      createBrowserNotification("Incoming call", {
        body: `@${from} is calling you`,
        tag: CALL_NOTIFICATION_TAG
      });
    }

    if (canShowCallBanner) {
      const stack = ensureStack();
      alertEl = document.createElement("section");
      alertEl.className = "call-alert hidden";
      alertEl.innerHTML = `
        <div class="call-alert-top">
          <div class="call-alert-avatar" id="callAlertAvatar">?</div>
          <div class="call-alert-copy">
            <div class="call-alert-title" id="callAlertTitle">Incoming call</div>
            <div class="call-alert-sub" id="callAlertSub">Someone is calling you.</div>
          </div>
        </div>
        <div class="call-alert-actions">
          <button type="button" id="callAlertAccept" class="call-alert-btn call-alert-accept">Accept</button>
          <button type="button" id="callAlertDecline" class="call-alert-btn call-alert-decline">Decline</button>
        </div>
      `;
      stack.prepend(alertEl);

      avatarEl = alertEl.querySelector("#callAlertAvatar");
      titleEl = alertEl.querySelector("#callAlertTitle");
      subEl = alertEl.querySelector("#callAlertSub");
      acceptBtn = alertEl.querySelector("#callAlertAccept");
      declineBtn = alertEl.querySelector("#callAlertDecline");

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
    }
  }

  window.__startCallNotifications = startCallNotifications;
  startCallNotifications();
})();
