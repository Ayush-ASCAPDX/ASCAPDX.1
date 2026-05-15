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
    // For your own profile, add a button to navigate to the main settings page
    const btnGroup = document.createElement("div");
    btnGroup.style.display = "flex";
    btnGroup.style.gap = "0.5rem";
    btnGroup.style.marginTop = "1rem";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-secondary";
    editBtn.textContent = "Account Settings";
    editBtn.onclick = () => window.navigateTo ? window.navigateTo("/settings") : window.location.href = "/settings";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "btn-secondary";
    backBtn.textContent = "Back to Chat";
    backBtn.onclick = () => window.navigateTo ? window.navigateTo("/chat") : window.location.href = "/chat";

    btnGroup.appendChild(editBtn);
    btnGroup.appendChild(backBtn);

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
