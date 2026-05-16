(async function initProfilePage() {
  const me = await requireAuth();
  if (!me) return;

  // Ensure me.following is an array for client-side logic.
  // In a real application, this array would be populated by the server via the /api/me endpoint.
  me.following = Array.isArray(me.following) ? me.following : [];

  const urlParams = new URLSearchParams(window.location.search);
  const targetUsername = urlParams.get("username");
  console.log("Client: Target Username from URL:", targetUsername);
  const isOwnProfile = !targetUsername || targetUsername.toLowerCase() === me.username.toLowerCase();
  const statusEl = document.getElementById("status");
  const nameEl = document.getElementById("name");
  const bioEl = document.getElementById("bio");
  const avatarUrlEl = document.getElementById("avatarUrl");
  const avatarFileEl = document.getElementById("avatarFile");
  const privateChatEl = document.getElementById("privateChat");
  const allowedUsersEl = document.getElementById("allowedUsers");
  const avatarPreviewEl = document.getElementById("avatarPreview");
  const profileNameEl = document.getElementById("profileName");
  const profileTierEl = document.getElementById("profileTier");
  const profileHandleEl = document.getElementById("profileHandle");
  const profileBioPreviewEl = document.getElementById("profileBioPreview");
  const profileUsernameMetaEl = document.getElementById("profileUsernameMeta");
  const profilePlanMetaEl = document.getElementById("profilePlanMeta");
  const profilePrivacyMetaEl = document.getElementById("profilePrivacyMeta");
  const usernameDisplayEl = document.getElementById("usernameDisplay");
  const bioCountEl = document.getElementById("bioCount");

  function setStatus(message, isError = true) {
    statusEl.style.color = isError ? "#fca5a5" : "#86efac";
    statusEl.textContent = message;
  }

  if (!statusEl) {
     console.error("Status element not found");
     return;
  }

  let profileUser = me;
  if (!isOwnProfile) {
    console.log("Client: Attempting to fetch profile for:", targetUsername);
    const res = await authFetch(`/api/profile/${encodeURIComponent(targetUsername)}`);
    console.log("Client: API Response Status:", res.status, "OK:", res.ok);
    if (res.ok) {
      profileUser = await res.json();
      console.log("Client: Fetched profileUser data:", profileUser);
    } else {
      setStatus("User profile not found or is private.");
      return;
    }
  }

  function avatarFallback(name) {
    const first = (name || profileUser.username || "?").slice(0, 1).toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><rect width='100%' height='100%' fill='#1d4ed8'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI, Arial' font-size='90' fill='#dbeafe'>${first}</text></svg>`)}`;
  }

  function syncPreview() {
    const displayName = nameEl.value.trim() || profileUser.name || profileUser.username;
    const bioText = bioEl.value.trim();
    const isPrivate = !!privateChatEl.checked;
    profileNameEl.textContent = displayName;
    profileHandleEl.textContent = `@${profileUser.username}`;
    profileUsernameMetaEl.textContent = `@${profileUser.username}`;
    profilePrivacyMetaEl.textContent = isPrivate ? "Private chat" : "Open chat";
    profileBioPreviewEl.textContent = bioText || "Add a short bio so people in your chats and groups recognize you instantly.";
    bioCountEl.textContent = `${bioText.length} / 280`;
    const src = avatarUrlEl.value.trim() || profileUser.avatarUrl || avatarFallback(displayName);
    avatarPreviewEl.src = src;

    // Remove skeleton classes once data is loaded
    profileNameEl.classList.remove("skeleton");
    profileHandleEl.classList.remove("skeleton");
    profileBioPreviewEl.classList.remove("skeleton");
    avatarPreviewEl.classList.remove("skeleton-avatar");
    const topAvatar = document.getElementById("avatarPreviewTop");
    if (topAvatar) topAvatar.classList.remove("skeleton-avatar");
  }

  nameEl.value = profileUser.name || "";
  bioEl.value = profileUser.bio || "";
  avatarUrlEl.value = profileUser.avatarUrl || "";
  usernameDisplayEl.value = `@${profileUser.username}`;
  privateChatEl.checked = !!profileUser.privateChat;
  allowedUsersEl.value = (isOwnProfile && Array.isArray(profileUser.allowedChatUsers)) ? profileUser.allowedChatUsers.join(", ") : "";
  profileTierEl.textContent = `${(profileUser.membershipTier || "free").toUpperCase()} ${isOwnProfile ? "plan" : "member"}`;
  profilePlanMetaEl.textContent = (profileUser.membershipTier || "free").toUpperCase();

  if (!isOwnProfile) {
    nameEl.readOnly = true;
    bioEl.readOnly = true;
    avatarUrlEl.readOnly = true;
    avatarFileEl.style.display = "none";
    privateChatEl.disabled = true;

    const saveBtn = document.getElementById("profileForm").querySelector('button[type="submit"]');
    if (saveBtn) saveBtn.style.display = "none";

    const upgradeBtn = document.getElementById("upgradeBtn");
    if (upgradeBtn) upgradeBtn.style.display = "none";

    const allowedGroup = allowedUsersEl.closest(".form-group");
    if (allowedGroup) allowedGroup.style.display = "none";

    const privacyGroup = privateChatEl.closest(".form-group");
    if (privacyGroup) privacyGroup.style.display = "none";

    // Add Block and Report buttons for other users
    const actionContainer = document.createElement("div");
    actionContainer.style.display = "flex";
    actionContainer.style.gap = "0.5rem";
    actionContainer.style.marginTop = "1rem";

    const blockBtn = document.createElement("button");
    blockBtn.type = "button";
    blockBtn.className = "danger-btn";
    blockBtn.textContent = "Block User";
    blockBtn.onclick = async () => {
      if (!confirm(`Are you sure you want to block @${profileUser.username}?`)) return;
      const res = await authFetch(`/api/users/${encodeURIComponent(profileUser.username)}/block`, { method: "POST" });
      if (res.ok) setStatus(`@${profileUser.username} has been blocked.`, false);
      else setStatus("Failed to block user.");
    };

    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.className = "btn-secondary";
    reportBtn.textContent = "Report User";
    reportBtn.onclick = async () => {
      const reason = prompt(`Reason for reporting @${profileUser.username}:`);
      if (!reason) return;
      const res = await authFetch(`/api/users/${encodeURIComponent(profileUser.username)}/report`, { method: "POST", body: JSON.stringify({ reason }) });
      if (res.ok) setStatus("User reported. Our moderators will review the case.", false);
      else setStatus("Failed to submit report.");
    };

    actionContainer.appendChild(blockBtn);
    actionContainer.appendChild(reportBtn);

    // Add Follow/Unfollow button for other users
    const isFollowing = me.following.includes(profileUser.username);
    const followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.className = isFollowing ? "btn-secondary" : "btn-primary"; // Initial state
    followBtn.textContent = isFollowing ? "Unfollow" : "Follow"; // Initial text
    followBtn.onclick = async () => {
      const currentStatus = me.following.includes(profileUser.username);
      const action = currentStatus ? "unfollow" : "follow";
      const method = currentStatus ? "DELETE" : "POST";
      const endpoint = `/api/users/${encodeURIComponent(profileUser.username)}/${action}`;

      const res = await authFetch(endpoint, { method });
      if (res.ok) {
        setStatus(`You have ${action}ed @${profileUser.username}.`, false);
        // Update local state (me.following)
        if (currentStatus) {
          me.following = me.following.filter(u => u !== profileUser.username);
        } else {
          me.following.push(profileUser.username);
        }
        // Update button state
        followBtn.textContent = !currentStatus ? "Unfollow" : "Follow";
        followBtn.classList.toggle("btn-primary", !currentStatus); // If it was following, now it's unfollowed, so primary for follow
        followBtn.classList.toggle("btn-secondary", currentStatus); // If it was following, now it's unfollowed, so secondary for unfollow
      } else {
        setStatus(`Failed to ${action} @${profileUser.username}.`);
      }
    };
    actionContainer.appendChild(followBtn);

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-secondary";
    backBtn.textContent = "Back to Chat";
    backBtn.onclick = () => window.navigateTo ? window.navigateTo("/chat") : window.location.href = "/chat";
    actionContainer.appendChild(backBtn);

    // Place buttons outside (after) the bio card
    profileBioPreviewEl.parentElement.after(actionContainer);
  } else {
    // For your own profile, add nicely styled buttons
    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.flexDirection = "column";
    btnGroup.style.gap = "12px";
    btnGroup.style.marginTop = "24px";
    btnGroup.style.marginBottom = "24px";

    const styleButton = (btn, isPrimary = false, isDanger = false) => {
      btn.style.width = "100%";
      btn.style.padding = "14px";
      btn.style.borderRadius = "16px";
      btn.style.border = isDanger ? "1px solid #ef4444" : isPrimary ? "none" : "1px solid var(--line)";
      btn.style.background = isDanger ? "rgba(239, 68, 68, 0.1)" : isPrimary ? "var(--primary)" : "var(--surface-2)";
      btn.style.color = isDanger ? "#ef4444" : isPrimary ? "#fff" : "var(--text)";
      btn.style.fontSize = "1.05rem";
      btn.style.fontWeight = "700";
      btn.style.cursor = "pointer";
      btn.style.transition = "all 0.2s ease";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.style.gap = "8px";

      btn.onmouseenter = () => {
        btn.style.transform = "translateY(-2px)";
        if (isPrimary) btn.style.boxShadow = "0 4px 14px rgba(67, 184, 234, 0.4)";
      };
      btn.onmouseleave = () => {
        btn.style.transform = "translateY(0)";
        if (isPrimary) btn.style.boxShadow = "none";
      };
    };

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg> Account Settings`;
    styleButton(editBtn, true);
    editBtn.onclick = () => window.navigateTo ? window.navigateTo("/settings") : window.location.href = "/settings";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Back to Chat`;
    styleButton(backBtn);
    backBtn.onclick = () => window.navigateTo ? window.navigateTo("/chat") : window.location.href = "/chat";

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> Log Out`;
    styleButton(logoutBtn, false, true);
    logoutBtn.onclick = () => {
      if (typeof logout === 'function') logout();
      else {
        localStorage.removeItem("token");
        window.location.href = "/";
      }
    };

    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(backBtn);
    btnGroup.appendChild(logoutBtn);

    // Place buttons outside (after) the bio card
    profileBioPreviewEl.parentElement.after(btnGroup);
  }

  syncPreview();

  nameEl.addEventListener("input", syncPreview);
  bioEl.addEventListener("input", syncPreview);
  avatarUrlEl.addEventListener("input", syncPreview);
  privateChatEl.addEventListener("change", syncPreview);

  avatarFileEl.addEventListener("change", () => {
    const file = avatarFileEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      avatarUrlEl.value = String(reader.result || "");
      syncPreview();
    };
    reader.onerror = () => setStatus("Failed to read image file.");
    reader.readAsDataURL(file);
  });

  document.getElementById("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    const allowedChatUsers = allowedUsersEl.value
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    const response = await authFetch("/api/profile", {
      method: "PUT",
      body: JSON.stringify({
        name: nameEl.value.trim(),
        bio: bioEl.value.trim(),
        avatarUrl: avatarUrlEl.value.trim(),
        privateChat: privateChatEl.checked,
        allowedChatUsers
      })
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Could not save profile.");
      return;
    }

    saveAuth(data.token, data.user);
    setStatus("Profile updated.", false);
    profileTierEl.textContent = `${(data.user.membershipTier || "free").toUpperCase()} plan`;
    profilePlanMetaEl.textContent = (data.user.membershipTier || "free").toUpperCase();
    syncPreview();
  });

  document.getElementById("upgradeBtn").addEventListener("click", async () => {
    setStatus("");
    const response = await authFetch("/api/membership/upgrade", {
      method: "POST",
      body: JSON.stringify({ plan: "pro" })
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Upgrade failed.");
      return;
    }

    saveAuth(data.token, data.user);
    profileTierEl.textContent = `${(data.user.membershipTier || "free").toUpperCase()} plan`;
    profilePlanMetaEl.textContent = (data.user.membershipTier || "free").toUpperCase();
    setStatus(data.message || "Membership upgraded.", false);
  });
})();
