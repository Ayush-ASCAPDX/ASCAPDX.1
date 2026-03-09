(async function initProfilePage() {
  const me = await requireAuth();
  if (!me) return;

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

  function avatarFallback(name) {
    const first = (name || me.username || "?").slice(0, 1).toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><rect width='100%' height='100%' fill='#1d4ed8'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI, Arial' font-size='90' fill='#dbeafe'>${first}</text></svg>`)}`;
  }

  function syncPreview() {
    const displayName = nameEl.value.trim() || me.name || me.username;
    const bioText = bioEl.value.trim();
    const isPrivate = !!privateChatEl.checked;
    profileNameEl.textContent = displayName;
    profileHandleEl.textContent = `@${me.username}`;
    profileUsernameMetaEl.textContent = `@${me.username}`;
    profilePrivacyMetaEl.textContent = isPrivate ? "Private chat" : "Open chat";
    profileBioPreviewEl.textContent = bioText || "Add a short bio so people in your chats and groups recognize you instantly.";
    bioCountEl.textContent = `${bioText.length} / 280`;
    const src = avatarUrlEl.value.trim() || me.avatarUrl || avatarFallback(displayName);
    avatarPreviewEl.src = src;
  }

  nameEl.value = me.name || "";
  bioEl.value = me.bio || "";
  avatarUrlEl.value = me.avatarUrl || "";
  usernameDisplayEl.value = `@${me.username}`;
  privateChatEl.checked = !!me.privateChat;
  allowedUsersEl.value = Array.isArray(me.allowedChatUsers) ? me.allowedChatUsers.join(", ") : "";
  profileTierEl.textContent = `${(me.membershipTier || "free").toUpperCase()} plan`;
  profilePlanMetaEl.textContent = (me.membershipTier || "free").toUpperCase();
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
