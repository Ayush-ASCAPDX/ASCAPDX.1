(async function initGroupChatPage() {
  const me = await requireAuth();
  if (!me) return;

  const timeFormatter = new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  const slug = (window.location.pathname.split("/").pop() || "").trim().toLowerCase();
  const titleEl = document.getElementById("groupTitle");
  const headerEl = document.getElementById("groupHeader");
  const metaEl = document.getElementById("groupMeta");
  const memberCountEl = document.getElementById("memberCount");
  const memberListEl = document.getElementById("groupMembersList");
  const memberSearchPanelEl = document.getElementById("groupMemberSearchPanel");
  const memberSearchInputEl = document.getElementById("groupMemberSearchInput");
  const memberSearchResultsEl = document.getElementById("groupMemberSearchResults");
  const memberSearchStatusEl = document.getElementById("groupMemberSearchStatus");
  const messagesEl = document.getElementById("groupMessages");
  const inputEl = document.getElementById("groupMessageInput");
  const sendBtn = document.getElementById("groupSendBtn");
  const seenMessageIds = new Set();
  let historyLoaded = false;
  let queuedMessages = [];
  let directoryUsers = [];
  let groupOwner = "";
  let groupHasMoreHistory = false;
  let groupHistoryLoading = false;
  let groupOldestTimestamp = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function disableComposer() {
    sendBtn.disabled = true;
    inputEl.disabled = true;
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
  }

  function scrollToBottom(force = false) {
    if (force || isNearBottom()) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function createEmptyState(text) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "empty-state";
    emptyEl.textContent = text;
    return emptyEl;
  }

  function renderEmpty(text) {
    seenMessageIds.clear();
    messagesEl.replaceChildren(createEmptyState(text));
  }

  function buildMessageRow(item) {
    const itemId = String(item?._id || "");
    if (itemId && seenMessageIds.has(itemId)) {
      return null;
    }
    if (itemId) {
      seenMessageIds.add(itemId);
    }

    const mine = item.from === me.username;
    const row = document.createElement("div");
    row.className = `message-row ${mine ? "message-user-row" : "message-assistant-row"}`;

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${mine ? "message-user" : "message-assistant"}`;

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = `<strong>@${escapeHtml(item.from)}</strong><br>${escapeHtml(item.message)}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = timeFormatter.format(new Date(item.timestamp || Date.now()));

    bubble.append(content, meta);
    row.appendChild(bubble);
    return row;
  }

  function appendMessage(item) {
    const row = buildMessageRow(item);
    if (!row) return;

    const empty = messagesEl.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }

    const shouldStick = isNearBottom();
    messagesEl.appendChild(row);
    scrollToBottom(shouldStick);
  }

  function renderInitialHistory(messages) {
    historyLoaded = true;
    seenMessageIds.clear();

    if (!messages.length) {
      renderEmpty("No group messages yet.");
      groupOldestTimestamp = "";
    } else {
      const fragment = document.createDocumentFragment();
      messages.forEach((message) => {
        const row = buildMessageRow(message);
        if (row) {
          fragment.appendChild(row);
        }
      });
      messagesEl.replaceChildren(fragment);
      groupOldestTimestamp = getOldestTimestamp(messages);
      scrollToBottom(true);
    }

    if (!queuedMessages.length) return;

    const pending = queuedMessages;
    queuedMessages = [];
    pending.forEach((message) => appendMessage(message));
  }

  function prependHistory(messages) {
    if (!messages.length) return;
    const empty = messagesEl.querySelector(".empty-state");
    if (empty) {
      empty.remove();
    }

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
    groupOldestTimestamp = getOldestTimestamp(messages) || groupOldestTimestamp;
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

  function getOldestTimestamp(messages) {
    if (!Array.isArray(messages) || !messages.length) return "";
    const value = messages[0]?.timestamp;
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }

  function loadOlderGroupMessages(socketInstance) {
    if (!historyLoaded) return;
    if (!groupHasMoreHistory || groupHistoryLoading || !groupOldestTimestamp) return;
    groupHistoryLoading = true;
    setOlderHistoryLoader(true);
    socketInstance.emit("loadGroupMessages", {
      slug,
      before: groupOldestTimestamp
    });
  }

  function renderMembers(members, owner) {
    if (!memberListEl) return;

    const fragment = document.createDocumentFragment();
    const orderedMembers = [...new Set(members || [])].sort((left, right) => {
      if (left === owner) return -1;
      if (right === owner) return 1;
      return left.localeCompare(right);
    });

    orderedMembers.forEach((username) => {
      const labels = [
        username === owner ? "Owner" : "",
        username === me.username ? "You" : ""
      ].filter(Boolean).join(" . ");

      const itemEl = document.createElement("div");
      itemEl.className = "group-member-item";

      const nameEl = document.createElement("div");
      nameEl.className = "group-member-name";
      nameEl.textContent = `@${username}`;

      const metaItemEl = document.createElement("div");
      metaItemEl.className = "group-member-meta";
      metaItemEl.textContent = labels || "Member";

      itemEl.append(nameEl, metaItemEl);
      fragment.appendChild(itemEl);
    });

    memberListEl.replaceChildren(fragment);
  }

  function setMemberSearchStatus(message, isError = false) {
    if (!memberSearchStatusEl) return;
    memberSearchStatusEl.textContent = message || "";
    memberSearchStatusEl.style.color = isError ? "#b91c1c" : "";
  }

  function canManageMembers() {
    return groupOwner === me.username;
  }

  function renderMemberSearchResults() {
    if (!memberSearchResultsEl || !memberSearchInputEl) return;
    memberSearchResultsEl.innerHTML = "";

    if (!canManageMembers()) {
      setMemberSearchStatus("Only group owner can add members.");
      return;
    }

    const term = memberSearchInputEl.value.trim().toLowerCase();
    if (!term) {
      setMemberSearchStatus("Search by username.");
      return;
    }

    const existing = new Set((groupData.members || []).map((u) => String(u || "").toLowerCase()));
    const candidates = directoryUsers
      .filter((user) => {
        const username = String(user.username || "").toLowerCase();
        const name = String(user.name || "").toLowerCase();
        if (!username || username === me.username) return false;
        if (existing.has(username)) return false;
        return username.includes(term) || name.includes(term);
      })
      .slice(0, 8);

    if (!candidates.length) {
      setMemberSearchStatus("No matching users found.");
      return;
    }

    const fragment = document.createDocumentFragment();
    candidates.forEach((user) => {
      const username = String(user.username || "").toLowerCase();
      const item = document.createElement("div");
      item.className = "group-member-search-item";
      item.innerHTML = `
        <div class="group-member-search-meta">
          <div class="group-member-search-name">@${escapeHtml(username)}</div>
          <div class="group-member-search-sub">${escapeHtml(user.name || user.username)}</div>
        </div>
        <button type="button" class="tiny-btn" data-add-member="${escapeHtml(username)}">Add</button>
      `;
      fragment.appendChild(item);
    });
    memberSearchResultsEl.appendChild(fragment);
    setMemberSearchStatus(`${candidates.length} result(s).`);
  }

  async function loadDirectoryUsers() {
    if (!canManageMembers()) return;
    const response = await authFetch("/api/users");
    if (!response.ok) {
      setMemberSearchStatus("Could not load users list.", true);
      return;
    }
    const users = await response.json();
    directoryUsers = Array.isArray(users) ? users : [];
  }

  const groupRes = await authFetch(`/api/groups/${encodeURIComponent(slug)}`);
  const groupData = await groupRes.json();
  if (!groupRes.ok) {
    renderEmpty(groupData.error || "Unable to open this group.");
    disableComposer();
    return;
  }

  if (!groupData.members.includes(me.username)) {
    renderEmpty("You are not a member of this group.");
    disableComposer();
    return;
  }

  titleEl.textContent = groupData.name;
  groupOwner = String(groupData.owner || "").toLowerCase();
  headerEl.textContent = `${groupData.name} (/g/${groupData.slug})`;
  metaEl.textContent = `${groupData.isPrivate ? "Private" : "Public"} group . Owner: @${groupData.owner}`;
  memberCountEl.textContent = `${groupData.members.length} members`;
  renderMembers(groupData.members, groupData.owner);
  if (memberSearchPanelEl) {
    memberSearchPanelEl.style.display = canManageMembers() ? "" : "none";
  }
  renderEmpty("Loading messages...");
  await loadDirectoryUsers();
  renderMemberSearchResults();

  const socket = io({ auth: { token: getToken() } });
  window.__chatSocket = socket;
  socket.emit("joinGroup", { slug });
  groupHistoryLoading = true;
  socket.emit("loadGroupMessages", { slug });

  socket.on("groupHistory", ({ slug: historySlug, before = "", messages = [], hasMore = false }) => {
    if (historySlug !== slug) return;
    groupHistoryLoading = false;
    setOlderHistoryLoader(false);
    groupHasMoreHistory = !!hasMore;

    if (before) {
      prependHistory(messages);
      return;
    }
    renderInitialHistory(messages);
  });

  socket.on("groupMessage", ({ slug: incomingSlug, message }) => {
    if (incomingSlug !== slug) return;
    if (!historyLoaded) {
      queuedMessages.push(message);
      return;
    }
    appendMessage(message);
  });

  function sendMessage() {
    const message = inputEl.value.trim();
    if (!message) return;
    socket.emit("groupMessage", { slug, message });
    inputEl.value = "";
  }

  sendBtn.addEventListener("click", sendMessage);
  messagesEl.addEventListener("scroll", () => {
    if (messagesEl.scrollTop <= 60) {
      loadOlderGroupMessages(socket);
    }
  });
  memberSearchInputEl?.addEventListener("input", renderMemberSearchResults);
  memberSearchResultsEl?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-add-member]");
    if (!button || !canManageMembers()) return;

    const username = String(button.getAttribute("data-add-member") || "").trim().toLowerCase();
    if (!username) return;

    button.disabled = true;
    const response = await authFetch(`/api/groups/${encodeURIComponent(slug)}/members`, {
      method: "POST",
      body: JSON.stringify({ username })
    });
    const data = await response.json();

    if (!response.ok) {
      setMemberSearchStatus(data.error || "Could not add member.", true);
      button.disabled = false;
      return;
    }

    groupData.members = Array.isArray(data.group?.members)
      ? data.group.members
      : [...new Set([...(groupData.members || []), username])];
    memberCountEl.textContent = `${groupData.members.length} members`;
    renderMembers(groupData.members, groupData.owner);
    setMemberSearchStatus(`@${username} added.`);
    renderMemberSearchResults();
  });
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
})();
