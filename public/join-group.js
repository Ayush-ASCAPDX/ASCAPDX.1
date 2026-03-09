(async function initJoinGroupPage() {
  const me = await requireAuth();
  if (!me) return;

  const listEl = document.getElementById("joinGroupsList");
  const searchEl = document.getElementById("groupSearch");
  const statusEl = document.getElementById("status");
  let groups = [];

  function setStatus(message, isError = true) {
    statusEl.style.color = isError ? "#fca5a5" : "#86efac";
    statusEl.textContent = message;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function filterGroups() {
    const term = searchEl.value.trim().toLowerCase();
    if (!term) return groups;

    return groups.filter((group) => {
      const haystack = `${group.name} ${group.slug} ${group.owner}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  function renderGroups() {
    const filtered = filterGroups();
    if (!filtered.length) {
      listEl.innerHTML = "<div class='session-sub'>No public groups match your search.</div>";
      return;
    }

    listEl.innerHTML = filtered.map((group) => `
      <div class="group-item">
        <div class="session-title">${escapeHtml(group.name)}</div>
        <div class="session-sub">/${escapeHtml(group.slug)} . Owner: @${escapeHtml(group.owner)} . ${group.memberCount} members</div>
        <div class="group-item-actions">
          <button
            type="button"
            class="${group.joined ? "secondary-btn" : "chat-send-btn"}"
            data-join-slug="${escapeHtml(group.slug)}"
            data-joined="${group.joined ? "1" : "0"}"
          >${group.joined ? "Open" : "Join"}</button>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll("[data-join-slug]").forEach((button) => {
      button.addEventListener("click", async () => {
        const slug = (button.getAttribute("data-join-slug") || "").trim();
        const alreadyJoined = button.getAttribute("data-joined") === "1";
        if (!slug) return;

        if (alreadyJoined) {
          window.location.href = `/g/${encodeURIComponent(slug)}`;
          return;
        }

        button.disabled = true;
        const response = await authFetch(`/api/groups/${encodeURIComponent(slug)}/join`, {
          method: "POST"
        });
        const data = await response.json();

        if (!response.ok) {
          setStatus(data.error || "Failed to join group.");
          button.disabled = false;
          return;
        }

        groups = groups.map((group) => (
          group.slug === slug
            ? { ...group, joined: true, memberCount: group.memberCount + 1 }
            : group
        ));
        setStatus("Group joined.", false);
        renderGroups();
      });
    });
  }

  async function loadGroups() {
    const response = await authFetch("/api/groups/discover");
    if (!response.ok) {
      setStatus("Failed to load public groups.");
      return;
    }

    const data = await response.json();
    groups = Array.isArray(data) ? data.filter((group) => !group.isPrivate) : [];
    renderGroups();
  }

  searchEl.addEventListener("input", renderGroups);

  await loadGroups();
})();
