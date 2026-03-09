(async function initGroupsPage() {
  const me = await requireAuth();
  if (!me) return;

  const origin = location.origin;
  const statusEl = document.getElementById("status");
  const groupsListEl = document.getElementById("groupsList");
  const groupNameEl = document.getElementById("groupName");
  const groupSlugEl = document.getElementById("groupSlug");
  const groupPrivateEl = document.getElementById("groupPrivate");
  const groupNamePreviewEl = document.getElementById("groupNamePreview");
  const groupSlugPreviewEl = document.getElementById("groupSlugPreview");
  const groupDomainPreviewEl = document.getElementById("groupDomainPreview");
  const groupPrivacyPreviewEl = document.getElementById("groupPrivacyPreview");

  function setStatus(message, isError = true) {
    statusEl.style.color = isError ? "#fca5a5" : "#86efac";
    statusEl.textContent = message;
  }

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function loadGroups() {
    const response = await authFetch("/api/groups");
    if (!response.ok) {
      setStatus("Failed to load groups.");
      return;
    }

    const groups = await response.json();
    if (!groups.length) {
      groupsListEl.innerHTML = "<div class='session-sub'>No groups yet.</div>";
      return;
    }

    groupsListEl.innerHTML = groups.map((group) => {
      const domain = `${origin}/g/${group.slug}`;
      return `
        <div class="group-item">
          <div class="session-title">${escapeHtml(group.name)}</div>
          <div class="session-sub">/${escapeHtml(group.slug)} . ${group.isPrivate ? "Private" : "Public"}</div>
          <div class="group-item-actions">
            <a class="secondary-link" href="/g/${encodeURIComponent(group.slug)}">Open</a>
            <button type="button" class="tiny-btn" data-copy="${escapeHtml(domain)}">Copy Link</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function updatePreview() {
    const groupName = groupNameEl.value.trim();
    const slug = slugify(groupSlugEl.value);
    const isPrivate = groupPrivateEl.checked;
    const nextSlug = slug || "new-group";

    groupNamePreviewEl.textContent = groupName || "New group";
    groupSlugPreviewEl.textContent = `/g/${nextSlug}`;
    groupDomainPreviewEl.textContent = `${origin}/g/${nextSlug}`;
    groupPrivacyPreviewEl.textContent = isPrivate ? "Private group" : "Public group";
  }

  groupsListEl.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;

    const value = button.getAttribute("data-copy") || "";
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Group link copied.", false);
    } catch (_) {
      setStatus("Copy failed.");
    }
  });

  groupNameEl.addEventListener("input", (event) => {
    if (groupSlugEl.value.trim()) {
      updatePreview();
      return;
    }
    groupSlugEl.value = slugify(event.target.value);
    updatePreview();
  });

  groupSlugEl.addEventListener("input", updatePreview);
  groupPrivateEl.addEventListener("change", updatePreview);

  document.getElementById("createGroupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    const name = groupNameEl.value.trim();
    const slug = slugify(groupSlugEl.value);
    const isPrivate = groupPrivateEl.checked;

    const response = await authFetch("/api/groups", {
      method: "POST",
      body: JSON.stringify({ name, slug, isPrivate })
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Failed to create group.");
      return;
    }

    setStatus("Group created.", false);
    event.target.reset();
    updatePreview();
    await loadGroups();
  });

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  updatePreview();
  await loadGroups();
})();
