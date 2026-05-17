(async function initGroupsPage() {
  const me = await requireAuth();
  if (!me) return;

  const discoverListEl = document.getElementById("discoverList");
  const searchEl = document.getElementById("groupsSearchInput");
  const searchOverlayEl = document.getElementById("groupsSearchOverlay");
  const openSearchBtn = document.getElementById("openSearchBtn");
  const closeSearchBtn = document.getElementById("closeSearchBtn");
  const clearRecentBtn = document.getElementById("clearRecentBtn");
  const recentSearchListEl = document.getElementById("recentSearchList");
  const groupsMenuBtn = document.getElementById("groupsMenuBtn");
  const groupsMenuDrop = document.getElementById("groupsMenuDrop");
  const groupsCreateMenuBtn = document.getElementById("groupsCreateMenuBtn");
  const statusEl = document.getElementById("groupsStatus");
  const createModalEl = document.getElementById("createGroupModal");
  const closeCreateModalBtn = document.getElementById("closeCreateModalBtn");
  const createGroupFormEl = document.getElementById("createGroupForm");
  const createGroupNameEl = document.getElementById("createGroupName");
  const createGroupSlugEl = document.getElementById("createGroupSlug");
  const createGroupPrivateEl = document.getElementById("createGroupPrivate");
  const createGroupErrorEl = document.getElementById("createGroupError");

  const groupAvatarUploadTrigger = document.getElementById("groupAvatarUploadTrigger");
  const groupAvatarFileEl = document.getElementById("groupAvatarFile");
  const groupAvatarPreviewEl = document.getElementById("groupAvatarPreview");
  const groupAvatarPlaceholderEl = document.getElementById("groupAvatarPlaceholder");
  const groupAvatarUrlEl = document.getElementById("groupAvatarUrl");

  let socket;
  let groupUnreadCounts = {};
  const UNREAD_KEY = `chat:unread-groups:${me.username}`;

  const showMoreBtn = document.createElement("button");
  showMoreBtn.type = "button";
  showMoreBtn.className = "btn-ghost";
  showMoreBtn.textContent = "Show more";
  showMoreBtn.style.marginTop = "10px";
  showMoreBtn.style.width = "100%";
  showMoreBtn.hidden = true;
  discoverListEl.insertAdjacentElement("afterend", showMoreBtn);

  let discoverGroups = [];
  let filteredGroups = [];
  let myGroupSlugs = new Set();
  let recentSearches = [];
  let visibleCount = 10;
  const PAGE_SIZE = 10;
  const RECENT_KEY = `groups:recent-searches:${me.username || "anon"}`;

  function loadUnreadCounts() {
    try {
      const raw = localStorage.getItem(UNREAD_KEY);
      groupUnreadCounts = raw ? JSON.parse(raw) : {};
    } catch (_) {
      groupUnreadCounts = {};
    }
  }

  function saveUnreadCounts() {
    localStorage.setItem(UNREAD_KEY, JSON.stringify(groupUnreadCounts));
  }

  function initSocket() {
    socket = io({ auth: { token: getToken() } });
    socket.on("groupMessage", ({ slug, message }) => {
      if (message.from === me.username) return;
      if (!myGroupSlugs.has(slug)) return;
      groupUnreadCounts[slug] = (groupUnreadCounts[slug] || 0) + 1;
      saveUnreadCounts();
      renderDiscover(discoverGroups);
    });
  }

  function setStatus(message, isError = false) {
    statusEl.textContent = message || "";
    statusEl.style.color = isError ? "#fca5a5" : "#b9cbe2";
  }

  function setCreateModalError(message, isError = true) {
    createGroupErrorEl.textContent = message || "";
    createGroupErrorEl.classList.toggle("ok", !isError && !!message);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function renderDiscover(list) {
    filteredGroups = Array.isArray(list) ? list : [];
    if (!filteredGroups.length) {
      discoverListEl.innerHTML = "<article class='discover-item'><div class='discover-item-sub'>No public groups available.</div></article>";
      showMoreBtn.hidden = true;
      return;
    }

    const visible = filteredGroups.slice(0, visibleCount);
    discoverListEl.innerHTML = visible.map((group) => {
      const memberCount = Number(group.memberCount || 0);
      const slug = String(group.slug || "");
      const joined = myGroupSlugs.has(slug);
      const unreadCount = groupUnreadCounts[slug] || 0;
      const badge = (joined && unreadCount > 0) ? `<span class="unread-badge" style="margin-left:auto; margin-right:8px;">${unreadCount > 99 ? '99+' : unreadCount}</span>` : "";

      return `
        <article class="discover-item" data-open-group="${escapeHtml(group.slug)}">
          <img class="discover-item-avatar" src="${group.avatarUrl || 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=120&q=80'}" alt="${escapeHtml(group.name || group.slug)}">
          <div class="discover-item-title">${escapeHtml(group.name || group.slug)}</div>
          ${badge}
          <button class="join-btn" type="button" data-join-group="${escapeHtml(group.slug)}">${joined ? "Open" : "Join"}</button>
          <div class="discover-item-sub">${escapeHtml(group.slug)} . ${memberCount} member${memberCount === 1 ? "" : "s"}</div>
        </article>
      `;
    }).join("");

    showMoreBtn.hidden = filteredGroups.length <= visibleCount;
  }

  function renderRecentSearches() {
    if (!recentSearches.length) {
      recentSearchListEl.innerHTML = "<div class='recent-sub'>No recent searches</div>";
      return;
    }
    recentSearchListEl.innerHTML = recentSearches.map((group) => `
      <div class="recent-item" data-recent-slug="${escapeHtml(group.slug)}">
        <img class="recent-avatar" src="${group.avatarUrl || 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=120&q=80'}" alt="${escapeHtml(group.name || group.slug)}">
        <div>
          <div class="recent-title">${escapeHtml(group.name || group.slug)}</div>
          <div class="recent-sub">Channel · ${Number(group.memberCount || 0)} members</div>
        </div>
        <button class="recent-remove" type="button" data-remove-recent="${escapeHtml(group.slug)}">×</button>
      </div>
    `).join("");
  }

  function renderSearchOverlayResults(list) {
    if (!list.length) {
      recentSearchListEl.innerHTML = "<div class='recent-sub'>No groups match your search</div>";
      return;
    }
    const visible = list.slice(0, visibleCount);
    recentSearchListEl.innerHTML = visible.map((group) => {
      const slug = String(group.slug || "");
      const joined = myGroupSlugs.has(slug);
      const unreadCount = groupUnreadCounts[slug] || 0;
      const badge = (joined && unreadCount > 0) ? `<span class="unread-badge" style="margin-left:auto; margin-right:8px;">${unreadCount > 99 ? '99+' : unreadCount}</span>` : "";

      return `
        <div class="recent-item" data-search-slug="${escapeHtml(group.slug)}">
          <img class="recent-avatar" src="${group.avatarUrl || 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=120&q=80'}" alt="${escapeHtml(group.name || group.slug)}">
          <div>
            <div class="recent-title">${escapeHtml(group.name || group.slug)}</div>
            <div class="recent-sub">${escapeHtml(group.slug)} · ${Number(group.memberCount || 0)} members</div>
          </div>
          ${badge}
          <button class="join-btn" type="button" data-search-join="${escapeHtml(group.slug)}">${joined ? "Open" : "Join"}</button>
        </div>
      `;
    }).join("");
  }

  function persistRecentSearches() {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSearches.slice(0, 8)));
  }

  function loadRecentSearches() {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      recentSearches = Array.isArray(parsed) ? parsed.slice(0, 8) : [];
    } catch (_) {
      recentSearches = [];
    }
  }

  function addRecentSearch(group) {
    if (!group?.slug) return;
    recentSearches = [group, ...recentSearches.filter((item) => item.slug !== group.slug)].slice(0, 8);
    persistRecentSearches();
    if (!searchEl.value.trim()) renderRecentSearches();
  }

  function getFiltered(term) {
    if (!term) return [...discoverGroups];
    const lowered = term.toLowerCase();
    return discoverGroups
      .filter((group) => {
        const name = String(group.name || "").toLowerCase();
        const slug = String(group.slug || "").toLowerCase();
        return name.includes(lowered) || slug.includes(lowered);
      })
      .sort((a, b) => {
        const an = String(a.name || "").toLowerCase();
        const bn = String(b.name || "").toLowerCase();
        const as = String(a.slug || "").toLowerCase();
        const bs = String(b.slug || "").toLowerCase();
        const aStarts = an.startsWith(lowered) || as.startsWith(lowered);
        const bStarts = bn.startsWith(lowered) || bs.startsWith(lowered);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return an.localeCompare(bn);
      });
  }

  function applySearchFilter(resetVisible = true) {
    if (resetVisible) visibleCount = PAGE_SIZE;
    const term = searchEl.value.trim();
    const next = getFiltered(term);
    renderDiscover(next);
    if (term) {
      renderSearchOverlayResults(next);
    } else {
      renderRecentSearches();
    }
  }

  function openSearchOverlay() {
    searchOverlayEl.classList.add("open");
    searchOverlayEl.setAttribute("aria-hidden", "false");
    applySearchFilter(false);
    requestAnimationFrame(() => searchEl.focus());
  }

  function closeSearchOverlay() {
    searchOverlayEl.classList.remove("open");
    searchOverlayEl.setAttribute("aria-hidden", "true");
    searchEl.value = "";
    visibleCount = PAGE_SIZE;
    renderDiscover(discoverGroups);
  }

  async function loadDiscoverGroups() {
    const response = await authFetch("/api/groups/discover");
    if (!response.ok) throw new Error("Failed to load discover groups.");
    discoverGroups = await response.json();
    renderDiscover(discoverGroups);
  }

  function openCreateModal() {
    createModalEl.classList.add("open");
    createModalEl.setAttribute("aria-hidden", "false");
    createGroupNameEl.value = "";
    createGroupSlugEl.value = "";
    createGroupPrivateEl.checked = false;
    if (groupAvatarPreviewEl) groupAvatarPreviewEl.style.display = "none";
    if (groupAvatarPlaceholderEl) groupAvatarPlaceholderEl.style.display = "block";
    if (groupAvatarUrlEl) groupAvatarUrlEl.value = "";
    if (groupAvatarFileEl) groupAvatarFileEl.value = "";
    setCreateModalError("");
    requestAnimationFrame(() => createGroupNameEl.focus());
  }

  function closeCreateModal() {
    createModalEl.classList.remove("open");
    createModalEl.setAttribute("aria-hidden", "true");
  }

  async function createGroupFlow() {
    const name = createGroupNameEl.value.trim();
    const slug = slugify(createGroupSlugEl.value);
    const isPrivate = !!createGroupPrivateEl.checked;
    const avatarUrl = groupAvatarUrlEl ? groupAvatarUrlEl.value.trim() : "";
    if (!name) return setCreateModalError("Group name is required.", true);
    if (!slug) return setCreateModalError("Valid slug is required.", true);
    setCreateModalError("");
    const response = await authFetch("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), slug, isPrivate, avatarUrl })
    });
    const data = await response.json();
    if (!response.ok) return setCreateModalError(data.error || "Could not create group.", true);
    setCreateModalError("Group created.", false);
    setStatus("Group created.");
    closeCreateModal();
    window.location.href = `/g/${encodeURIComponent(slug)}`;
  }

  async function joinOrOpen(slug) {
    if (!slug) return;
    const selected = discoverGroups.find((group) => String(group.slug || "") === slug);
    if (selected) addRecentSearch(selected);

    if (myGroupSlugs.has(slug)) {
      window.location.href = `/g/${encodeURIComponent(slug)}`;
      return;
    }

    const response = await authFetch(`/api/groups/${encodeURIComponent(slug)}/join`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) return setStatus(data.error || "Could not join group.", true);
    if (socket) socket.emit("joinGroup", { slug });
    myGroupSlugs.add(slug);
    setStatus("Joined group.");
    applySearchFilter(false);
  }

  discoverListEl.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-join-group]");
    const card = event.target.closest("[data-open-group]");
    const slug = String(btn?.getAttribute("data-join-group") || card?.getAttribute("data-open-group") || "");
    if (!slug) return;
    await joinOrOpen(slug);
  });

  recentSearchListEl.addEventListener("click", async (event) => {
    const removeBtn = event.target.closest("[data-remove-recent]");
    if (removeBtn) {
      const slug = String(removeBtn.getAttribute("data-remove-recent") || "");
      recentSearches = recentSearches.filter((item) => item.slug !== slug);
      persistRecentSearches();
      renderRecentSearches();
      return;
    }

    const actionBtn = event.target.closest("[data-search-join]");
    const row = event.target.closest("[data-search-slug], [data-recent-slug]");
    const slug = String(
      actionBtn?.getAttribute("data-search-join") ||
      row?.getAttribute("data-search-slug") ||
      row?.getAttribute("data-recent-slug") ||
      ""
    );
    if (!slug) return;

    if (!actionBtn && row?.hasAttribute("data-recent-slug")) {
      const selected = discoverGroups.find((group) => String(group.slug || "") === slug);
      if (selected) {
        searchEl.value = selected.name || selected.slug || "";
        applySearchFilter();
      }
      return;
    }

    await joinOrOpen(slug);
  });

  showMoreBtn.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    applySearchFilter(false);
  });
  searchEl.addEventListener("input", () => applySearchFilter(true));
  searchEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applySearchFilter(false);
    }
  });
  openSearchBtn.addEventListener("click", openSearchOverlay);
  closeSearchBtn.addEventListener("click", closeSearchOverlay);
  clearRecentBtn.addEventListener("click", () => {
    recentSearches = [];
    persistRecentSearches();
    renderRecentSearches();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && searchOverlayEl.classList.contains("open")) closeSearchOverlay();
  });
  groupsMenuBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    groupsMenuDrop.classList.toggle("open");
  });
  groupsCreateMenuBtn.addEventListener("click", () => {
    groupsMenuDrop.classList.remove("open");
    openCreateModal();
  });
  document.addEventListener("click", () => {
    groupsMenuDrop.classList.remove("open");
  });
  closeCreateModalBtn.addEventListener("click", closeCreateModal);
  createModalEl.addEventListener("click", (event) => {
    if (event.target === createModalEl) closeCreateModal();
  });
  createGroupNameEl.addEventListener("input", () => {
    if (!createGroupSlugEl.value.trim()) {
      createGroupSlugEl.value = slugify(createGroupNameEl.value);
    }
  });
  createGroupFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createGroupFlow();
  });

  if (groupAvatarUploadTrigger && groupAvatarFileEl) {
    groupAvatarUploadTrigger.addEventListener("click", () => {
      groupAvatarFileEl.click();
    });

    groupAvatarFileEl.addEventListener("change", () => {
      const file = groupAvatarFileEl.files?.[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (groupAvatarUrlEl) groupAvatarUrlEl.value = result;
        if (groupAvatarPreviewEl) {
          groupAvatarPreviewEl.src = result;
          groupAvatarPreviewEl.style.display = "block";
        }
        if (groupAvatarPlaceholderEl) {
          groupAvatarPlaceholderEl.style.display = "none";
        }
      };
      reader.readAsDataURL(file);
    });
  }

  try {
    const mine = await authFetch("/api/groups");
    if (mine.ok) {
      const myGroups = await mine.json();
      myGroupSlugs = new Set((myGroups || []).map((group) => String(group.slug || "")));
    }
    await loadDiscoverGroups();
    loadRecentSearches();
    loadUnreadCounts();
    initSocket();
    renderRecentSearches();
  } catch (error) {
    setStatus(error?.message || "Failed to load groups.", true);
  }
})();
