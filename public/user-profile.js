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
      setStatus("User not found.");
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
    if (!me.following) me.following = [];
    let isFollowing = me.following.includes(user.username);
    const followBtn = document.createElement("button");
    followBtn.textContent = isFollowing ? "Disconnect" : "Connect";
    followBtn.onclick = async () => {
      const action = followBtn.textContent.toLowerCase() === "connect" ? "follow" : "unfollow";
      
      // Optimistic UI Update
      isFollowing = action === "follow";
      followBtn.textContent = isFollowing ? "Disconnect" : "Connect";
      
      // Update local context immediately
      if (isFollowing) {
        if (!me.following.includes(user.username)) me.following.push(user.username);
      } else {
        me.following = me.following.filter(u => u !== user.username);
      }
      localStorage.setItem("user", JSON.stringify(me));

      // Background API sync
      const followRes = await authFetch(`/api/users/${encodeURIComponent(user.username)}/${action}`, { 
        method: action === "follow" ? "POST" : "DELETE" 
      });
      
      if (followRes.ok) {
        setStatus(`${action === "follow" ? "Connected with" : "Disconnected from"} @${user.username}`, false);
      } else {
        // Revert on fail
        isFollowing = !isFollowing;
        followBtn.textContent = isFollowing ? "Disconnect" : "Connect";
        if (isFollowing) {
          if (!me.following.includes(user.username)) me.following.push(user.username);
        } else {
          me.following = me.following.filter(u => u !== user.username);
        }
        localStorage.setItem("user", JSON.stringify(me));
        setStatus("Failed to sync follow state.", true);
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
      const modalOverlay = document.createElement("div");
      modalOverlay.style.position = "fixed";
      modalOverlay.style.inset = "0";
      modalOverlay.style.zIndex = "50";
      modalOverlay.style.display = "flex";
      modalOverlay.style.alignItems = "center";
      modalOverlay.style.justifyContent = "center";
      modalOverlay.style.backgroundColor = "rgba(0,0,0,0.6)";
      modalOverlay.style.padding = "16px";
      modalOverlay.innerHTML = `
        <div style="width: 100%; max-width: 400px; border-radius: 16px; border: 1px solid var(--line); background: var(--surface); padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          <h2 style="margin: 0 0 16px; font-size: 1.25rem; font-weight: 700; color: var(--text);">Report @${user.username}</h2>
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; font-weight: 500; color: var(--muted);">Reason</label>
            <select id="reportReason" style="width: 100%; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); padding: 12px; color: var(--text); outline: none;">
              <option value="Spam / Scams">Spam / Scams</option>
              <option value="Harassment / Bullying">Harassment / Bullying</option>
              <option value="Fake Account">Fake Account</option>
              <option value="Inappropriate Content">Inappropriate Content</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div style="margin-bottom: 24px;">
            <label style="display: block; margin-bottom: 8px; font-size: 0.875rem; font-weight: 500; color: var(--muted);">Details (optional)</label>
            <textarea id="reportDetails" rows="3" style="width: 100%; resize: none; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); padding: 12px; color: var(--text); outline: none;" placeholder="Provide more context..."></textarea>
          </div>
          <div style="display: flex; gap: 12px;">
            <button id="cancelReportBtn" style="flex: 1; border-radius: 999px; border: 1px solid var(--line); background: transparent; padding: 10px; font-weight: 600; color: var(--text); cursor: pointer;">Cancel</button>
            <button id="submitReportBtn" style="flex: 1; border-radius: 999px; border: none; background: #ef4444; padding: 10px; font-weight: 600; color: white; cursor: pointer; box-shadow: 0 4px 10px rgba(239,68,68,0.4);">Submit</button>
          </div>
        </div>
      `;
      document.body.appendChild(modalOverlay);

      document.getElementById("cancelReportBtn").onclick = () => modalOverlay.remove();
      document.getElementById("submitReportBtn").onclick = async () => {
        const reason = document.getElementById("reportReason").value;
        const details = document.getElementById("reportDetails").value;
        const btn = document.getElementById("submitReportBtn");
        btn.textContent = "Submitting...";
        btn.disabled = true;

        try {
          const res = await authFetch("/api/reports", {
            method: "POST",
            body: JSON.stringify({ reported: user.username, reason, details })
          });
          const data = await res.json();
          modalOverlay.remove();
          if (res.ok) {
            setStatus("Report submitted successfully.", false);
          } else {
            setStatus(data.error || "Failed to submit report.");
          }
        } catch (e) {
          modalOverlay.remove();
          setStatus("Error submitting report.");
        }
      };
    };
    actionRow.appendChild(reportBtn);

  } catch (err) {
    setStatus("Failed to load user profile.");
  }
})();