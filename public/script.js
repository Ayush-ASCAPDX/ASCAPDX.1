let socket;
let currentUser;
let selectedUser = "";
let usersPresence = {};
let unreadCounts = {};
let userSearchTerm = "";
let isAtBottom = true;
let chatHasMoreHistory = false;
let chatHistoryLoading = false;
let chatOldestTimestamp = "";
let shouldPinToLatestOnOpen = false;
const conversationCache = new Map();
const CONVERSATION_CACHE_MAX_PER_CHAT = 120;
const CONVERSATION_CACHE_MAX_CHATS = 40;
const CONVERSATION_CACHE_STORAGE_PREFIX = "chat:conversation-cache:";
let cachePersistTimer = null;

const usersListEl = document.getElementById("usersList");
const currentUserEl = document.getElementById("currentUser");
const chatWithEl = document.getElementById("chatWith");
const messagesEl = document.getElementById("messages");
const presenceTextEl = document.getElementById("presenceText");
const videoCallBtn = document.getElementById("videoCallBtn");
const deleteConversationBtn = document.getElementById("deleteConversationBtn");
const chatMenuBtn = document.getElementById("chatMenuBtn");
const chatMenu = document.getElementById("chatMenu");
const backToChatsBtn = document.getElementById("backToChatsBtn");
const mobileTabletQuery = window.matchMedia("(max-width: 990px)");
const sendBtn = document.getElementById("sendBtn");
const attachBtn = document.getElementById("attachBtn");
const fileInputEl = document.getElementById("fileInput");
const fileLoaderEl = document.getElementById("fileLoader");
const userSearchInput = document.getElementById("userSearchInput");
const messageInputEl = document.getElementById("messageInput");
const composerMetaEl = document.getElementById("composerMeta");
const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
const chatErrorPopupEl = document.getElementById("chatErrorPopup");
const chatErrorPopupTextEl = document.getElementById("chatErrorPopupText");
const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1920;
const IMAGE_COMPRESSION_TRIGGER_BYTES = 8 * 1024 * 1024;
const IMAGE_COMPRESSION_ALWAYS_THRESHOLD_BYTES = 20 * 1024 * 1024;
const IMAGE_COMPRESSION_MIN_SAVINGS = 0.1;
let isSendingFile = false;
let pendingFileSend = null;
let chatErrorPopupTimer = null;
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
  const me = await requireAuth();
  if (!me) return;

  currentUser = me.username;
  currentUserEl.innerText = `Logged in: @${me.username}`;
  hydrateConversationCache();

  socket = io({ auth: { token: getToken() } });
  window.__chatSocket = socket;

  socket.on("presence", (presence) => {
    mergePresenceUpdate(presence);
    renderUsers();
    updatePresenceIndicator();
  });

  socket.on("chatHistory", ({ withUser = "", before = "", messages = [], hasMore = false } = {}) => {
    if (!selectedUser || withUser !== selectedUser) return;

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

    const inOpenChat =
      (message.from === selectedUser && message.to === currentUser) ||
      (message.from === currentUser && message.to === selectedUser);

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

  socket.on("messageEdited", (message) => {
    const bubble = document.querySelector(`[data-mid='${message._id}'] .message-content`);
    if (!bubble) return;
    bubble.textContent = `${message.message} (edited)`;
    patchMessageInCache(message._id, (item) => ({
      ...item,
      ...message
    }));
  });

  socket.on("messageDeleted", ({ messageId }) => {
    const row = document.querySelector(`[data-mid='${messageId}']`);
    if (row) row.remove();
    removeMessageFromCache(messageId);
  });

  socket.on("conversationDeleted", ({ withUser }) => {
    if (withUser === selectedUser) {
      messagesEl.innerHTML = "";
      renderEmptyState("No messages yet", "Start the conversation with a quick hello.");
    }
  });

  socket.on("messageError", ({ error, clientId }) => {
    if (!error) return;
    if (pendingFileSend && clientId && clientId === pendingFileSend.clientId) {
      setFileErrorState(error);
      showErrorPopup(error);
      return;
    }
    showErrorPopup(error);
    clearFileStatus();
  });

  socket.on("disconnect", () => {
    if (!pendingFileSend) return;
    const errorMessage = "Upload failed. Connection dropped while sending the file.";
    setFileErrorState(errorMessage);
    showErrorPopup(errorMessage);
  });

  sendBtn.addEventListener("click", sendTextMessage);
  messageInputEl.addEventListener("input", onComposerInput);
  messageInputEl.addEventListener("keydown", onComposerKeydown);
  userSearchInput.addEventListener("input", onUserSearchInput);
  scrollToBottomBtn.addEventListener("click", () => scrollToBottom(true));
  messagesEl.addEventListener("scroll", onMessagesScroll);
  document.getElementById("settingsBtn").addEventListener("click", () => {
    window.location.href = "/settings";
  });
  document.getElementById("profileBtn").addEventListener("click", () => {
    window.location.href = "/profile";
  });
  document.getElementById("groupsBtn").addEventListener("click", () => {
    window.location.href = "/groups";
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);

  attachBtn.addEventListener("click", () => {
    if (isSendingFile) return;
    if (!selectedUser) {
      alert("Select a user first");
      return;
    }
    fileInputEl.click();
  });

  fileInputEl.addEventListener("change", sendMediaMessage);

  videoCallBtn.addEventListener("click", () => {
    if (!selectedUser) return;
    window.location.href = `/video?with=${encodeURIComponent(selectedUser)}&autostart=1`;
  });

  deleteConversationBtn.addEventListener("click", deleteConversation);
  chatMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    chatMenu.classList.toggle("hidden");
  });
  backToChatsBtn.addEventListener("click", returnToChatsList);
  if (mobileTabletQuery.addEventListener) {
    mobileTabletQuery.addEventListener("change", applyResponsiveShellState);
  } else if (mobileTabletQuery.addListener) {
    mobileTabletQuery.addListener(applyResponsiveShellState);
  }

  await loadUsersFromApi();
  applyResponsiveShellState();
  updateComposerMeta();
  restoreLastChat();

  document.addEventListener("click", () => {
    chatMenu.classList.add("hidden");
    closeAllMessageMenus();
  });
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

async function loadUsersFromApi() {
  const res = await authFetch("/api/users");
  if (!res.ok) return;
  const users = await res.json();

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
  const usernames = Object.keys(usersPresence)
    .filter((u) => u !== currentUser)
    .filter((u) => {
      if (!userSearchTerm) return true;
      const name = usersPresence[u]?.name || "";
      const haystack = `${u} ${name}`.toLowerCase();
      return haystack.includes(userSearchTerm);
    })
    .sort();

  if (!usernames.length) {
    usersListEl.innerHTML = "<div class='empty-state'>No chats match your search.</div>";
    return;
  }

  const fragment = document.createDocumentFragment();
  usernames.slice(0, USER_LIST_BATCH_SIZE).forEach((username) => {
    fragment.appendChild(buildUserRow(username));
  });
  usersListEl.replaceChildren(fragment);

  if (usernames.length <= USER_LIST_BATCH_SIZE) {
    return;
  }

  requestAnimationFrame(() => {
    const extraFragment = document.createDocumentFragment();
    usernames.slice(USER_LIST_BATCH_SIZE).forEach((username) => {
      extraFragment.appendChild(buildUserRow(username));
    });
    usersListEl.appendChild(extraFragment);
  });
}

function buildUserRow(username) {
  const user = usersPresence[username];
  const div = document.createElement("div");
  div.className = `session-item ${selectedUser === username ? "active" : ""}`;

  const nameText = user?.name ? `${user.name} (@${username})` : `@${username}`;
  const status = user?.online ? "Online" : "Offline";
  const privacyText = user?.privateChat ? "Private chat" : "Open chat";
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
    <div class="session-sub">${status} . ${privacyText}</div>
    ${unreadBadge}
  `;

  div.onclick = () => {
    openConversation(username, nameText);
  };

  return div;
}

function updatePresenceIndicator() {
  if (!selectedUser) {
    presenceTextEl.textContent = "Offline";
    videoCallBtn.disabled = true;
    deleteConversationBtn.disabled = true;
    chatMenuBtn.disabled = true;
    return;
  }

  const isOnline = !!usersPresence[selectedUser]?.online;
  presenceTextEl.textContent = isOnline ? "Online" : "Offline";
  videoCallBtn.disabled = !isOnline;
  deleteConversationBtn.disabled = false;
  chatMenuBtn.disabled = false;
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

function sendTextMessage() {
  if (isSendingFile) return;

  const msg = messageInputEl.value.trim();

  if (!selectedUser) {
    alert("Select a user first");
    return;
  }

  if (!msg) return;

  socket.emit("privateMessage", {
    to: selectedUser,
    message: msg,
    type: "text"
  });

  messageInputEl.value = "";
  storeDraft("");
  onComposerInput();
}

async function sendMediaMessage(event) {
  const file = event.target.files[0];
  event.target.value = "";

  if (!file || !selectedUser) return;
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
      to: selectedUser,
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

  const content = document.createElement("div");
  content.className = "message-content";
  const isMediaMessage = message.type === "image" || message.type === "video";

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
  bubble.appendChild(meta);

  if (message.from === currentUser) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const menuBtn = document.createElement("button");
    menuBtn.textContent = "\u22EE";
    menuBtn.className = "tiny-menu-btn";
    menuBtn.onclick = (event) => {
      event.stopPropagation();
      closeAllMessageMenus();
      menu.classList.toggle("hidden");
    };

    const menu = document.createElement("div");
    menu.className = "message-menu hidden";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.className = "menu-item danger-item";
    deleteBtn.onclick = (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      socket.emit("deleteMessage", { messageId: message._id });
    };

    actions.appendChild(menuBtn);
    menu.appendChild(deleteBtn);
    actions.appendChild(menu);
    bubble.appendChild(actions);
  }

  row.appendChild(bubble);
  return row;
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

init();

function closeAllMessageMenus() {
  document.querySelectorAll(".message-menu").forEach((menu) => {
    menu.classList.add("hidden");
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

function onComposerInput() {
  autoResizeComposer();
  const messageLength = messageInputEl.value.trim().length;
  const helperText = mobileTabletQuery.matches
    ? `${messageLength} chars`
    : `Enter to send, Shift+Enter for new line - ${messageLength} chars`;
  composerMetaEl.textContent = helperText;
  storeDraft(messageInputEl.value);
}

function onComposerKeydown(event) {
  if (event.key !== "Enter") return;
  if (event.shiftKey) return;
  if (mobileTabletQuery.matches) return;
  event.preventDefault();
  sendTextMessage();
}

function autoResizeComposer() {
  messageInputEl.style.height = "auto";
  const nextHeight = Math.min(messageInputEl.scrollHeight, 150);
  messageInputEl.style.height = `${nextHeight}px`;
}

function openConversation(username, nameText) {
  if (selectedUser && selectedUser !== username) {
    storeDraft(messageInputEl.value);
  }

  selectedUser = username;
  window.__chatSelectedUser = username;
  chatHasMoreHistory = false;
  chatHistoryLoading = true;
  chatOldestTimestamp = "";
  shouldPinToLatestOnOpen = true;
  unreadCounts[username] = 0;
  chatWithEl.innerText = `Chat with ${nameText}`;
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
  persistLastChat();
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
  onComposerInput();
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
  onComposerInput();
}

function persistLastChat() {
  if (!selectedUser) return;
  localStorage.setItem(`chat:last:${currentUser}`, selectedUser);
}

function restoreLastChat() {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get("with") || "").trim().toLowerCase();
  const previous = requested || localStorage.getItem(`chat:last:${currentUser}`);
  if (!previous || !usersPresence[previous]) {
    window.__chatSelectedUser = "";
    renderEmptyState("Select a chat", "Pick a user from the list to begin.");
    return;
  }
  const name = usersPresence[previous]?.name ? `${usersPresence[previous].name} (@${previous})` : `@${previous}`;
  openConversation(previous, name);
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
