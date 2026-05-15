(async function initGroupChat() {
  const me = await requireAuth();
  if (!me) return;

  const pathParts = window.location.pathname.split("/");
  const rawSlug = pathParts[pathParts.length - 1];
  if (!rawSlug) {
    window.location.href = "/groups";
    return;
  }

  function normalizeSlug(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  const groupSlug = normalizeSlug(rawSlug);

  let socket;
  let groupData = null;
  let isAtBottom = true;
  let oldestTimestamp = "";
  let isLoadingHistory = false;
  let hasMoreHistory = false;
  let editingId = null;
  let replyingToMsg = null;
  let longPressTimer = null;
  let isUploading = false;
  const MAX_MESSAGE_CHARS = 2000;
  let initialLoadTimeout = null;
  const INITIAL_LOAD_TIMEOUT_MS = 5000; // 5 seconds

  const messagesEl = document.getElementById("groupMessages");
  const inputEl = document.getElementById("groupMessageInput");
  const sendBtn = document.getElementById("groupSendBtn");
  const headerNameEl = document.getElementById("groupHeaderName");
  const headerSlugEl = document.getElementById("groupHeaderSlug");
  const memberCountEl = document.getElementById("memberCount");
  const groupInitialEl = document.getElementById("groupInitial");
  const scrollToBottomBtn = document.getElementById("scrollToBottomBtn");
  const deleteGroupBtn = document.getElementById("deleteGroupBtn");
  const leaveGroupBtn = document.getElementById("leaveGroupBtn");
  const contextMenu = document.getElementById("messageContextMenu");
  const ctxEditBtn = document.getElementById("ctxEditBtn");
  const ctxReplyBtn = document.getElementById("ctxReplyBtn");
  const ctxCopyBtn = document.getElementById("ctxCopyBtn");
  const ctxDeleteBtn = document.getElementById("ctxDeleteBtn");
  const editIndicator = document.getElementById("editIndicator");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const replyIndicator = document.getElementById("replyIndicator");
  const cancelReplyBtn = document.getElementById("cancelReplyBtn");
  const replyTargetUser = document.getElementById("replyTargetUser");
  const replyTargetText = document.getElementById("replyTargetText");
  const attachBtn = document.getElementById("groupAttachBtn");
  const fileInputEl = document.getElementById("groupFileInput");
  const fileLoaderEl = document.getElementById("groupFileLoader");
  const charCounterEl = document.getElementById("groupCharCounter");

  function clearUnreadCount() {
    const key = `chat:unread-groups:${me.username}`;
    try {
      const counts = JSON.parse(localStorage.getItem(key) || "{}");
      delete counts[groupSlug];
      localStorage.setItem(key, JSON.stringify(counts));
    } catch (_) {}
  }

  // Cache System
  const groupCache = new Map();
  const GROUP_CACHE_MAX_PER_CHAT = 100;
  const GROUP_CACHE_STORAGE_PREFIX = "chat:group-cache:";
  let groupCachePersistTimer = null;

  function hydrateGroupCache() {
    if (!me) return;
    try {
      const raw = sessionStorage.getItem(`${GROUP_CACHE_STORAGE_PREFIX}${me.username}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      groupCache.clear();
      parsed.forEach(item => {
        if (item.slug) groupCache.set(item.slug, item);
      });
    } catch (_) {}
  }

  function persistGroupCache() {
    if (!me) return;
    try {
      const payload = Array.from(groupCache.values());
      sessionStorage.setItem(`${GROUP_CACHE_STORAGE_PREFIX}${me.username}`, JSON.stringify(payload));
    } catch (_) {}
  }

  function scheduleGroupCachePersist() {
    if (groupCachePersistTimer) return;
    groupCachePersistTimer = setTimeout(() => {
      groupCachePersistTimer = null;
      persistGroupCache();
    }, 200);
  }

  function updateGroupCache(slug, updater) {
    const current = groupCache.get(slug) || { slug, messages: [], hasMore: false, oldestTimestamp: "" };
    const next = updater(current);
    if (next) {
      if (next.messages && next.messages.length > GROUP_CACHE_MAX_PER_CHAT) {
        next.messages = next.messages.slice(-GROUP_CACHE_MAX_PER_CHAT);
      }
      groupCache.set(slug, next);
      scheduleGroupCachePersist();
    }
  }

  function mergeUniqueById(left, right) {
    const merged = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])];
    const byId = new Map();
    merged.forEach((m) => {
      const id = String(m?._id || "");
      if (!id) return;
      const existing = byId.get(id);
      // Prefer new data (m), but keep reactions from existing if m doesn't have them
      byId.set(id, existing ? { ...existing, ...m, reactions: m.reactions || existing.reactions || [] } : { reactions: [], ...m });
    });
    return Array.from(byId.values()).sort((a, b) => {
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });
  }

  function patchMessageInCache(messageId, patcher) {
    updateGroupCache(groupSlug, (entry) => ({
      ...entry,
      messages: (entry.messages || []).map(m => String(m._id) === String(messageId) ? patcher(m) : m)
    }));
  }

  function removeMessageFromCache(messageId) {
    updateGroupCache(groupSlug, (entry) => ({
      ...entry,
      messages: (entry.messages || []).filter(m => String(m._id) !== String(messageId))
    }));
  }

  async function fetchGroupDetails() {
    const res = await authFetch(`/api/groups/${groupSlug}`);
    if (!res.ok) {
      alert("Group not found or access denied.");
      window.location.href = "/groups";
      return;
    }
    groupData = await res.json();
    renderGroupMetadata();
  }

  function renderGroupMetadata() {
    const name = groupData.name || groupData.slug;
    headerNameEl.textContent = name;
    headerSlugEl.textContent = `#${groupData.slug} · Owner: @${groupData.owner}`;
    memberCountEl.textContent = groupData.members?.length || 0;
    if (groupInitialEl) groupInitialEl.textContent = name.charAt(0).toUpperCase();
    
    if (groupData.owner === me.username) {
      document.getElementById("groupSettingsBtn").style.display = "block";
      deleteGroupBtn.style.display = "block";
    } else {
      leaveGroupBtn.style.display = "block";
    }
  }

  function formatTime(ts) {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function buildMessageRow(msg) {
    const isMe = msg.from === me.username;
    const div = document.createElement("div");
    div.dataset.mid = msg._id;
    const isMedia = msg.type === "image" || msg.type === "video";
    const reactionsHtml = `<div class="message-reactions flex flex-wrap gap-1 mt-1"></div>`;

    let replyPreviewHtml = "";
    if (msg.replyTo) {
      const parent = groupCache.get(groupSlug)?.messages?.find(m => String(m._id) === String(msg.replyTo));
      const sender = parent ? `@${parent.from}` : "Original message";
      const snippet = parent ? parent.message : "Click to view context";
      replyPreviewHtml = `
        <div class="mb-2 p-2 rounded bg-black/10 border-l-2 border-primary/50 text-[10px] cursor-pointer hover:bg-black/20 transition-colors" onclick="document.querySelector('[data-mid=\\'${msg.replyTo}\\']')?.scrollIntoView({behavior:'smooth', block:'center'})">
          <div class="font-bold text-primary/80">${sender}</div>
          <div class="truncate opacity-70">${escapeHtml(snippet)}</div>
        </div>
      `;
    }

    let contentHtml = "";
    if (msg.type === "image") {
      contentHtml = `<img src="${msg.mediaUrl}" class="max-w-full rounded-lg mb-1 cursor-pointer message-shadow" loading="lazy" onclick="window.open('${msg.mediaUrl}')">`;
    } else if (msg.type === "video") {
      contentHtml = `<video src="${msg.mediaUrl}" controls class="max-w-full rounded-lg mb-1 message-shadow"></video>`;
    }
    if (msg.message && msg.message.trim()) {
      contentHtml += `<p class="text-sm md:text-base ${isMe ? 'text-on-primary-container' : 'text-on-surface'} ${isMedia ? 'px-1 pb-1' : ''}">${escapeHtml(msg.message)}${msg.edited ? ' <span class="opacity-50 text-[10px] italic">(edited)</span>' : ''}</p>`;
    }
    
    if (isMe) {
      div.className = "flex flex-col items-end gap-1 self-end max-w-[85%] group";
      div.innerHTML = `
        <div class="message-bubble-content bg-primary-container ${isMedia ? 'p-2' : 'p-md'} rounded-2xl rounded-br-none glow-active message-shadow cursor-pointer select-none">
          ${replyPreviewHtml}${contentHtml}${reactionsHtml}
        </div>
        <div class="flex items-center gap-1 px-1">
          <span class="text-[10px] text-outline">${formatTime(msg.timestamp)}</span>
          <span class="material-symbols-outlined text-[14px] text-primary" style="font-variation-settings: 'FILL' 1;">done_all</span>
        </div>
      `;
    } else {
      div.className = "flex items-end gap-sm max-w-[85%] group";
      div.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold border border-outline-variant mb-5">
          ${msg.from.charAt(0).toUpperCase()}
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-[10px] text-primary px-1">@${msg.from}</span>
          <div class="message-bubble-content bg-surface-container ${isMedia ? 'p-2' : 'p-md'} rounded-2xl rounded-bl-none border border-outline-variant/10 message-shadow select-none">
            ${replyPreviewHtml}${contentHtml}${reactionsHtml}
          </div>
          <span class="text-[10px] text-outline px-1">${formatTime(msg.timestamp)}</span>
        </div>
      `;
    }

    // Context Menu / Long Press Support
    const bubble = div.querySelector(".message-bubble-content");
    bubble.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(msg, e.pageX, e.pageY);
    });

    bubble.addEventListener("touchstart", (e) => {
      longPressTimer = setTimeout(() => {
        showMenu(msg, e.touches[0].pageX, e.touches[0].pageY);
      }, 500);
    }, { passive: true });

    bubble.addEventListener("touchend", () => clearTimeout(longPressTimer));
    bubble.addEventListener("touchmove", () => clearTimeout(longPressTimer));

    renderReactions(div, msg.reactions);
    return div;
  }

  function renderReactions(rowEl, reactions = []) {
    const container = rowEl.querySelector(".message-reactions");
    if (!container) return;
    container.innerHTML = "";
    
    reactions.forEach(r => {
      const isMyReaction = r.usernames.includes(me.username);
      const badge = document.createElement("button");
      badge.className = `flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-colors ${
        isMyReaction 
          ? 'bg-primary/20 border-primary/50 text-primary' 
          : 'bg-surface-container-high border-outline-variant/30 text-on-surface-variant'
      }`;
      badge.innerHTML = `<span>${r.emoji}</span> <span class="font-bold">${r.usernames.length}</span>`;
      badge.title = r.usernames.map(u => `@${u}`).join(", ");
      
      badge.onclick = (e) => {
        e.stopPropagation();
        socket.emit("reactToGroupMessage", { messageId: rowEl.dataset.mid, emoji: r.emoji });
      };
      
      container.appendChild(badge);
    });
  }

  function showMenu(msg, x, y) {
    contextMenu.style.left = `${Math.min(x, window.innerWidth - 150)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - 100)}px`;
    contextMenu.classList.remove("hidden");

    // Toggle visibility based on ownership and message content
    ctxCopyBtn.style.display = (msg.message && msg.message.trim()) ? "flex" : "none";
    ctxEditBtn.style.display = msg.from === me.username ? "flex" : "none";
    ctxDeleteBtn.style.display = msg.from === me.username ? "flex" : "none";

    // Emoji picker logic
    contextMenu.querySelectorAll(".emoji-btn").forEach(btn => {
      btn.onclick = () => {
        socket.emit("reactToGroupMessage", { messageId: msg._id, emoji: btn.dataset.emoji });
        hideMenu();
      };
    });

    ctxCopyBtn.onclick = () => {
      hideMenu();
      if (msg.message) navigator.clipboard.writeText(msg.message);
    };

    ctxReplyBtn.onclick = () => {
      hideMenu();
      enterReplyMode(msg);
    };

    ctxEditBtn.onclick = () => {
      hideMenu();
      enterEditMode(msg);
    };

    ctxDeleteBtn.onclick = () => {
      hideMenu();
      if (confirm("Delete this message?")) {
        socket.emit("deleteGroupMessage", { messageId: msg._id });
      }
    };
  }

  function hideMenu() {
    contextMenu.classList.add("hidden");
  }

  function enterEditMode(msg) {
    editingId = msg._id;
    exitReplyMode();
    inputEl.value = msg.message;
    inputEl.focus();
    editIndicator.classList.remove("hidden");
    inputEl.classList.add("rounded-t-none");
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";
  }

  function exitEditMode() {
    editingId = null;
    inputEl.value = "";
    editIndicator.classList.add("hidden");
    inputEl.classList.remove("rounded-t-none");
    inputEl.style.height = "auto";
  }

  function enterReplyMode(msg) {
    replyingToMsg = msg;
    exitEditMode();
    replyTargetUser.textContent = `@${msg.from}`;
    replyTargetText.textContent = msg.message || "Media message";
    replyIndicator.classList.remove("hidden");
    inputEl.classList.add("rounded-t-none");
    inputEl.focus();
  }

  function exitReplyMode() {
    replyingToMsg = null;
    replyIndicator.classList.add("hidden");
    inputEl.classList.remove("rounded-t-none");
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    isAtBottom = true;
  }

  function handleSend() {
    const text = inputEl.value.trim();
    if ((!text && !isUploading) || !socket || inputEl.value.length > MAX_MESSAGE_CHARS) return;

    if (editingId) {
      socket.emit("editGroupMessage", { messageId: editingId, newText: text });
      exitEditMode();
    } else {
      socket.emit("groupMessage", { 
        slug: groupSlug, 
        message: text,
        type: "text",
        mediaUrl: "",
        replyTo: replyingToMsg?._id || null
      });
      inputEl.value = "";
      if (replyingToMsg) exitReplyMode();
    }
    
    inputEl.style.height = "auto";
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || isUploading) return;

    isUploading = true;
    fileLoaderEl.classList.remove("hidden");
    fileLoaderEl.querySelector('span').textContent = `Uploading ${file.name}...`;

    try {
      const isVideo = file.type.startsWith("video/");
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
      xhr.setRequestHeader("X-File-Kind", isVideo ? "video" : "image");
      xhr.setRequestHeader("Content-Type", file.type);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          fileLoaderEl.querySelector('span').textContent = `Uploading ${pct}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText);
          socket.emit("groupMessage", { 
            slug: groupSlug, 
            message: "", // Send empty text so we don't show the filename as a caption
            type: isVideo ? "video" : "image", 
            mediaUrl: data.url 
          });
        } else {
          alert("Upload failed.");
        }
        cleanupUpload();
      };
      xhr.send(file);
    } catch (err) {
      alert("Upload error.");
      cleanupUpload();
    }
  }

  function cleanupUpload() {
    isUploading = false;
    fileLoaderEl.classList.add("hidden");
    fileInputEl.value = "";
  }

  function loadOlderMessages() {
    if (isLoadingHistory || !hasMoreHistory || !oldestTimestamp) return;
    isLoadingHistory = true;
    
    setHistoryLoader(true, "Loading older messages...");
    socket.emit("loadGroupMessages", { slug: groupSlug, before: oldestTimestamp });
  }

  // Socket Initialization
  socket = io({ auth: { token: getToken() } });

  function setHistoryLoader(visible, text = "Loading...") {
    const existing = messagesEl.querySelector(".history-loader");
    if (visible) {
      if (existing) return;
      // Loader template
      const loader = document.createElement("div");
      loader.className = "flex items-center justify-center py-sm history-loader";
      loader.innerHTML = `
        <div class="flex items-center gap-2 px-md py-xs bg-surface-container-high rounded-full border border-outline-variant">
          <div class="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
          <span class="text-[10px] font-medium text-on-surface-variant">${text}</span>
        </div>
      `;
      messagesEl.prepend(loader);
    } else if (existing) {
      existing.remove();
    }
  }

  function pinToLatestMessage() {
    // Initial scroll to bottom
    scrollToBottom();

    // Re-scroll after a short delay to account for initial DOM rendering
    requestAnimationFrame(() => {
      scrollToBottom();
    });

    // Re-scroll after a slightly longer delay for good measure
    setTimeout(() => {
      scrollToBottom();
    }, 120);

    // Re-scroll after media (images/videos) have loaded
    const mediaNodes = messagesEl.querySelectorAll("img, video");
    mediaNodes.forEach((node) => {
      node.addEventListener("load", scrollToBottom, { once: true });
      node.addEventListener("loadedmetadata", scrollToBottom, { once: true });
    });
  }

  socket.on("groupHistory", ({ slug, messages = [], hasMore, before }) => {
    console.log("Received groupHistory for slug:", slug, "messages count:", messages.length, "before:", before);
    if (slug !== groupSlug) return;

    // Clear the timeout as history has been received
    if (initialLoadTimeout) {
      clearTimeout(initialLoadTimeout);
      initialLoadTimeout = null;
    }

    const isInitial = !before;
    let mergedForRender = messages;

    updateGroupCache(groupSlug, (entry) => {
      const merged = mergeUniqueById(entry.messages, messages);
      if (isInitial) mergedForRender = merged;
      return {
        ...entry,
        messages: merged,
        hasMore: !!hasMore,
        oldestTimestamp: merged[0]?.timestamp || ""
      };
    });

    if (isInitial) {
      messagesEl.innerHTML = "";
    } else {
      setHistoryLoader(false);
    }

    hasMoreHistory = !!hasMore;

    if (messages.length > 0) {
      console.log("Rendering", messages.length, "messages.");
      oldestTimestamp = messages[0].timestamp;
      const fragment = document.createDocumentFragment();
      mergedForRender.forEach(m => fragment.appendChild(buildMessageRow(m)));
      
      const prevHeight = messagesEl.scrollHeight;
      isInitial ? messagesEl.appendChild(fragment) : messagesEl.prepend(fragment);
      
      if (isInitial) {
        pinToLatestMessage();
      } else {
        messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
      }
    } else if (isInitial) {
      console.log("No messages in this group yet.");
      messagesEl.innerHTML = `<div class="empty-state">No messages in this group yet.</div>`;
    }
    isLoadingHistory = false;
    console.log("History load complete.");
  });

  socket.on("groupMessage", ({ slug, message }) => {
    if (slug !== groupSlug) return;
    
    const wasAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;

    clearUnreadCount();

    updateGroupCache(groupSlug, (entry) => {
      const merged = mergeUniqueById(entry.messages, [message]);
      return {
        ...entry,
        messages: merged
      };
    });
    
    const empty = messagesEl.querySelector(".empty-state");
    if (empty) empty.remove();
    
    messagesEl.appendChild(buildMessageRow(message));
    
    if (wasAtBottom || message.from === me.username) {
      pinToLatestMessage();
    }
  });

  socket.on("groupMessageEdited", (msg) => {
    const row = document.querySelector(`[data-mid="${msg._id}"]`);
    if (!row) return;
    const content = row.querySelector("p");
    content.innerHTML = `${escapeHtml(msg.message)} <span class="opacity-50 text-[10px] italic">(edited)</span>`;
    patchMessageInCache(msg._id, (m) => ({ ...m, ...msg }));
  });

  socket.on("groupMessageReacted", ({ messageId, reactions }) => {
    const row = document.querySelector(`[data-mid="${messageId}"]`);
    if (!row) return;
    renderReactions(row, reactions);
    patchMessageInCache(messageId, (m) => ({ ...m, reactions }));
  });

  socket.on("groupMessageDeleted", ({ messageId }) => {
    const row = document.querySelector(`[data-mid="${messageId}"]`);
    if (row) row.remove();
    removeMessageFromCache(messageId);
  });

  function showErrorWithRetry(message) {
    messagesEl.innerHTML = `
      <div class="empty-state flex flex-col items-center gap-4">
        <span class="text-red-400 font-medium">${escapeHtml(message)}</span>
        <button id="retryLoadBtn" class="px-4 py-2 bg-surface-container-high border border-outline-variant rounded-xl text-xs font-semibold hover:bg-surface-container-highest transition-all active:scale-95">
          Retry Connection
        </button>
      </div>
    `;
    document.getElementById("retryLoadBtn")?.addEventListener("click", () => {
      messagesEl.innerHTML = "";
      setHistoryLoader(true, "Reconnecting...");
      onConnect();
    });
  }

  socket.on("groupError", ({ slug, error }) => {
    if (slug !== groupSlug) return;
    console.error("Group error:", error);
    isLoadingHistory = false;
    setHistoryLoader(false);
    showErrorWithRetry(error || "Failed to load messages.");
  });

  socket.on("connect", onConnect);
  if (socket.connected) onConnect();

  function onConnect() {
    console.log("Socket connected, joining group:", groupSlug);
    socket.emit("joinGroup", { slug: groupSlug });
    
    const cached = groupCache.get(groupSlug);
    if (!cached || !cached.messages.length) {
      isLoadingHistory = true;
      setHistoryLoader(true, "Connecting...");
    }

    socket.emit("loadGroupMessages", { slug: groupSlug });

    if (initialLoadTimeout) clearTimeout(initialLoadTimeout);
    initialLoadTimeout = setTimeout(() => {
      if (isLoadingHistory) {
        isLoadingHistory = false;
        setHistoryLoader(false);
        showErrorWithRetry("Connection timed out. Check your internet or try again.");
      }
    }, INITIAL_LOAD_TIMEOUT_MS);
  }

  // Event Listeners
  sendBtn.addEventListener("click", handleSend);
  cancelEditBtn.addEventListener("click", exitEditMode);
  cancelReplyBtn.addEventListener("click", exitReplyMode);
  document.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target)) hideMenu();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      if (editingId) exitEditMode();
      if (replyingToMsg) exitReplyMode();
    }
  });

  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + "px";

    const len = inputEl.value.length;
    if (charCounterEl) {
      charCounterEl.textContent = `${len} / ${MAX_MESSAGE_CHARS}`;
      charCounterEl.classList.toggle("text-red-400", len > MAX_MESSAGE_CHARS);
    }
    
    sendBtn.disabled = len > MAX_MESSAGE_CHARS;
    sendBtn.style.opacity = len > MAX_MESSAGE_CHARS ? "0.5" : "1";
  });

  messagesEl.addEventListener("scroll", () => {
    const dist = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    isAtBottom = dist < 50;
    scrollToBottomBtn.classList.toggle("hidden", isAtBottom);
    
    // Load more logic
    if (messagesEl.scrollTop < 50 && !isLoadingHistory && hasMoreHistory) {
      loadOlderMessages();
    }
  });

  scrollToBottomBtn.addEventListener("click", scrollToBottom);
  attachBtn.addEventListener("click", () => fileInputEl.click());
  fileInputEl.addEventListener("change", handleFileUpload);

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  deleteGroupBtn.addEventListener("click", async () => {
    if (!confirm(`Are you sure you want to permanently delete "${groupData?.name || groupSlug}"? This will remove all members and messages.`)) {
      return;
    }

    const res = await authFetch(`/api/groups/${groupSlug}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/groups";
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete group.");
    }
  });

  leaveGroupBtn.addEventListener("click", async () => {
    if (!confirm("Are you sure you want to leave this group?")) return;
    const res = await authFetch(`/api/groups/${groupSlug}/leave`, { method: "POST" });
    if (res.ok) {
      window.location.href = "/groups";
    } else {
      const data = await res.json();
      alert(data.error || "Failed to leave group.");
    }
  });

  // Initialize
  fetchGroupDetails();
  clearUnreadCount();
  hydrateGroupCache();

  const initialCache = groupCache.get(groupSlug);
  if (initialCache && initialCache.messages.length > 0) {
    const fragment = document.createDocumentFragment();
    initialCache.messages.forEach(m => fragment.appendChild(buildMessageRow(m)));
    messagesEl.innerHTML = "";
    messagesEl.appendChild(fragment);
    
    oldestTimestamp = initialCache.oldestTimestamp;
    hasMoreHistory = !!initialCache.hasMore;
    isLoadingHistory = false;
    
    setHistoryLoader(false);
    pinToLatestMessage();
  }
})();
