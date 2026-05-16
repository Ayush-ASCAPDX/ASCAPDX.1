(async function initEditProfile() {
  const me = await requireAuth();
  if (!me) {
    window.location.href = "/";
    return;
  }

  const backBtn = document.getElementById("backBtn");
  const avatarUploadTrigger = document.getElementById("avatarUploadTrigger");
  const avatarFileEl = document.getElementById("avatarFile");
  const avatarPreview = document.getElementById("avatarPreview");
  const avatarUrlEl = document.getElementById("avatarUrl");
  const nameInput = document.getElementById("nameInput");
  const usernameInput = document.getElementById("usernameInput");
  const bioInput = document.getElementById("bioInput");
  const bioCount = document.getElementById("bioCount");
  const saveBtn = document.getElementById("saveBtn");
  const statusEl = document.getElementById("status");

  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#ef4444" : "#10b981";
  }

  function avatarFallback(name) {
    const first = (name || me.username || "?").slice(0, 1).toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><rect width='100%' height='100%' fill='#1d4ed8'/><text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI, Arial' font-size='90' fill='#dbeafe'>${first}</text></svg>`)}`;
  }

  // Pre-fill fields
  nameInput.value = me.name || "";
  usernameInput.value = `@${me.username}`;
  bioInput.value = me.bio || "";
  avatarUrlEl.value = me.avatarUrl || "";
  avatarPreview.src = me.avatarUrl || avatarFallback(me.name);
  bioCount.textContent = `${bioInput.value.length} / 280`;

  // Bio character count
  bioInput.addEventListener("input", () => {
    bioCount.textContent = `${bioInput.value.length} / 280`;
  });

  // Avatar upload
  avatarUploadTrigger.addEventListener("click", () => {
    avatarFileEl.click();
  });

  avatarFileEl.addEventListener("change", () => {
    const file = avatarFileEl.files?.[0];
    if (!file) return;
    
    // Convert to Base64 to preview and save
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      avatarUrlEl.value = result;
      avatarPreview.src = result;
    };
    reader.onerror = () => setStatus("Failed to read image file.", true);
    reader.readAsDataURL(file);
  });

  // Save changes
  saveBtn.addEventListener("click", async () => {
    setStatus("Saving...");
    saveBtn.disabled = true;

    try {
      const response = await authFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: nameInput.value.trim(),
          bio: bioInput.value.trim(),
          avatarUrl: avatarUrlEl.value.trim()
        })
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not save profile.", true);
        saveBtn.disabled = false;
        return;
      }

      saveAuth(data.token, data.user);
      setStatus("Profile updated successfully!");
      
      // Navigate back after a short delay
      setTimeout(() => {
        window.location.href = "/profile";
      }, 700);

    } catch (err) {
      setStatus("Network error while saving.", true);
      saveBtn.disabled = false;
    }
  });

  // Back button
  backBtn.addEventListener("click", () => {
    window.location.href = "/profile";
  });

})();
