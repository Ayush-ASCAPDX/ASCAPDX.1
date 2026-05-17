(function () {
  let socket;
  let currentUser, me;
  let selectedUser = "";
  let usersPresence = {};
  let unreadCounts = {};
  let cachedRecommendedUsernames = null;
  let userSearchTerm = "";
  let isAtBottom = true;
  let chatHasMoreHistory = false;
  let chatHistoryLoading = false;
  let chatOldestTimestamp = "";
  let shouldPinToLatestOnOpen = false;

  // DOM references used across multiple functions
  let usersListEl, currentUserEl, chatWithEl, messagesEl, presenceTextEl, videoCallBtn, deleteConversationBtn, chatMenuBtn, chatMenu, backToChatsBtn, sendBtn, attachBtn, fileInputEl, fileLoaderEl, userSearchInput, messageInputEl, composerMetaEl, scrollToBottomBtn, chatErrorPopupEl, chatErrorPopupTextEl, typingIndicatorEl;
  let messageContextMenu, ctxEditBtn, ctxReplyBtn, ctxForwardBtn, ctxCopyBtn, ctxDeleteBtn, editIndicator, cancelEditBtn, replyIndicator, cancelReplyBtn, replyTargetUser, replyTargetText, forwardModal, forwardUserList, closeForwardModalBtn;
  let chatHeaderConnectBtn;
  let changeThemeBtn, themeModal, closeThemeModal, chatLayoutEl;
  let mobileTabletQuery = window.matchMedia("(max-width: 990px)");
  let replyingToMsg = null, currentForwardMessage = null, isSendingFile = false, pendingFileSend = null, chatErrorPopupTimer = null;

  const conversationCache = new Map();
  const CONVERSATION_CACHE_MAX_PER_CHAT = 120;
  const CONVERSATION_CACHE_MAX_CHATS = 40;
  const CONVERSATION_CACHE_STORAGE_PREFIX = "chat:conversation-cache:";
  let cachePersistTimer = null;
  const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024;
  const MAX_IMAGE_DIMENSION = 1920;
  let typingStatus = {
    target: "",
    active: false,
    timeoutId: null
  };
  const IMAGE_COMPRESSION_TRIGGER_BYTES = 8 * 1024 * 1024;
  let editingId = null;
  let longPressTimer = null;
  const IMAGE_COMPRESSION_ALWAYS_THRESHOLD_BYTES = 20 * 1024 * 1024;
  const IMAGE_COMPRESSION_MIN_SAVINGS = 0.1;
  const timeFormatter = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
  const USER_LIST_BATCH_SIZE = 40;

  function uploadFileWithProgress(file, fileKind, uploadName = file?.name || "upload") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.responseType = "text";

      const token = getToken();
      if (token) {
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      }

      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(uploadName));
      xhr.setRequestHeader("X-File-Kind", fileKind);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        setFileSendingState(true, `Uploading ${uploadName}... ${percent}%`);
      };

      xhr.onerror = () => {
        reject(new Error("Upload failed. Network error."));
      };

      xhr.onabort = () => {
        reject(new Error("Upload cancelled."));
      };

      xhr.onload = () => {
        const rawResponse = xhr.responseText || "";
        let responseData = {};

        try {
          responseData = rawResponse ? JSON.parse(rawResponse) : {};
        } catch (_) {
          responseData = {};
        }

        if (xhr.status === 401) {
          logout();
          reject(new Error("Unauthorized"));
          return;
        }

        if (xhr.status < 200 || xhr.status >= 300 || !responseData.url) {
          reject(new Error(responseData.error || rawResponse || "Failed to upload file."));
          return;
        }

        resolve(responseData);
      };

      xhr.send(file);
    });
  }

  function renameFileExtension(filename, extension) {
    const baseName = String(filename || "image")
      .replace(/\.[^./\\]+$/, "")
      .trim();
    return `${baseName || "image"}.${extension}`;
  }

  function blobToImage(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob).then((bitmap) => ({
        width: bitmap.width,
        height: bitmap.height,
        draw(context, width, height) {
          context.drawImage(bitmap, 0, 0, width, height);
        },
        close() {
          bitmap.close();
        }
      }));
    }

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.naturalWidth,
          height: image.naturalHeight,
          draw(context, width, height) {
            context.drawImage(image, 0, 0, width, height);
          },
          close() {
            URL.revokeObjectURL(objectUrl);
          }
        });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Failed to read image."));
      };
      image.src = objectUrl;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Failed to process image."));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
  }

  function shouldPreferSmallerUpload() {
    const effectiveType = navigator?.connection?.effectiveType || "";
    return effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g";
  }

  async function prepareUploadPayload(file) {
    if (!file.type.startsWith("image/")) {
      return {
        file,
        uploadName: file.name
      };
    }

    const shouldCompress =
      file.size > IMAGE_COMPRESSION_ALWAYS_THRESHOLD_BYTES ||
      (file.size > IMAGE_COMPRESSION_TRIGGER_BYTES && shouldPreferSmallerUpload()) ||
      file.type === "image/heic" ||
      file.type === "image/heif";

    if (!shouldCompress && typeof createImageBitmap !== "function") {
      return {
        file,
        uploadName: file.name
      };
    }

    let source;
    try {
      source = await blobToImage(file);
      const largestSide = Math.max(source.width, source.height);
      const scale = largestSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / largestSide : 1;
      const targetWidth = Math.max(1, Math.round(source.width * scale));
      const targetHeight = Math.max(1, Math.round(source.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        return {
          file,
          uploadName: file.name
        };
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      source.draw(context, targetWidth, targetHeight);

      const outputType = shouldPreferSmallerUpload()
        ? (file.type === "image/png" || file.type === "image/webp" ? "image/webp" : "image/jpeg")
        : file.type;
      const quality = outputType === "image/jpeg" ? 0.82 : outputType === "image/webp" ? 0.8 : 0.92;

      const blob = await canvasToBlob(canvas, outputType, quality);
      const savings = 1 - (blob.size / file.size);
      const resized = targetWidth !== source.width || targetHeight !== source.height;
      if (resized || savings >= IMAGE_COMPRESSION_MIN_SAVINGS) {
        const extension = outputType === "image/webp"
          ? "webp"
          : outputType === "image/jpeg"
            ? "jpg"
            : file.name.split(".").pop() || "image";
        return {
          file: blob,
          uploadName: renameFileExtension(file.name, extension)
        };
      }
    } catch (_) {
      return {
        file,
        uploadName: file.name
      };
    } finally {
      if (source) {
        source.close();
      }
    }

    return {
      file,
      uploadName: file.name
    };
  }

  async function init() {
    if (window.__chatPageAbortController) {
      window.__chatPageAbortController.abort();
    }
    const initAbortController = new AbortController();
    window.__chatPageAbortController = initAbortController;
    window.__chatInitId = (window.__chatInitId || 0) + 1;
    const initId = window.__chatInitId;
    const eventOptions = { signal: initAbortController.signal };
    const listen = (target, type, handler, options = {}) => {
      if (!target) return;
      target.addEventListener(type, handler, { ...options, signal: initAbortController.signal });
    };

    me = await requireAuth();
    if (window.__chatPageAbortController !== initAbortController) return;
    // Assign DOM elements to module-scoped variables
    usersListEl = document.getElementById("usersList");
    currentUserEl = document.getElementById("currentUser");
    chatWithEl = document.getElementById("chatWith");
    messagesEl = document.getElementById("messages");
    presenceTextEl = document.getElementById("presenceText");
    videoCallBtn = document.getElementById("videoCallBtn");
    deleteConversationBtn = document.getElementById("deleteConversationBtn");
    chatMenuBtn = document.getElementById("chatMenuBtn");
    chatMenu = document.getElementById("chatMenu");
    backToChatsBtn = document.getElementById("backToChatsBtn");
    sendBtn = document.getElementById("sendBtn");
    attachBtn = document.getElementById("attachBtn");
    fileInputEl = document.getElementById("fileInput");
    fileLoaderEl = document.getElementById("fileLoader");
    userSearchInput = document.getElementById("userSearchInput");
    changeThemeBtn = document.getElementById("changeThemeBtn");
    themeModal = document.getElementById("themeModal");
    closeThemeModal = document.getElementById("closeThemeModal");
    chatLayoutEl = document.getElementById("chatLayout");
    messageInputEl = document.getElementById("messageInput");
    composerMetaEl = document.getElementById("composerMeta");
    scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
    chatErrorPopupEl = document.getElementById("chatErrorPopup");
    chatErrorPopupTextEl = document.getElementById("chatErrorPopupText");
    typingIndicatorEl = document.getElementById("typingIndicator");
    chatHeaderConnectBtn = document.getElementById("chatHeaderConnectBtn");

    messageContextMenu = document.getElementById("messageContextMenu");
    ctxEditBtn = document.getElementById("ctxEditBtn");
    ctxReplyBtn = document.getElementById("ctxReplyBtn");
    ctxForwardBtn = document.getElementById("ctxForwardBtn");
    ctxCopyBtn = document.getElementById("ctxCopyBtn");
    ctxDeleteBtn = document.getElementById("ctxDeleteBtn");
    editIndicator = document.getElementById("editIndicator");
    cancelEditBtn = document.getElementById("cancelEditBtn");
    replyIndicator = document.getElementById("replyIndicator");
    cancelReplyBtn = document.getElementById("cancelReplyBtn");
    replyTargetUser = document.getElementById("replyTargetUser");
    replyTargetText = document.getElementById("replyTargetText");
    forwardModal = document.getElementById("forwardModal");
    forwardUserList = document.getElementById("forwardUserList");
    closeForwardModalBtn = document.getElementById("closeForwardModalBtn");

    // Re-initialize global-like variables that depend on DOM elements
    replyingToMsg = null; // Reset reply state on page load
    currentForwardMessage = null; // Reset forward state on page load
    isSendingFile = false; // Reset file sending state
    pendingFileSend = null; // Reset pending file
    chatErrorPopupTimer = null; // Reset error popup timer

    if (!me) return;

    currentUser = me.username;
    currentUserEl.innerText = `Logged in: @${me.username}`;
    applyChatBackground(null); // Apply global theme on load
    hydrateConversationCache();

    if (window.__chatSocket) {
      window.__chatSocket.close();
    }
    socket = io({ auth: { token: getToken() } });
    window.__chatSocket = socket;

    socket.on("presence", (presence) => {
      mergePresenceUpdate(presence);
      renderUsers();
      updatePresenceIndicator();
    });

    socket.on("chatHistory", ({ withUser = "", before = "", messages = [], hasMore = false } = {}) => {
      if (window.__chatInitId !== initId) return;
      const activeChatUser = getActiveChatUser();
      if (!activeChatUser || withUser !== activeChatUser) return;

      const loadingOlder = !!before;
      chatHistoryLoading = false;
      setOlderHistoryLoader(false);
      chatHasMoreHistory = !!hasMore;

      if (!loadingOlder) {
        messagesEl.innerHTML = "";
        if (!messages.length) {
          renderEmptyState("No messages yet", "Start the conversation with a quick hello.");
          chatOldestTimestamp = "";
          setConversationCache(withUser, {
            loaded: true,
            messages: [],
            hasMore: !!hasMore,
            oldestTimestamp: ""
          });
          return;
        }

        renderMessageBatch(messages);
        chatOldestTimestamp = getOldestTimestamp(messages);
        setConversationCache(withUser, {
          loaded: true,
          messages: [...messages],
          hasMore: !!hasMore,
          oldestTimestamp: chatOldestTimestamp
        });
        if (shouldPinToLatestOnOpen) {
          pinToLatestMessage();
          shouldPinToLatestOnOpen = false;
        } else {
          scrollToBottom();
        }
        return;
      }

      if (!messages.length) {
        updateConversationCache(withUser, (entry) => ({
          ...entry,
          hasMore: !!hasMore
        }));
        return;
      }

      removeEmptyState();
      prependMessageBatch(messages);
      chatOldestTimestamp = getOldestTimestamp(messages) || chatOldestTimestamp;
      updateConversationCache(withUser, (entry) => {
        const existing = Array.isArray(entry?.messages) ? entry.messages : [];
        const merged = mergeUniqueById(messages, existing);
        return {
          loaded: true,
          messages: merged,
          hasMore: !!hasMore,
          oldestTimestamp: getOldestTimestamp(merged) || chatOldestTimestamp
        };
      });
    });

    socket.on("privateMessage", (message) => {
      if (window.__chatInitId !== initId) return;
      const chatUser = getConversationUserFromMessage(message);
      if (chatUser) {
        updateConversationCache(chatUser, (entry) => {
          const existing = Array.isArray(entry?.messages) ? entry.messages : [];
          const merged = mergeUniqueById(existing, [message]);
          return {
            loaded: true,
            messages: merged,
            hasMore: !!entry?.hasMore,
            oldestTimestamp: getOldestTimestamp(merged) || entry?.oldestTimestamp || ""
          };
        });
      }

      const activeChatUser = getActiveChatUser();
      const inOpenChat =
        (message.from === activeChatUser && message.to === currentUser) ||
        (message.from === currentUser && message.to === activeChatUser);

      if (inOpenChat) {
        removeEmptyState();
        renderMessage(message);
        scrollToBottom();
      } else if (message.from !== currentUser && message.to === currentUser) {
        unreadCounts[message.from] = (unreadCounts[message.from] || 0) + 1;
        renderUsers();
      }

      if (
        pendingFileSend &&
        message.from === currentUser &&
        (message.type === "image" || message.type === "video") &&
        message.clientId &&
        message.clientId === pendingFileSend.clientId
      ) {
        clearFileStatus();
      }
    });

    socket.on("messageReacted", ({ messageId, reactions }) => {
      const row = document.querySelector(`[data-mid='${messageId}']`);
      if (row) {
        renderReactions(row, reactions);
      }
      patchMessageInCache(messageId, (item) => ({
        ...item,
        reactions: reactions || []
      }));
    });

    socket.on("messageEdited", (message) => {
      updateMessageInUI(message);
      patchMessageInCache(message._id, (item) => ({
        ...item,
        ...message
      }));
    });

    socket.on("typingStatus", ({ from, typing }) => {
      if (!selectedUser || selectedUser !== from) return;
      setTypingIndicatorState(Boolean(typing));
    });

    listen(sendBtn, "click", sendTextMessage);
    if (messageInputEl) {
      listen(messageInputEl, "input", onComposerInputAndResize);
      listen(messageInputEl, "keydown", onComposerKeydown);
      listen(messageInputEl, "blur", () => {
        if (!selectedUser) return;
        emitTypingSignal(false);
        if (typingStatus.timeoutId) {
          clearTimeout(typingStatus.timeoutId);
          typingStatus.timeoutId = null;
        }
        if (editingId) exitEditMode();
      });
    }
    listen(userSearchInput, "input", onUserSearchInput);
    listen(scrollToBottomBtn, "click", () => scrollToBottom(true));
    listen(messagesEl, "scroll", onMessagesScroll);

    const setBtn = document.getElementById("settingsBtn");
    listen(setBtn, "click", () => {
      if (window.navigateTo) window.navigateTo("/settings"); else window.location.href = "/settings";
    });

    const profBtn = document.getElementById("profileBtn");
    listen(profBtn, "click", () => {
      if (window.navigateTo) window.navigateTo("/profile"); else window.location.href = "/profile";
    });

    const grpBtn = document.getElementById("groupsBtn");
    listen(grpBtn, "click", () => {
      if (window.navigateTo) window.navigateTo("/groups"); else window.location.href = "/groups";
    });

    const logBtn = document.getElementById("logoutBtn");
    listen(logBtn, "click", logout);

    if (attachBtn) {
      listen(attachBtn, "click", () => {
        if (isSendingFile) return;
        if (!getActiveChatUser()) { alert("Select a user first"); return; }
        fileInputEl.click();
      });
    }

    listen(fileInputEl, "change", sendMediaMessage);

    if (videoCallBtn) {
      listen(videoCallBtn, "click", () => {
        const activeChatUser = getActiveChatUser();
        if (!activeChatUser) return;
        const url = `/video?with=${encodeURIComponent(activeChatUser)}&autostart=1`;
        if (window.navigateTo) window.navigateTo(url); else window.location.href = url;
      });
    }

    listen(cancelEditBtn, "click", exitEditMode);
    listen(closeForwardModalBtn, "click", closeForwardModal);
    if (forwardModal) forwardModal.onclick = (e) => { if (e.target === forwardModal) closeForwardModal(); };

    listen(cancelReplyBtn, "click", exitReplyMode);
    listen(deleteConversationBtn, "click", deleteConversation);

    if (chatMenuBtn && chatMenu) {
      listen(chatMenuBtn, "click", (event) => {
        event.stopPropagation();
        chatMenu.classList.toggle("hidden");
      });
    }

    if (changeThemeBtn) {
      listen(changeThemeBtn, "click", (event) => {
        event.stopPropagation();
        if (themeModal) themeModal.classList.remove("hidden");
        if (chatMenu) chatMenu.classList.add("hidden");
      });
    }

    if (closeThemeModal) {
      listen(closeThemeModal, "click", () => {
        if (themeModal) themeModal.classList.add("hidden");
      });
    }

    // Background option clicks
    document.querySelectorAll(".theme-option").forEach(opt => {
      listen(opt, "click", async () => {
        const theme = opt.getAttribute("data-theme");
        const activeChat = selectedUser;
        
        // Apply locally immediately
        applyChatBackground(activeChat, theme);
        
        // Update local 'me' object immediately
        if (me) {
          if (activeChat) {
            if (!me.chatBackgrounds) me.chatBackgrounds = {};
            me.chatBackgrounds[activeChat] = theme;
          } else {
            me.globalChatBackground = theme;
          }
        }
        
        if (themeModal) themeModal.classList.add("hidden");
        
        // Save to backend
        try {
          const payload = { background: theme };
          if (activeChat) {
            payload.withUser = activeChat;
          } else {
            // If no chat is active (should be blocked by guard anyway), 
            // we could explicitly request global, but the user wants per-person.
            payload.isGlobal = true; 
          }

          const res = await authFetch("/api/chat-background", {
            method: "PUT",
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const data = await res.json();
            if (me) {
              me.globalChatBackground = data.globalChatBackground;
              me.chatBackgrounds = data.chatBackgrounds;
              localStorage.setItem("user", JSON.stringify(me));
            }
          }
        } catch (err) {
          console.error("Failed to save background:", err);
        }
      });
    });

    listen(backToChatsBtn, "click", returnToChatsList);

    listen(document, "click", (e) => {
      if (messageContextMenu && !messageContextMenu.contains(e.target)) hideContextMenu();
      if (chatMenu && !chatMenuBtn.contains(e.target)) chatMenu.classList.add("hidden");
      
      // Close theme modal if clicking exactly on the backdrop
      if (themeModal && e.target === themeModal) {
        themeModal.classList.add("hidden");
      }
    });

    if (mobileTabletQuery.addEventListener) {
      mobileTabletQuery.addEventListener("change", applyResponsiveShellState, eventOptions);
    }

    await loadUsersFromApi(initId);
    if (window.__chatPageAbortController !== initAbortController) return;
    applyResponsiveShellState();
    updateComposerMeta();
    restoreLastChat();
  }

  // Expose init for SPA loader
  window.initChatPage = init;

  // Initialize if elements are present
  if (document.getElementById("usersList")) {
    init();
  }

  function mergePresenceUpdate(presence) {
    const nextPresence = presence || {};
    const onlineUsernames = new Set(Object.keys(nextPresence));

    Object.keys(usersPresence).forEach((username) => {
      if (onlineUsernames.has(username)) return;
      usersPresence[username] = {
        ...usersPresence[username],
        online: false
      };
    });

    Object.entries(nextPresence).forEach(([username, user]) => {
      usersPresence[username] = {
        ...(usersPresence[username] || {}),
        ...user,
        online: !!user?.online
      };
    });
  }

  async function loadUsersFromApi(initId = window.__chatInitId) {
    const res = await authFetch("/api/users");
    if (initId !== window.__chatInitId) return;
    if (!res.ok) {
      console.error("Failed to load users from API:", res.status, res.statusText);
      return;
    }
    const users = await res.json();
    if (initId !== window.__chatInitId) return;

    users.forEach((u) => {
      if (!usersPresence[u.username]) {
        usersPresence[u.username] = {
          username: u.username,
          name: u.name,
          avatarUrl: u.avatarUrl || "",
          privateChat: !!u.privateChat,
          online: false
        };
      } else {
        usersPresence[u.username].name = u.name || usersPresence[u.username].name || u.username;
        usersPresence[u.username].avatarUrl = u.avatarUrl || usersPresence[u.username].avatarUrl || "";
        usersPresence[u.username].privateChat = !!u.privateChat;
      }
    });

    renderUsers();
  }

  function renderUsers() {
    const following = new Set(Array.isArray(me.following) ? me.following : []);
    const followers = new Set(Array.isArray(me.followers) ? me.followers : []);
    
    let filteredUsernames = Object.keys(usersPresence)
      .filter((u) => u !== currentUser)
      .filter((u) => {
        if (!userSearchTerm) return true;
        const name = usersPresence[u]?.name || "";
        return `${u} ${name}`.toLowerCase().includes(userSearchTerm);
      });

    if (!filteredUsernames.length) {
      usersListEl.innerHTML = "<div class='empty-state'>No chats match your search.</div>";
      return;
    }

    const contacts = [];
    const others = [];
    
    filteredUsernames.forEach(u => {
      if (following.has(u) || followers.has(u)) {
        contacts.push(u);
      } else {
        others.push(u);
      }
    });

    contacts.sort();
    
    let recommended = [];
    if (userSearchTerm) {
      recommended = others.sort();
    } else {
      if (!cachedRecommendedUsernames && others.length > 0) {
        cachedRecommendedUsernames = others.sort(() => 0.5 - Math.random()).slice(0, 5);
      }
      if (cachedRecommendedUsernames) {
        recommended = cachedRecommendedUsernames.filter(u => others.includes(u));
      }
    }

    const fragment = document.createDocumentFragment();

    if (contacts.length > 0) {
      const header = document.createElement("div");
      header.className = "sidebar-section-header";
      header.textContent = "Your Contacts";
      header.style.cssText = "padding: 12px 16px 8px; font-size: 0.75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;";
      fragment.appendChild(header);
      
      contacts.forEach(u => fragment.appendChild(buildUserRow(u)));
    }

    if (recommended.length > 0) {
      const header = document.createElement("div");
      header.className = "sidebar-section-header";
      header.textContent = userSearchTerm ? "Other Users" : "Recommended";
      header.style.cssText = "padding: 16px 16px 8px; font-size: 0.75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em;";
      fragment.appendChild(header);
      
      recommended.forEach(u => fragment.appendChild(buildUserRow(u)));
    }

    usersListEl.replaceChildren(fragment);
  }

  function buildUserRow(username) {
    const user = usersPresence[username];
    const div = document.createElement("div");
    div.className = `session-item ${selectedUser === username ? "active" : ""}`;

    const nameText = user?.name ? `${user.name} (@${username})` : `@${username}`;
    const status = user?.online ? "Online" : "Offline";
    const unreadCount = unreadCounts[username] || 0;
    const unreadBadge = unreadCount ? `<span class="unread-badge">${unreadCount > 99 ? "99+" : unreadCount}</span>` : "";
    const presenceClass = user?.online ? "presence-dot online" : "presence-dot";
    const avatar = user?.avatarUrl
      ? `<img class="session-avatar" src="${escapeHtml(user.avatarUrl)}" alt="@${username}" loading="lazy" decoding="async">`
      : `<div class="session-avatar session-avatar-fallback">${escapeHtml((user?.name || username || "?").slice(0, 1).toUpperCase())}</div>`;

    div.innerHTML = `
    ${avatar}
    <div class="session-title">${nameText}</div>
    <div class="${presenceClass}" aria-hidden="true"></div>
    <div class="session-sub">${status}</div>
    ${unreadBadge}
  `;

    div.onclick = () => {
      openConversation(username, nameText);
    };

    const avatarEl = div.querySelector(".session-avatar");
    if (avatarEl) {
      avatarEl.onclick = (e) => {
        e.stopPropagation();
        if (window.navigateTo) window.navigateTo(`/user-profile?username=${encodeURIComponent(username)}`); else window.location.href = `/user-profile?username=${encodeURIComponent(username)}`;
      };
    }

    return div;
  }

  function updatePresenceIndicator() {
    if (!selectedUser) {
      if (presenceTextEl) presenceTextEl.textContent = "Offline";
      if (videoCallBtn) videoCallBtn.disabled = true;
      if (deleteConversationBtn) deleteConversationBtn.disabled = true;
      if (chatMenuBtn) chatMenuBtn.disabled = true;
      updateChatHeaderAvatar(null, false);
      return;
    }

    const user = usersPresence[selectedUser];
    const isOnline = !!user?.online;
    if (presenceTextEl) presenceTextEl.textContent = isOnline ? "Online" : "Offline";
    if (videoCallBtn) videoCallBtn.disabled = !isOnline;
    if (deleteConversationBtn) deleteConversationBtn.disabled = false;
    if (chatMenuBtn) chatMenuBtn.disabled = false;
    updateChatHeaderAvatar(user, isOnline);
  }

  function updateChatHeaderAvatar(user, isOnline) {
    const wrap = document.getElementById("chatPartnerAvatar");
    const dotEl = document.getElementById("chatOnlineDot");
    if (!wrap) return;

    // Online dot
    if (dotEl) {
      dotEl.classList.toggle("visible", !!isOnline);
    }

    if (!user) {
      wrap.innerHTML = '<div class="chat-partner-avatar-initials">?</div>';
      return;
    }

    const name = user.name || selectedUser || "?";
    const initials = name.slice(0, 2).toUpperCase();

    if (user.avatarUrl) {
      const img = document.createElement("img");
      img.src = user.avatarUrl;
      img.alt = name;
      img.className = "chat-partner-avatar-img";
      img.onerror = function () {
        wrap.innerHTML = `<div class="chat-partner-avatar-initials">${initials}</div>`;
      };
      wrap.innerHTML = "";
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = `<div class="chat-partner-avatar-initials">${initials}</div>`;
    }
  }

  function openChatOnMobileIfNeeded() {
    if (!mobileTabletQuery.matches) return;
    document.body.classList.add("mobile-chat-open");
  }

  function returnToChatsList() {
    if (!mobileTabletQuery.matches) return;
    document.body.classList.remove("mobile-chat-open");
  }

  function applyResponsiveShellState() {
    if (!mobileTabletQuery.matches) {
      document.body.classList.remove("mobile-chat-open");
      updateComposerMeta();
      return;
    }

    if (selectedUser) {
      document.body.classList.add("mobile-chat-open");
    } else {
      document.body.classList.remove("mobile-chat-open");
    }
    updateComposerMeta();
  }

  async function deleteConversation() {
    if (!selectedUser) return;
    chatMenu.classList.add("hidden");

    const ok = confirm(`Delete all messages with @${selectedUser}?`);
    if (!ok) return;

    const res = await authFetch(`/api/conversations/${selectedUser}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Failed to delete conversation");
      return;
    }

    messagesEl.innerHTML = "";
    renderEmptyState("Conversation deleted", "You can still send a new message anytime.");
    conversationCache.delete(selectedUser);
    scheduleConversationCachePersist();
    socket.emit("deleteConversation", { withUser: selectedUser });
  }

  function getActiveChatUser() {
    return selectedUser || window.__chatSelectedUser || "";
  }

  function sendTextMessage() {
    if (isSendingFile) return;

    const msg = messageInputEl.value.trim();
    const activeChatUser = getActiveChatUser();

    if (!activeChatUser && !editingId) { // If editing, selectedUser might not be relevant for the message target
      alert("Select a user first");
      return;
    }

    if (!msg) return;

    socket.emit("privateMessage", {
      to: activeChatUser, // Target user for new message
      message: msg, // Message content
      type: "text", // Message type
      ...(editingId && { messageId: editingId }), // Include messageId if editing
      ...(replyingToMsg && { replyTo: replyingToMsg._id })
    });

    messageInputEl.value = "";
    storeDraft("");
    onComposerInputAndResize();
    emitTypingSignal(false);

    if (replyingToMsg) {
      exitReplyMode();
    }

    if (editingId) {
      exitEditMode();
    }
  }

  function updateMessageInUI(message) {
    const bubble = document.querySelector(`[data-mid='${message._id}'] .message-content`);
    if (bubble) {
      bubble.textContent = `${message.message} (edited)`;
    }
  }

  function setTypingIndicatorState(visible) {
    if (!typingIndicatorEl) return;
    typingIndicatorEl.classList.toggle("hidden", !visible);
  }

  function emitTypingSignal(active, target = selectedUser) {
    if (!socket || !target) return;
    if (typingStatus.target === target && typingStatus.active === active) return;

    typingStatus.target = target;
    typingStatus.active = active;

    socket.emit("typingStatus", { to: target, typing: Boolean(active) });
  }

  function clearTypingActivity() {
    if (typingStatus.timeoutId) {
      clearTimeout(typingStatus.timeoutId);
      typingStatus.timeoutId = null;
    }
    if (typingStatus.active && typingStatus.target) {
      emitTypingSignal(false, typingStatus.target);
    }
    typingStatus.target = "";
    typingStatus.active = false;
    setTypingIndicatorState(false);
  }

  async function sendMediaMessage(event) {
    const file = event.target.files[0];
    event.target.value = "";
    const activeChatUser = getActiveChatUser();

    if (!file || !activeChatUser) return;
    if (isSendingFile) return;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const errorMessage = "File must be 300 MB or smaller.";
      setFileErrorState(errorMessage);
      showErrorPopup(errorMessage);
      return;
    }

    const clientId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const isVideo = file.type.startsWith("video/");
    const fileKind = isVideo ? "video" : "image";
    pendingFileSend = {
      clientId,
      fileName: file.name
    };
    setFileSendingState(true, `Preparing ${file.name}...`);

    try {
      const preparedUpload = await prepareUploadPayload(file);
      const uploadData = await uploadFileWithProgress(preparedUpload.file, fileKind, preparedUpload.uploadName);
      setFileSendingState(true, `Processing ${file.name}... 100%`);

      socket.emit("privateMessage", {
        clientId,
        to: activeChatUser,
        type: fileKind,
        mediaUrl: uploadData.url,
        message: file.name
      });
    } catch (error) {
      const errorMessage = error?.message || "Failed to upload file.";
      setFileErrorState(errorMessage);
      showErrorPopup(errorMessage);
    }
  }

  function renderMessage(message) {
    const row = buildMessageRow(message);
    if (!row) return;
    messagesEl.appendChild(row);
  }

  function renderMessageBatch(messages) {
    const fragment = document.createDocumentFragment();
    messages.forEach((message) => {
      const row = buildMessageRow(message);
      if (row) {
        fragment.appendChild(row);
      }
    });
    messagesEl.replaceChildren(fragment);
  }

  function setOlderHistoryLoader(visible, text = "Loading older messages...") {
    const existing = messagesEl.querySelector(".history-loader");
    if (visible) {
      if (existing) return;
      const loader = document.createElement("div");
      loader.className = "history-loader";
      loader.textContent = text;
      messagesEl.prepend(loader);
      return;
    }
    if (existing) {
      existing.remove();
    }
  }

  function prependMessageBatch(messages) {
    const previousHeight = messagesEl.scrollHeight;
    const fragment = document.createDocumentFragment();
    messages.forEach((message) => {
      const row = buildMessageRow(message);
      if (row) {
        fragment.appendChild(row);
      }
    });
    messagesEl.prepend(fragment);
    const delta = messagesEl.scrollHeight - previousHeight;
    messagesEl.scrollTop += delta;
  }

  function buildMessageRow(message) {
    const row = document.createElement("div");
    row.className = `message-row ${message.from === currentUser ? "message-user-row" : "message-assistant-row"}`;
    row.dataset.mid = message._id;

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${message.from === currentUser ? "message-user" : "message-assistant"}`;

    // Render Reply Preview
    if (message.replyTo) {
      const chatUser = getConversationUserFromMessage(message);
      const entry = getConversationCache(chatUser);
      const parent = entry?.messages?.find(m => m._id === message.replyTo);

      const replyPreview = document.createElement("div");
      replyPreview.style.cssText = "margin-bottom: 8px; padding: 6px 8px; border-left: 3px solid var(--brand); background: rgba(0,0,0,0.1); border-radius: 4px; font-size: 0.75rem; cursor: pointer; color: inherit;";

      const sender = parent ? `@${parent.from}` : "Original message";
      const snippet = parent ? (parent.message || (parent.type === 'image' ? 'Photo' : 'Video')) : "Click to view context";

      replyPreview.innerHTML = `
      <div style="font-weight: bold; opacity: 0.8;">${sender}</div>
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.7;">${escapeHtml(snippet)}</div>
    `;

      replyPreview.onclick = (e) => {
        e.stopPropagation();
        const target = document.querySelector(`[data-mid='${message.replyTo}']`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
      bubble.appendChild(replyPreview);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    const isMediaMessage = message.type === "image" || message.type === "video";

    // Media content
    if (isMediaMessage) {
      bubble.classList.add("message-media-bubble");
      content.classList.add("message-media-content");
    }

    if (message.type === "image") {
      const img = document.createElement("img");
      img.src = message.mediaUrl;
      img.className = "chat-media";
      img.loading = "lazy";
      img.decoding = "async";
      content.appendChild(img);
      content.appendChild(createMediaDownloadLink(message));
    } else if (message.type === "video") {
      const video = document.createElement("video");
      video.src = message.mediaUrl;
      video.className = "chat-media";
      video.preload = "metadata";
      video.controls = true;
      content.appendChild(video);
      content.appendChild(createMediaDownloadLink(message));
    } else {
      content.textContent = message.edited ? `${message.message} (edited)` : message.message;
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = formatTime(message.timestamp);

    bubble.appendChild(content);

    const reactionsContainer = document.createElement("div");
    reactionsContainer.className = "message-reactions";
    bubble.appendChild(reactionsContainer);
    renderReactions(row, message.reactions || []);

    bubble.appendChild(meta);

    // Context Menu Event Listeners (Right-click & Long-press)
    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(message, e.pageX, e.pageY, bubble);
    });

    bubble.addEventListener("touchstart", (e) => {
      longPressTimer = setTimeout(() => showContextMenu(message, e.touches[0].pageX, e.touches[0].pageY, bubble), 500);
    }, { passive: true });
    bubble.addEventListener("touchend", () => clearTimeout(longPressTimer));
    bubble.addEventListener("touchmove", () => clearTimeout(longPressTimer));

    row.appendChild(bubble);
    return row;
  }

  function showContextMenu(message, x, y, bubbleEl) {
    // Only show edit/delete for own text messages
    const isMyMessage = message.from === currentUser;
    const isTextMessage = message.type === "text";

    ctxEditBtn.style.display = (isMyMessage && isTextMessage) ? "flex" : "none";
    ctxDeleteBtn.style.display = isMyMessage ? "flex" : "none";
    ctxCopyBtn.style.display = isTextMessage ? "flex" : "none";
    ctxReplyBtn.style.display = "flex";

    // Position the context menu
    messageContextMenu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    messageContextMenu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;
    messageContextMenu.classList.add("active");

    // Handle Emoji reactions
    messageContextMenu.querySelectorAll(".emoji-btn").forEach(btn => {
      btn.onclick = () => {
        socket.emit("reactToMessage", { messageId: message._id, emoji: btn.dataset.emoji });
        hideContextMenu();
      };
    });

    // Attach event handlers
    ctxEditBtn.onclick = () => {
      hideContextMenu();
      enterEditMode(message);
    };

    ctxReplyBtn.onclick = () => {
      hideContextMenu();
      enterReplyMode(message);
    };

    ctxForwardBtn.onclick = () => {
      hideContextMenu();
      openForwardModal(message);
    };

    ctxCopyBtn.onclick = () => {
      hideContextMenu();
      if (message.message) navigator.clipboard.writeText(message.message);
    };

    ctxDeleteBtn.onclick = () => {
      hideContextMenu();
      if (confirm("Are you sure you want to delete this message?")) {
        socket.emit("deleteMessage", { messageId: message._id });
      }
    };
  }

  function hideContextMenu() {
    messageContextMenu.classList.remove("active");
  }

  function renderHistoryNotice(text) {
    const notice = document.createElement("div");
    notice.className = "session-sub";
    notice.textContent = text;
    messagesEl.insertBefore(notice, messagesEl.firstChild);
  }

  function scrollToBottom() {
    isAtBottom = true;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateScrollToBottomVisibility();
  }

  function pinToLatestMessage() {
    scrollToBottom();

    requestAnimationFrame(() => {
      scrollToBottom();
    });

    setTimeout(() => {
      scrollToBottom();
    }, 120);

    const mediaNodes = messagesEl.querySelectorAll("img.chat-media, video.chat-media");
    mediaNodes.forEach((node) => {
      const oncePin = () => scrollToBottom();
      node.addEventListener("load", oncePin, { once: true });
      node.addEventListener("loadedmetadata", oncePin, { once: true });
    });
  }

  function setFileSendingState(isSending, message = "Sending file...") {
    isSendingFile = isSending;
    fileLoaderEl.classList.toggle("hidden", !isSending);
    fileLoaderEl.classList.remove("file-loader-error");
    fileLoaderEl.setAttribute("data-state", isSending ? "sending" : "idle");
    fileLoaderEl.querySelector("span:last-child").textContent = message;
    attachBtn.disabled = isSending;
    sendBtn.disabled = isSending;
  }

  function setFileErrorState(message) {
    isSendingFile = false;
    fileLoaderEl.classList.remove("hidden");
    fileLoaderEl.classList.add("file-loader-error");
    fileLoaderEl.setAttribute("data-state", "error");
    fileLoaderEl.querySelector("span:last-child").textContent = message || "Failed to send file.";
    attachBtn.disabled = false;
    sendBtn.disabled = false;
    pendingFileSend = null;
  }

  function clearFileStatus() {
    isSendingFile = false;
    fileLoaderEl.classList.add("hidden");
    fileLoaderEl.classList.remove("file-loader-error");
    fileLoaderEl.setAttribute("data-state", "idle");
    fileLoaderEl.querySelector("span:last-child").textContent = "Sending file...";
    attachBtn.disabled = false;
    sendBtn.disabled = false;
    pendingFileSend = null;
  }

  function showErrorPopup(message) {
    if (!chatErrorPopupEl || !chatErrorPopupTextEl) return;
    chatErrorPopupTextEl.textContent = message || "Something went wrong.";
    chatErrorPopupEl.classList.remove("hidden");
    if (chatErrorPopupTimer) {
      clearTimeout(chatErrorPopupTimer);
    }
    chatErrorPopupTimer = setTimeout(() => {
      chatErrorPopupEl.classList.add("hidden");
      chatErrorPopupTimer = null;
    }, 4000);
  }

  function onUserSearchInput(event) {
    userSearchTerm = event.target.value.trim().toLowerCase();
    renderUsers();
  }

  function onComposerInputAndResize() {
    autoResizeComposer();
    const messageLength = messageInputEl.value.trim().length;
    const helperText = mobileTabletQuery.matches
      ? `${messageLength} chars`
      : `Enter to send, Shift+Enter for new line - ${messageLength} chars`;
    composerMetaEl.textContent = helperText;
    if (!editingId) storeDraft(messageInputEl.value); // Don't save draft while editing

    if (!selectedUser) return;

    if (messageLength > 0) {
      emitTypingSignal(true);
      if (typingStatus.timeoutId) {
        clearTimeout(typingStatus.timeoutId);
      }
      typingStatus.timeoutId = setTimeout(() => {
        emitTypingSignal(false);
        typingStatus.timeoutId = null;
      }, 1200);
    } else {
      emitTypingSignal(false);
      if (typingStatus.timeoutId) {
        clearTimeout(typingStatus.timeoutId);
        typingStatus.timeoutId = null;
      }
    }
  }

  function onComposerKeydown(event) {
    if (event.key !== "Enter") return;
    if (event.shiftKey) {
      // Allow new line with Shift+Enter
      return;
    }
    if (event.key === "Escape") {
      if (editingId) exitEditMode();
      return;
    }

    // Prevent default Enter behavior (new line) and send message
    if (!mobileTabletQuery.matches) {
      event.preventDefault();
      sendTextMessage();
    }
  }

  function enterEditMode(message) {
    editingId = message._id;
    messageInputEl.value = message.message;
    messageInputEl.focus();
    editIndicator.classList.remove("hidden");
    messageInputEl.classList.add("rounded-t-none"); // Add class for styling
    onComposerInputAndResize(); // Adjust textarea height and update char count
  }

  function enterReplyMode(message) {
    replyingToMsg = message;
    if (editingId) exitEditMode();
    replyTargetUser.textContent = `@${message.from}`;
    replyTargetText.textContent = message.message || (message.type === 'image' ? 'Photo' : 'Video');
    replyIndicator.classList.remove("hidden");
    messageInputEl.classList.add("rounded-t-none");
    messageInputEl.focus();
  }

  function openForwardModal(message) {
    currentForwardMessage = message;
    forwardModal.classList.add("open");

    const usernames = Object.keys(usersPresence).filter(u => u !== currentUser);

    forwardUserList.innerHTML = usernames.map(u => {
      const user = usersPresence[u];
      const avatar = user?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || u)}&background=1d4ed8&color=fff`;
      return `
      <div class="share-user-item" onclick="window.__forwardToUser('${escapeHtml(u)}')">
        <img class="share-user-avatar" src="${escapeHtml(avatar)}">
        <span class="share-user-name">@${escapeHtml(u)}</span>
      </div>
    `;
    }).join("");
  }

  window.__forwardToUser = (targetUsername) => {
    if (!currentForwardMessage) return;
    const content = currentForwardMessage.message || (currentForwardMessage.type === 'image' ? '[Image]' : '[Video]');
    const msg = `Forwarded message:\n${content}`;

    closeForwardModal();

    const nameText = usersPresence[targetUsername]?.name
      ? `${usersPresence[targetUsername].name} (@${targetUsername})`
      : `@${targetUsername}`;

    openConversation(targetUsername, nameText);
    messageInputEl.value = msg;
    onComposerInputAndResize();
  };

  function closeForwardModal() {
    forwardModal.classList.remove("open");
    currentForwardMessage = null;
  }

  function exitReplyMode() {
    replyingToMsg = null;
    replyIndicator.classList.add("hidden");
    messageInputEl.classList.remove("rounded-t-none");
  }

  function renderReactions(rowEl, reactions = []) {
    const container = rowEl.querySelector(".message-reactions");
    if (!container) return;
    container.innerHTML = "";

    reactions.forEach(r => {
      const isMyReaction = r.usernames.includes(currentUser);
      const badge = document.createElement("div");
      badge.className = `reaction-badge ${isMyReaction ? "mine" : ""}`;
      badge.innerHTML = `<span>${r.emoji}</span> <span>${r.usernames.length}</span>`;
      badge.title = r.usernames.join(", ");

      badge.onclick = (e) => {
        e.stopPropagation();
        socket.emit("reactToMessage", {
          messageId: rowEl.dataset.mid,
          emoji: r.emoji
        });
      };

      container.appendChild(badge);
    });
  }

  function exitEditMode() {
    editingId = null;
    messageInputEl.value = "";
    editIndicator.classList.add("hidden");
    messageInputEl.classList.remove("rounded-t-none"); // Remove class for styling
    onComposerInputAndResize(); // Reset textarea height and char count
  }

  function autoResizeComposer() {
    messageInputEl.style.height = "auto";
    const nextHeight = Math.min(messageInputEl.scrollHeight, 150);
    messageInputEl.style.height = `${nextHeight}px`;
  }

  function openConversation(username, nameText) {
    if (selectedUser && selectedUser !== username) {
      emitTypingSignal(false, selectedUser);
      storeDraft(messageInputEl.value);
    }

    selectedUser = username;
    window.__chatSelectedUser = username;
    setTypingIndicatorState(false);
    exitReplyMode();
    chatHasMoreHistory = false;
    chatHistoryLoading = true;
    chatOldestTimestamp = "";
    shouldPinToLatestOnOpen = true;
    unreadCounts[username] = 0;
    
    const user = usersPresence[username];
    const headerName = user?.name ? user.name : `@${username}`;
    chatWithEl.innerText = headerName;

    if (chatHeaderConnectBtn) {
      chatHeaderConnectBtn.classList.remove("hidden");
      if (!me.following) me.following = [];
      let isFollowing = me.following.includes(username);
      chatHeaderConnectBtn.textContent = isFollowing ? "Disconnect" : "Connect";
      chatHeaderConnectBtn.onclick = async () => {
        const action = chatHeaderConnectBtn.textContent.toLowerCase() === "connect" ? "follow" : "unfollow";
        isFollowing = action === "follow";
        chatHeaderConnectBtn.textContent = isFollowing ? "Disconnect" : "Connect";
        
        if (isFollowing) {
          if (!me.following.includes(username)) me.following.push(username);
        } else {
          me.following = me.following.filter(u => u !== username);
        }
        localStorage.setItem("user", JSON.stringify(me));

        const res = await authFetch(`/api/users/${encodeURIComponent(username)}/${action}`, { 
          method: action === "follow" ? "POST" : "DELETE" 
        });
        
        if (!res.ok) {
          isFollowing = !isFollowing;
          chatHeaderConnectBtn.textContent = isFollowing ? "Disconnect" : "Connect";
          if (isFollowing) {
            if (!me.following.includes(username)) me.following.push(username);
          } else {
            me.following = me.following.filter(u => u !== username);
          }
          localStorage.setItem("user", JSON.stringify(me));
        }
      };
    }
    messagesEl.innerHTML = "";
    setOlderHistoryLoader(false);
    const cached = getConversationCache(username);
    if (cached?.loaded) {
      chatHistoryLoading = false;
      chatHasMoreHistory = !!cached.hasMore;
      chatOldestTimestamp = cached.oldestTimestamp || "";
      if (!cached.messages?.length) {
        renderEmptyState("No messages yet", "Start the conversation with a quick hello.");
      } else {
        renderMessageBatch(cached.messages);
        if (shouldPinToLatestOnOpen) {
          pinToLatestMessage();
          shouldPinToLatestOnOpen = false;
        }
      }
    } else {
      socket.emit("loadMessages", { withUser: username });
    }
    openChatOnMobileIfNeeded();
    renderUsers();
    updatePresenceIndicator();
    restoreDraft();
    applyChatBackground(username);
    persistLastChat();
  }

  function applyChatBackground(username, forceTheme = null) {
    if (!chatLayoutEl) return;
    
    // Remove existing background classes
    const bgClasses = ["bg-sunset", "bg-midnight", "bg-ocean", "bg-forest", "bg-lavender", "bg-dark-solid"];
    chatLayoutEl.classList.remove(...bgClasses);

    let theme = "default";
    const normUser = username ? String(username).toLowerCase() : null;

    if (forceTheme) {
      theme = forceTheme;
    } else if (normUser && me?.chatBackgrounds) {
      // Try to find the theme for this specific user (case-insensitive)
      let foundTheme = null;
      try {
        Object.entries(me.chatBackgrounds).forEach(([k, v]) => {
          if (k.toLowerCase() === normUser) foundTheme = v;
        });
      } catch (e) {}
      theme = foundTheme || me.globalChatBackground || "default";
    } else {
      theme = me?.globalChatBackground || "default";
    }
    
    if (theme && theme !== "default") {
      chatLayoutEl.classList.add(`bg-${theme}`);
    }
  }

  function renderEmptyState(title, subtitle) {
    messagesEl.innerHTML = `
    <div class="empty-state">
      <div>${title}</div>
      <div class="session-sub">${subtitle}</div>
    </div>
  `;
  }

  function removeEmptyState() {
    const state = messagesEl.querySelector(".empty-state");
    if (state) state.remove();
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return timeFormatter.format(date);
  }

  function createMediaDownloadLink(message) {
    const link = document.createElement("a");
    link.href = message.mediaUrl || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const fallbackName = message.type === "video" ? "video.mp4" : "image";
    link.download = (message.message || "").trim() || fallbackName;
    link.className = "media-download-link";
    link.textContent = "Download";
    return link;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function updateScrollToBottomVisibility() {
    const threshold = 64;
    const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isAtBottom = distance < threshold;
    scrollToBottomBtn.classList.toggle("hidden", isAtBottom);
  }

  function getOldestTimestamp(messages) {
    if (!Array.isArray(messages) || !messages.length) return "";
    const oldest = messages[0]?.timestamp;
    return oldest ? new Date(oldest).toISOString() : "";
  }

  function loadOlderMessages() {
    if (!selectedUser) return;
    if (!chatHasMoreHistory || chatHistoryLoading || !chatOldestTimestamp) return;
    chatHistoryLoading = true;
    setOlderHistoryLoader(true);
    socket.emit("loadMessages", {
      withUser: selectedUser,
      before: chatOldestTimestamp
    });
  }

  function onMessagesScroll() {
    updateScrollToBottomVisibility();
    if (messagesEl.scrollTop <= 60) {
      loadOlderMessages();
    }
  }

  function updateComposerMeta() {
    onComposerInputAndResize();
  }

  function draftStorageKey() {
    return `chat:draft:${currentUser || "anon"}:${selectedUser || "none"}`;
  }

  function storeDraft(value) {
    if (!selectedUser) return;
    localStorage.setItem(draftStorageKey(), value || "");
  }

  function restoreDraft() {
    if (!selectedUser) return;
    const draft = localStorage.getItem(draftStorageKey()) || "";
    messageInputEl.value = draft;
    onComposerInputAndResize();
  }

  function persistLastChat() {
    if (!selectedUser) return;
    localStorage.setItem(`chat:last:${currentUser}`, selectedUser);
  }

  function restoreLastChat() {
    const params = new URLSearchParams(window.location.search);
    const requestedUser = (params.get("with") || "").trim().toLowerCase();
    const username = requestedUser;

    if (username && username !== currentUser && usersPresence[username]) {
      const user = usersPresence[username];
      const nameText = user?.name ? `${user.name} (@${username})` : `@${username}`;
      openConversation(username, nameText);
      return;
    }

    window.__chatSelectedUser = "";
    selectedUser = "";
    renderEmptyState("Select a chat", "Pick a user from the list to begin.");
    updatePresenceIndicator();
    returnToChatsList();
  }

  function getConversationUserFromMessage(message) {
    if (!message) return "";
    if (message.from === currentUser) return message.to || "";
    if (message.to === currentUser) return message.from || "";
    return "";
  }

  function getConversationCache(username) {
    return conversationCache.get(username) || null;
  }

  function setConversationCache(username, value) {
    if (!username) return;
    const messages = Array.isArray(value?.messages)
      ? value.messages.slice(-CONVERSATION_CACHE_MAX_PER_CHAT)
      : [];

    if (!conversationCache.has(username) && conversationCache.size >= CONVERSATION_CACHE_MAX_CHATS) {
      const oldestKey = conversationCache.keys().next().value;
      if (oldestKey) {
        conversationCache.delete(oldestKey);
      }
    }

    conversationCache.set(username, {
      loaded: !!value?.loaded,
      messages,
      hasMore: !!value?.hasMore,
      oldestTimestamp: value?.oldestTimestamp || ""
    });
    scheduleConversationCachePersist();
  }

  function updateConversationCache(username, updater) {
    if (!username || typeof updater !== "function") return;
    const current = getConversationCache(username) || {
      loaded: false,
      messages: [],
      hasMore: false,
      oldestTimestamp: ""
    };
    const next = updater(current) || current;
    setConversationCache(username, next);
  }

  function mergeUniqueById(left, right) {
    const merged = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
    const byId = new Map();
    merged.forEach((message) => {
      const id = String(message?._id || "");
      if (!id) return;
      byId.set(id, message);
    });
    return Array.from(byId.values()).sort((a, b) => {
      const ta = new Date(a?.timestamp || 0).getTime();
      const tb = new Date(b?.timestamp || 0).getTime();
      return ta - tb;
    });
  }

  function patchMessageInCache(messageId, patcher) {
    if (!messageId || typeof patcher !== "function") return;
    conversationCache.forEach((entry, username) => {
      const nextMessages = (entry.messages || []).map((item) => (
        item?._id === messageId ? patcher(item) : item
      ));
      setConversationCache(username, {
        ...entry,
        messages: nextMessages
      });
    });
  }

  function removeMessageFromCache(messageId) {
    if (!messageId) return;
    conversationCache.forEach((entry, username) => {
      const nextMessages = (entry.messages || []).filter((item) => item?._id !== messageId);
      setConversationCache(username, {
        ...entry,
        messages: nextMessages,
        oldestTimestamp: getOldestTimestamp(nextMessages) || ""
      });
    });
  }

  function getConversationCacheStorageKey() {
    return `${CONVERSATION_CACHE_STORAGE_PREFIX}${currentUser || "anon"}`;
  }

  function scheduleConversationCachePersist() {
    if (cachePersistTimer) return;
    cachePersistTimer = setTimeout(() => {
      cachePersistTimer = null;
      persistConversationCache();
    }, 150);
  }

  function persistConversationCache() {
    if (!currentUser) return;
    try {
      const payload = [];
      conversationCache.forEach((entry, username) => {
        payload.push({
          username,
          loaded: !!entry?.loaded,
          hasMore: !!entry?.hasMore,
          oldestTimestamp: entry?.oldestTimestamp || "",
          messages: (entry?.messages || []).map((msg) => ({
            _id: msg?._id,
            from: msg?.from,
            to: msg?.to,
            message: msg?.message,
            type: msg?.type,
            mediaUrl: msg?.mediaUrl,
            seen: !!msg?.seen,
            edited: !!msg?.edited,
            timestamp: msg?.timestamp
          }))
        });
      });
      sessionStorage.setItem(getConversationCacheStorageKey(), JSON.stringify(payload));
    } catch (_) {
      // Ignore quota and serialization errors.
    }
  }

  function hydrateConversationCache() {
    if (!currentUser) return;
    try {
      const raw = sessionStorage.getItem(getConversationCacheStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      conversationCache.clear();
      parsed.slice(-CONVERSATION_CACHE_MAX_CHATS).forEach((item) => {
        const username = String(item?.username || "").trim().toLowerCase();
        if (!username) return;
        conversationCache.set(username, {
          loaded: !!item?.loaded,
          hasMore: !!item?.hasMore,
          oldestTimestamp: item?.oldestTimestamp || "",
          messages: Array.isArray(item?.messages)
            ? item.messages.slice(-CONVERSATION_CACHE_MAX_PER_CHAT)
            : []
        });
      });
    } catch (_) {
      // Ignore malformed cache payloads.
    }
  }

})();
