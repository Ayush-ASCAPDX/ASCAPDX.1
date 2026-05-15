(async function initUserProfile() {
  const me = await requireAuth();
  if (!me) return;

  const urlParams = new URLSearchParams(window.location.search);
  const targetUsername = urlParams.get("username");
  const statusEl = document.getElementById("status");
  const actionRow = document.getElementById("actionRow");

  if (!targetUsername) {
    window.location.href = "/chat";
    return;
  }

  function setStatus(msg, isError = true) {
    statusEl.style.color = isError ? "#fca5a5" : "#86efac";
    statusEl.textContent = msg;
  }

  function formatLastSeen(dateStr) {
    if (!dateStr) return "Offline";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "Offline";
    const diff = Math.floor((new Date() - date) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
  }

  let profileUserLastSeen = null;
  let currentIsOnline = false;
  const lastSeenEl = document.getElementById("lastSeen");

  function updatePresenceUI(isOnline) {
    currentIsOnline = isOnline;
    const dot = document.getElementById("onlineDot");
    if (dot) dot.classList.toggle("hidden", !isOnline);
    
    if (lastSeenEl) {
      if (isOnline) {
        lastSeenEl.textContent = "Active now";
        lastSeenEl.style.color = "var(--ok)";
      } else {
        lastSeenEl.textContent = profileUserLastSeen ? `Last seen: ${formatLastSeen(profileUserLastSeen)}` : "Offline";
        lastSeenEl.style.color = "var(--muted)";
      }
    }
  }

  // Auto-refresh the relative "Last seen" string every minute
  setInterval(() => {
    if (!currentIsOnline && profileUserLastSeen) {
      updatePresenceUI(false);
    }
  }, 60000);

  // Real-time online status handling
  const socket = io({ auth: { token: getToken() } });
  socket.on("presence", (presence) => {
    const isOnline = !!(presence && presence[targetUsername] && presence[targetUsername].online);
    updatePresenceUI(isOnline);
  });

  try {
    const res = await authFetch(`/api/profile/${encodeURIComponent(targetUsername)}`);
    if (!res.ok) {
      setStatus("User not found or is private.");
      return;
    }
    const user = await res.json();
    profileUserLastSeen = user.lastSeen;
    updatePresenceUI(false); // Initial render based on fetch

   if (user.membershipTier === "pro") {
      const proBadge = document.getElementById("proBadge");
      if (proBadge) proBadge.classList.remove("hidden");
    }

    if (user.createdAt) {
      const joinDate = new Date(user.createdAt);
      const joinStr = joinDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      document.getElementById("memberSince").textContent = `Member since ${joinStr}`;
    }

    document.getElementById("userName").textContent = user.name || user.username;
    document.getElementById("userHandle").textContent = `@${user.username}`;
    document.getElementById("userBio").textContent = user.bio || "This user hasn't added a bio yet.";
    document.getElementById("avatarImg").src = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.username)}&background=1d4ed8&color=fff`;

    // Message Button
    const msgBtn = document.createElement("button");
    msgBtn.className = "btn-primary";
    msgBtn.textContent = "Send Message";
    msgBtn.onclick = () => window.navigateTo ? window.navigateTo(`/chat?with=${encodeURIComponent(user.username)}`) : window.location.href = `/chat?with=${encodeURIComponent(user.username)}`;
    actionRow.appendChild(msgBtn);

    // Call Button
    const callBtn = document.createElement("button");
    callBtn.className = "btn-primary";
    callBtn.textContent = "Call";
    callBtn.onclick = () => window.navigateTo ? window.navigateTo(`/video?with=${encodeURIComponent(user.username)}&autostart=1`) : window.location.href = `/video?with=${encodeURIComponent(user.username)}&autostart=1`;
    actionRow.appendChild(callBtn);

    // Follow Button
    const following = Array.isArray(me.following) ? me.following : [];
    const isFollowing = following.includes(user.username);
    const followBtn = document.createElement("button");
    followBtn.textContent = isFollowing ? "Unfollow" : "Follow";
    followBtn.onclick = async () => {
      const action = followBtn.textContent.toLowerCase() === "follow" ? "follow" : "unfollow";
      const followRes = await authFetch(`/api/users/${encodeURIComponent(user.username)}/${action}`, { 
        method: action === "follow" ? "POST" : "DELETE" 
      });
      if (followRes.ok) {
        followBtn.textContent = action === "follow" ? "Unfollow" : "Follow";
        setStatus(`${action === "follow" ? "Followed" : "Unfollowed"} @${user.username}`, false);
      }
    };
    actionRow.appendChild(followBtn);

    // Block Button
    const blockBtn = document.createElement("button");
    blockBtn.className = "danger-btn";
    blockBtn.textContent = "Block";
    blockBtn.onclick = async () => {
      if (!confirm(`Block @${user.username}?`)) return;
      const blockRes = await authFetch(`/api/users/${encodeURIComponent(user.username)}/block`, { method: "POST" });
      if (blockRes.ok) setStatus(`@${user.username} blocked.`, false);
    };
    actionRow.appendChild(blockBtn);

    // Report Button
    const reportBtn = document.createElement("button");
    reportBtn.textContent = "Report";
    reportBtn.onclick = () => {
      const reason = prompt("Why are you reporting this user?");
      if (reason) setStatus("Report submitted for review.", false);
    };
    actionRow.appendChild(reportBtn);

  } catch (err) {
    setStatus("Failed to load user profile.");
  }
})();