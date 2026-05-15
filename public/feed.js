window.initFeedPage = async function() { // Expose init as a global function
  const me = await requireAuth();
  if (!me) return;

  const feedContainer = document.getElementById("feedContainer");
  const statusEl = document.getElementById("status");

  const shareModal = document.getElementById("shareModal");
  const shareUserList = document.getElementById("shareUserList");
  const closeShareModalBtn = document.getElementById("closeShareModalBtn");
  let allUsers = [];

  const contextMenu = document.getElementById("postContextMenu");
  const ctxLikeBtn = document.getElementById("ctxLike");
  const ctxShareBtn = document.getElementById("ctxShare");
  const ctxCopyLinkBtn = document.getElementById("ctxCopyLink");
  const ctxDeleteBtn = document.getElementById("ctxDelete");
  let currentSharingPost = null;

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function openShareModal(post) {
    currentSharingPost = post;
    shareModal.classList.add("open");
    
    if (allUsers.length === 0) {
      try {
        const res = await authFetch("/api/users");
        allUsers = await res.json();
      } catch (_) {}
    }

    const shareUrl = window.location.origin + `/user-profile?username=${encodeURIComponent(post.username)}`;
    const shareText = `${post.author} on ASCAPDX: "${post.content}"`;

    // External Links
    document.getElementById("shareWhatsApp").href = `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`;
    document.getElementById("shareInstagram").onclick = (e) => {
      e.preventDefault();
      alert("Instagram requires manual pasting. Link copied to clipboard!");
      navigator.clipboard.writeText(shareUrl);
    };

    // Render User List
    shareUserList.innerHTML = allUsers.map(u => `
      <div class="share-user-item" onclick="shareToUser('${escapeHtml(u.username)}')">
        <img class="share-user-avatar" src="${u.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || u.username)}&background=1d4ed8&color=fff`}">
        <span class="share-user-name">@${escapeHtml(u.username)}</span>
      </div>
    `).join("");
  }

  window.shareToUser = (username) => {
    if (!currentSharingPost) return;
    const shareUrl = window.location.origin + `/user-profile?username=${encodeURIComponent(currentSharingPost.username)}`;
    const msg = `Check out @${currentSharingPost.username}'s post: "${currentSharingPost.content}"\n\n${shareUrl}`;
    
    // Save intended message to localStorage so chat script can pick it up
    localStorage.setItem(`chat:prefill:${username}`, msg);
    closeShareModal();
    if (window.navigateTo) window.navigateTo(`/chat?with=${encodeURIComponent(username)}`);
  };

  function closeShareModal() {
    shareModal.classList.remove("open");
    currentSharingPost = null;
  }

  let longPressTimer = null;
  function showContextMenu(post, x, y, cardEl) {
    currentSharingPost = post;
    contextMenu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;
    contextMenu.classList.add("active");

    const likeBtn = cardEl.querySelector(".like-btn");
    const isLiked = likeBtn.classList.contains("liked");
    document.getElementById("ctxLikeText").textContent = isLiked ? "Unlike Post" : "Like Post";

    ctxLikeBtn.onclick = () => {
      hideContextMenu();
      likeBtn.click();
    };

    ctxShareBtn.onclick = () => {
      hideContextMenu();
      openShareModal(post);
    };

    ctxCopyLinkBtn.onclick = () => {
      hideContextMenu();
      const url = window.location.origin + `/user-profile?username=${encodeURIComponent(post.username)}`;
      navigator.clipboard.writeText(url);
      alert("Link copied!");
    };

    if (post.username === me.username) {
      ctxDeleteBtn.style.display = "flex";
      ctxDeleteBtn.onclick = async () => {
        hideContextMenu();
        if (!confirm("Are you sure you want to delete this post?")) return;
        try {
          const res = await authFetch(`/api/posts/${post._id}`, { method: "DELETE" });
          if (res.ok) {
            cardEl.remove();
          } else {
            const data = await res.json();
            alert(data.error || "Failed to delete post.");
          }
        } catch (err) {
          alert("Error deleting post.");
        }
      };
    } else {
      ctxDeleteBtn.style.display = "none";
    }
  }

  function hideContextMenu() {
    contextMenu.classList.remove("active");
  }

  document.addEventListener("click", (e) => {
    if (!contextMenu.contains(e.target)) hideContextMenu();
  });

  window.addEventListener("scroll", hideContextMenu);

  function buildPostElement(post) {
    const div = document.createElement("div");
    div.className = "post-card";
    
    const avatar = post.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.author)}&background=1d4ed8&color=fff`;
    const timeStr = new Date(post.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div class="post-head">
        <img src="${avatar}" class="post-avatar" alt="Avatar">
        <div class="post-meta">
          <a href="/user-profile?username=${encodeURIComponent(post.username)}" class="post-author">@${post.username}</a>
          <span class="post-time">${timeStr}</span>
        </div>
      </div>
      <div class="post-content">${post.content}</div>
      ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image">` : ""}
      <div class="post-actions">
        <button class="like-btn" type="button">
          <span class="heart-icon">♥</span>
          <span class="like-count">${post.likes || 0}</span>
        </button>
        <button class="share-btn" type="button">
          <span class="share-icon">➦</span>
          <span>Share</span>
        </button>
      </div>
    `;

    // Context Menu Event Listeners (Right-click & Long-press)
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(post, e.pageX, e.pageY, div);
    });

    div.addEventListener("touchstart", (e) => {
      longPressTimer = setTimeout(() => showContextMenu(post, e.touches[0].pageX, e.touches[0].pageY, div), 500);
    }, { passive: true });
    div.addEventListener("touchend", () => clearTimeout(longPressTimer));
    div.addEventListener("touchmove", () => clearTimeout(longPressTimer));

    // Use SPA navigation for the author link
    div.querySelector(".post-author").onclick = (e) => {
      e.preventDefault();
      if (window.navigateTo) window.navigateTo(e.currentTarget.getAttribute("href"));
    };

    // Like button logic
    const likeBtn = div.querySelector(".like-btn");
    const likeCountEl = likeBtn.querySelector(".like-count");
    let liked = false;
    let count = post.likes || 0;

    likeBtn.onclick = () => {
      liked = !liked;
      count = liked ? count + 1 : count - 1;
      likeBtn.classList.toggle("liked", liked);
      likeCountEl.textContent = count;
    };

    // Share button logic
    const shareBtn = div.querySelector(".share-btn");
    shareBtn.onclick = () => openShareModal(post);

    return div;
  }

  closeShareModalBtn.onclick = closeShareModal;
  shareModal.onclick = (e) => { if(e.target === shareModal) closeShareModal(); };
  document.getElementById("shareCopyLink").onclick = () => {
    if (!currentSharingPost) return;
    const url = window.location.origin + `/user-profile?username=${encodeURIComponent(currentSharingPost.username)}`;
    navigator.clipboard.writeText(url);
    alert("Link copied!");
    closeShareModal();
  };

  try {
    const res = await authFetch("/api/posts");
    const posts = await res.json();
    
    if (posts.length > 0) {
      statusEl.style.display = "none";
      const fragment = document.createDocumentFragment();
      posts.forEach(p => fragment.appendChild(buildPostElement(p)));
      feedContainer.appendChild(fragment);
    }
  } catch (err) {
    statusEl.textContent = "Failed to load feed.";
  }
}; // No longer an IIFE, just defines the global function