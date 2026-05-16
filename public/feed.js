(function() {
  window.initFeedPage = async function() {
    const initToken = Symbol("feedInit");
    window.__feedInitToken = initToken;

    if (!getToken()) {
      window.location.href = "/";
      return;
    }

    let me = getUser() || {};
    const authPromise = requireAuth();
    const postsPromise = authFetch("/api/posts").then(async (res) => {
      if (!res.ok) throw new Error("Failed to load posts");
      return res.json();
    });

    const feedContainer = document.getElementById("feedContainer");
    const headerAvatar = document.getElementById("headerUserAvatar");
    const statusEl = document.getElementById("status");
    const shareModal = document.getElementById("shareModal");
    const shareUserList = document.getElementById("shareUserList");
    const closeShareModalBtn = document.getElementById("closeShareModalBtn");
    const contextMenu = document.getElementById("postContextMenu");
    const ctxLikeBtn = document.getElementById("ctxLike");
    const ctxShareBtn = document.getElementById("ctxShare");
    const ctxCopyLinkBtn = document.getElementById("ctxCopyLink");
    const ctxDeleteBtn = document.getElementById("ctxDelete");

    if (!feedContainer || !statusEl) return;

    if (window.__feedAbortController) window.__feedAbortController.abort();
    const feedAbortController = new AbortController();
    window.__feedAbortController = feedAbortController;

    if (headerAvatar && me.username) {
      headerAvatar.src = me.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(me.username)}&background=15324f&color=d3e3ff`;
    }

    let allUsers = [];
    let currentSharingPost = null;
    let longPressTimer = null;

    function showPostSkeletons() {
      statusEl.style.display = "none";
      feedContainer.innerHTML = Array.from({ length: 3 }, (_, index) => `
        <article class="glass-card feed-card skeleton-card" aria-hidden="true">
          <div class="feed-card-head">
            <div class="feed-author">
              <div class="skeleton-avatar"></div>
              <div class="min-w-0 flex-1">
                <div class="skeleton-line is-title"></div>
                <div class="skeleton-line is-meta"></div>
              </div>
            </div>
            <div class="skeleton-line" style="width: 36px; height: 36px;"></div>
          </div>
          <div class="feed-body">
            <div class="skeleton-line is-body"></div>
            <div class="skeleton-line is-body"></div>
            <div class="skeleton-line is-body is-short"></div>
          </div>
          ${index === 0 ? '<div class="skeleton-media"></div>' : ''}
          <div class="skeleton-actions">
            <div class="skeleton-action"></div>
            <div class="skeleton-action"></div>
            <div class="skeleton-action"></div>
          </div>
        </article>
      `).join("");
    }

    showPostSkeletons();

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text == null ? "" : String(text);
      return div.innerHTML;
    }

    function postProfileUrl(post) {
      return `/user-profile?username=${encodeURIComponent(post.username || "")}`;
    }

    const shareSheet = document.getElementById("shareSheet");

    function closeShareModal() {
      if (!shareModal || !shareSheet) return;
      shareSheet.classList.add("translate-y-full");
      setTimeout(() => {
        shareModal.classList.add("hidden");
        shareModal.classList.remove("flex");
        document.body.style.overflow = "";
      }, 300);
      currentSharingPost = null;
    }

    async function openShareModal(post) {
      if (!shareModal || !shareUserList || !shareSheet) return;
      currentSharingPost = post;
      
      shareModal.classList.remove("hidden");
      shareModal.classList.add("flex");
      document.body.style.overflow = "hidden";
      
      // Force reflow for animation
      shareModal.offsetHeight;
      shareSheet.classList.remove("translate-y-full");

      if (allUsers.length === 0) {
        try {
          const res = await authFetch("/api/users");
          allUsers = await res.json();
        } catch (_) {
          allUsers = [];
        }
      }

      const shareUrl = window.location.origin + postProfileUrl(post);
      const shareText = `${post.author || post.username || "IndiChat"} on ASCAPDX: "${post.content || ""}"`;
      const whatsApp = document.getElementById("shareWhatsApp");
      const instagram = document.getElementById("shareInstagram");
      const copyLink = document.getElementById("shareCopyLink");

      if (whatsApp) {
        whatsApp.onclick = async () => {
          await logShare(post._id, "whatsapp", "whatsapp");
          window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`, "_blank");
        };
      }
      if (instagram) {
        instagram.onclick = async (event) => {
          event.preventDefault();
          await logShare(post._id, "instagram", "instagram");
          navigator.clipboard.writeText(shareUrl);
          showToast("Link copied for Instagram!");
        };
      }
      if (copyLink) {
        copyLink.onclick = async () => {
          navigator.clipboard.writeText(shareUrl);
          showToast("Link copied to clipboard!");
        };
      }

      shareUserList.innerHTML = allUsers.map((user) => {
        const username = escapeHtml(user.username);
        const encodedUsername = encodeURIComponent(user.username || "");
        const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.username)}&background=15324f&color=d3e3ff`;
        return `
          <button class="flex flex-col items-center gap-2 min-w-[72px]" onclick="shareToUser(decodeURIComponent('${encodedUsername}'))" type="button">
            <div class="relative">
              <img class="h-16 w-16 rounded-full border-2 border-primary/20 object-cover p-0.5" src="${avatar}" alt="">
              <div class="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-[#12263f] bg-green-500"></div>
            </div>
            <span class="text-[10px] font-semibold text-white/70 max-w-[72px] truncate">@${username}</span>
          </button>
        `;
      }).join("");
    }

    async function logShare(postId, to, platform) {
      try {
        await authFetch("/api/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postId, to, platform })
        });
      } catch (err) {
        console.error("Failed to log share", err);
      }
    }

    window.shareToUser = async (username) => {
      if (!currentSharingPost) return;
      
      await logShare(currentSharingPost._id, username, "internal");
      
      showToast(`Shared to @${username}`);
      closeShareModal();
    };

    const ctxEditBtn = document.getElementById("ctxEdit");
    const ctxSaveBtn = document.getElementById("ctxSave");
    const editPostModal = document.getElementById("editPostModal");
    const editPostContent = document.getElementById("editPostContent");
    const closeEditModalBtn = document.getElementById("closeEditModalBtn");
    const saveEditBtn = document.getElementById("saveEditBtn");
    const toastContainer = document.getElementById("toastContainer");

    let currentEditingCard = null;

    function showToast(message, type = "success") {
      if (!toastContainer) return;
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      const icon = type === "success" ? "check_circle" : "error";
      toast.innerHTML = `
        <span class="material-symbols-outlined">${icon}</span>
        <span class="font-medium">${message}</span>
      `;
      toastContainer.appendChild(toast);
      setTimeout(() => {
        toast.classList.add("toast-out");
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    const confirmModal = document.getElementById("confirmModal");
    const confirmTitle = document.getElementById("confirmTitle");
    const confirmMessage = document.getElementById("confirmMessage");
    const confirmCancelBtn = document.getElementById("confirmCancelBtn");
    const confirmOkBtn = document.getElementById("confirmOkBtn");

    function showConfirm(title, message, okText = "Yes, Delete") {
      return new Promise((resolve) => {
        if (!confirmModal) return resolve(false);
        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmOkBtn.textContent = okText;
        confirmModal.classList.remove("hidden");
        confirmModal.classList.add("flex");

        const cleanup = (val) => {
          confirmModal.classList.add("hidden");
          confirmModal.classList.remove("flex");
          confirmOkBtn.onclick = null;
          confirmCancelBtn.onclick = null;
          resolve(val);
        };

        confirmOkBtn.onclick = () => cleanup(true);
        confirmCancelBtn.onclick = () => cleanup(false);
        confirmModal.onclick = (e) => { if (e.target === confirmModal) cleanup(false); };
      });
    }

    function hideContextMenu() {
      if (contextMenu) contextMenu.style.display = "none";
    }

    function showContextMenu(post, x, y, cardEl) {
      if (!contextMenu) return;

      currentSharingPost = post;
      const menuWidth = 190;
      const menuHeight = 200; // Estimated height
      contextMenu.style.left = `${Math.min(x, window.innerWidth - menuWidth)}px`;
      contextMenu.style.top = `${Math.min(y, window.innerHeight - menuHeight)}px`;
      contextMenu.style.display = "block";
      contextMenu.classList.remove("hidden"); // Ensure Tailwind's hidden is removed

      const likeBtn = cardEl.querySelector(".like-btn");
      const isLiked = likeBtn.classList.contains("liked");
      const ctxLikeText = document.getElementById("ctxLikeText");
      if (ctxLikeText) ctxLikeText.textContent = isLiked ? "Unlike Post" : "Like Post";

      const isAuthor = post.username === me.username;

      // Show/Hide buttons based on authorship
      if (ctxLikeBtn) ctxLikeBtn.style.display = "flex";
      if (ctxShareBtn) ctxShareBtn.style.display = "flex";
      if (ctxCopyLinkBtn) ctxCopyLinkBtn.style.display = "flex";

      if (ctxLikeBtn) {
        ctxLikeBtn.onclick = () => {
          hideContextMenu();
          likeBtn.click();
        };
      }

      if (ctxShareBtn) {
        ctxShareBtn.onclick = () => {
          hideContextMenu();
          openShareModal(post);
        };
      }

      if (ctxCopyLinkBtn) {
        ctxCopyLinkBtn.onclick = () => {
          hideContextMenu();
          navigator.clipboard.writeText(window.location.origin + postProfileUrl(post));
          showToast("Link copied to clipboard!");
        };
      }

      // Save Logic (Always show for non-authors, also show for authors)
      if (ctxSaveBtn) {
        ctxSaveBtn.style.display = "flex"; // Ensure it's always shown
        const ctxSaveText = document.getElementById("ctxSaveText");
        const isSaved = me.savedPosts && me.savedPosts.includes(post._id);
        if (ctxSaveText) ctxSaveText.textContent = isSaved ? "Unsave Post" : "Save Post";
        
        ctxSaveBtn.onclick = async () => {
          hideContextMenu();
          try {
            const res = await authFetch(`/api/posts/${post._id}/save`, { method: "POST" });
            const data = await res.json();
            if (res.ok) {
              if (!me.savedPosts) me.savedPosts = [];
              if (data.saved) {
                me.savedPosts.push(post._id);
                showToast("Post saved to your profile!");
              } else {
                me.savedPosts = me.savedPosts.filter(id => id !== post._id);
                showToast("Post removed from saved.");
              }
            }
          } catch (_) {
            showToast("Error saving post.", "error");
          }
        };
      }

      // Edit & Delete Logic (Authors only)
      if (isAuthor) {
        if (ctxEditBtn) {
          ctxEditBtn.style.display = "flex";
          ctxEditBtn.onclick = () => {
            hideContextMenu();
            currentEditingCard = cardEl;
            editPostContent.value = post.content;
            editPostModal.classList.remove("hidden");
            editPostModal.classList.add("flex");
          };
        }
        if (ctxDeleteBtn) {
          ctxDeleteBtn.style.display = "flex";
          ctxDeleteBtn.onclick = async () => {
            hideContextMenu();
            const confirmed = await showConfirm("Delete Post?", "Are you sure you want to permanently delete this post?");
            if (!confirmed) return;

            try {
              const res = await authFetch(`/api/posts/${post._id}`, { method: "DELETE" });
              if (res.ok) {
                cardEl.remove();
              } else {
                const data = await res.json();
                showToast(data.error || "Failed to delete post.", "error");
              }
            } catch (_) {
              showToast("Error deleting post.", "error");
            }
          };
        }
      } else {
        if (ctxEditBtn) ctxEditBtn.style.display = "none";
        if (ctxDeleteBtn) ctxDeleteBtn.style.display = "none";
      }
    }

    if (closeEditModalBtn) {
      closeEditModalBtn.onclick = () => {
        editPostModal.classList.add("hidden");
        editPostModal.classList.remove("flex");
      };
    }

    if (saveEditBtn) {
      saveEditBtn.onclick = async () => {
        const newContent = editPostContent.value.trim();
        if (!newContent) return;

        try {
          const res = await authFetch(`/api/posts/${currentSharingPost._id}`, {
            method: "PUT",
            body: JSON.stringify({ content: newContent })
          });
          const data = await res.json();
          if (res.ok) {
            currentSharingPost.content = newContent;
            if (currentEditingCard) {
              currentEditingCard.querySelector(".feed-text").textContent = newContent;
            }
            editPostModal.classList.add("hidden");
            editPostModal.classList.remove("flex");
            showToast("Post updated successfully!");
          } else {
            showToast(data.error || "Failed to update post.", "error");
          }
        } catch (_) {
          showToast("Error updating post.", "error");
        }
      };
    }

    function buildPostElement(post) {
      const card = document.createElement("article");
      card.className = "glass-card feed-card transition-transform duration-200 hover:scale-[1.003]";

      const avatar = post.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(post.author || post.username || "U")}&background=15324f&color=d3e3ff`;
      const time = post.timestamp ? new Date(post.timestamp) : new Date();
      const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const authorName = escapeHtml(post.author || post.username || "IndiChat User");
      const content = escapeHtml(post.content || "");
      const imageUrl = post.imageUrl ? escapeHtml(post.imageUrl) : "";

      card.innerHTML = `
        <div class="feed-card-head">
          <div class="feed-author">
            <img alt="User avatar" class="feed-avatar" src="${avatar}">
            <div>
              <h3 class="feed-name">
                <a href="${postProfileUrl(post)}" class="hover:text-primary transition-colors">${authorName}</a>
              </h3>
              <p class="feed-meta">${timeStr} &bull; ASCAPDX Network</p>
            </div>
          </div>
          <button class="feed-more context-menu-trigger" type="button" aria-label="Post options">
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
        </div>
        <div class="feed-body">
          <p class="feed-text">${content}</p>
        </div>
        ${imageUrl ? `
          <div class="feed-media">
            <img src="${imageUrl}" alt="Post content">
          </div>
        ` : ""}
        <div class="feed-actions">
          <button class="like-btn feed-action" type="button" aria-label="Like post">
            <span class="material-symbols-outlined">thumb_up</span>
            <span class="like-count">${Array.isArray(post.likes) ? post.likes.length : 0}</span>
          </button>
          <button class="dislike-btn feed-action" type="button" aria-label="Dislike post">
            <span class="material-symbols-outlined">thumb_down</span>
            <span class="dislike-count">${Array.isArray(post.dislikes) ? post.dislikes.length : 0}</span>
          </button>
          <button class="quick-share-btn feed-action" type="button" aria-label="Quick share">
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
      `;

      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showContextMenu(post, event.clientX, event.clientY, card);
      });

      card.addEventListener("touchstart", (event) => {
        longPressTimer = setTimeout(() => showContextMenu(post, event.touches[0].clientX, event.touches[0].clientY, card), 500);
      }, { passive: true });
      card.addEventListener("touchend", () => clearTimeout(longPressTimer));
      card.addEventListener("touchmove", () => clearTimeout(longPressTimer));

      const profileLink = card.querySelector("a");
      profileLink.onclick = (event) => {
        event.preventDefault();
        const href = event.currentTarget.getAttribute("href");
        if (window.navigateTo) {
          window.navigateTo(href);
        } else {
          window.location.href = href;
        }
      };

      const moreBtn = card.querySelector(".context-menu-trigger");
      moreBtn.onclick = (event) => {
        event.stopPropagation();
        showContextMenu(post, event.clientX, event.clientY, card);
      };

      const likeBtn = card.querySelector(".like-btn");
      const likeCountEl = likeBtn.querySelector(".like-count");
      const dislikeBtn = card.querySelector(".dislike-btn");
      const dislikeCountEl = dislikeBtn.querySelector(".dislike-count");
      
      const likesArray = Array.isArray(post.likes) ? post.likes : [];
      const dislikesArray = Array.isArray(post.dislikes) ? post.dislikes : [];

      let liked = likesArray.includes(me.username);
      let disliked = dislikesArray.includes(me.username);

      likeBtn.classList.toggle("liked", liked);
      dislikeBtn.classList.toggle("disliked", disliked);

      likeBtn.onclick = async () => {
        try {
          const res = await authFetch(`/api/posts/${post._id}/like`, { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            liked = data.liked;
            disliked = data.disliked;
            likeBtn.classList.toggle("liked", liked);
            dislikeBtn.classList.toggle("disliked", disliked);
            likeCountEl.textContent = data.likes;
            dislikeCountEl.textContent = data.dislikes;
          }
        } catch (err) {
          console.error("Failed to like post", err);
        }
      };

      dislikeBtn.onclick = async () => {
        try {
          const res = await authFetch(`/api/posts/${post._id}/dislike`, { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            liked = data.liked;
            disliked = data.disliked;
            likeBtn.classList.toggle("liked", liked);
            dislikeBtn.classList.toggle("disliked", disliked);
            likeCountEl.textContent = data.likes;
            dislikeCountEl.textContent = data.dislikes;
          }
        } catch (err) {
          console.error("Failed to dislike post", err);
        }
      };


      const quickShareBtn = card.querySelector(".quick-share-btn");
      quickShareBtn.onclick = () => openShareModal(post);

      return card;
    }

    // Use the controller declared at the top
    document.addEventListener("click", (event) => {
      if (contextMenu && !contextMenu.contains(event.target)) hideContextMenu();
    }, { signal: feedAbortController.signal });
    window.addEventListener("scroll", hideContextMenu, { signal: feedAbortController.signal });

    if (closeShareModalBtn) closeShareModalBtn.onclick = closeShareModal;
    if (shareModal) {
      shareModal.onclick = (event) => {
        if (event.target === shareModal) closeShareModal();
      };
    }

    try {
      const [freshMe, posts] = await Promise.all([authPromise, postsPromise, loadStories()]);
      if (window.__feedInitToken !== initToken) return;
      if (!freshMe) return;

      me = freshMe;
      if (headerAvatar) {
        headerAvatar.src = me.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(me.username)}&background=15324f&color=d3e3ff`;
      }

      statusEl.style.display = "none";
      feedContainer.innerHTML = "";

      if (Array.isArray(posts) && posts.length > 0) {
        const fragment = document.createDocumentFragment();
        posts.forEach((post) => fragment.appendChild(buildPostElement(post)));
        feedContainer.appendChild(fragment);
      } else {
        statusEl.style.display = "flex";
        statusEl.innerHTML = '<p class="text-lg italic">No updates yet.</p>';
      }

      // loadStories is now handled by the Promise.all above


    } catch (_) {
      statusEl.style.display = "flex";
      statusEl.innerHTML = '<p class="text-lg italic">Failed to load feed.</p>';
    }
  };

  function startFeedPageWhenReady() {
    if (!location.pathname.includes("/feed")) return;
    if (window.initFeedPage) window.initFeedPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startFeedPageWhenReady, { once: true });
  } else {
    startFeedPageWhenReady();
  }

  // --- STORIES LOGIC ---
  var storiesContainer = document.getElementById("storiesContainer");
  var storyUploadInput = document.getElementById("storyUploadInput");
  var storyViewerModal = document.getElementById("storyViewerModal");
  var allStories = []; 
  var currentStoryUserIndex = 0;
  var currentStoryItemIndex = 0;
  var storyTimeout = null;
  const STORY_DURATION = 5000;

  window.loadStories = async function() {
    try {
      const res = await authFetch("/api/stories");
      if (res.ok) {
        allStories = await res.json();
        renderStoriesCarousel();
      }
    } catch (e) {
      console.error("Failed to load stories", e);
    }
  };

  function renderStoriesCarousel() {
    if (!storiesContainer) return;
    const currentUser = getUser();
    const currentUserStoryIndex = allStories.findIndex(g => g.username === currentUser?.username);
    const currentUserStory = currentUserStoryIndex !== -1 ? allStories[currentUserStoryIndex] : null;
    const yourStoryOnClick = currentUserStory ? `openStoryViewer(${currentUserStoryIndex})` : "document.getElementById('storyUploadInput').click()";
    
    let html = `
      <button class="story" type="button" onclick="${yourStoryOnClick}">
        <span class="story-avatar ${currentUserStory ? 'has-story' : 'is-muted'}" style="${currentUserStory ? 'border: 2px solid #52c6f6; padding: 2px;' : ''}">
          <img alt="Your avatar" src="${currentUser?.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.username || 'U')}&background=15324f&color=d3e3ff`}" />
          ${currentUserStory ? '' : '<span class="story-add">+</span>'}
        </span>
        <span class="w-full truncate text-center text-[#95abc5]">Your Story</span>
      </button>
    `;

    allStories.forEach((group, userIndex) => {
      if (group.username === currentUser?.username) return; 
      const avatar = group.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(group.author || group.username)}&background=15324f&color=d3e3ff`;
      html += `
        <div class="story cursor-pointer" onclick="openStoryViewer(${userIndex})">
          <span class="story-avatar has-story" style="border: 2px solid #52c6f6; padding: 2px; border-radius: 999px;">
            <img alt="${group.author || group.username}" src="${avatar}" />
          </span>
          <span class="w-full truncate text-center">${group.author || group.username}</span>
        </div>
      `;
    });

    storiesContainer.innerHTML = html;
  }

  if (storyUploadInput) {
    storyUploadInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      e.target.value = "";
      
      const isVideo = file.type.startsWith("video/");
      const fileKind = isVideo ? "video" : "image";
      
      const statusEl = document.getElementById("status");
      statusEl.style.display = "flex";
      statusEl.textContent = `Uploading story... 0%`;
      
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/uploads");
        xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
        xhr.setRequestHeader("X-File-Kind", fileKind);
        
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            statusEl.textContent = `Uploading story... ${pct}%`;
          }
        };
        
        const uploadResponse = await new Promise((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
            else reject(new Error("Upload failed"));
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send(file);
        });
        
        let mediaUrl = uploadResponse;
        try { const j = JSON.parse(uploadResponse); if(j.url) mediaUrl = j.url; } catch(e){}
        
        statusEl.textContent = "Publishing story...";
        const res = await authFetch("/api/stories", {
          method: "POST",
          body: JSON.stringify({ mediaUrl, mediaType: fileKind })
        });
        
        if (res.ok) {
          statusEl.style.display = "none";
          loadStories();
        } else {
          throw new Error("Failed to publish");
        }
      } catch (err) {
        statusEl.textContent = "Error: " + err.message;
        setTimeout(() => { statusEl.style.display = "none"; }, 3000);
      }
    });
  }

  window.openStoryViewer = function(userIndex) {
    if (!allStories[userIndex]) return;
    currentStoryUserIndex = userIndex;
    currentStoryItemIndex = 0;
    storyViewerModal.classList.remove("hidden");
    storyViewerModal.classList.add("flex");
    renderStoryItem();
  };

  function closeStoryViewer() {
    storyViewerModal.classList.add("hidden");
    storyViewerModal.classList.remove("flex");
    clearTimeout(storyTimeout);
    const vid = document.getElementById("storyViewerVideo");
    if(vid) vid.pause();
  }

  function renderStoryItem() {
    clearTimeout(storyTimeout);
    const userGroup = allStories[currentStoryUserIndex];
    if (!userGroup) {
      closeStoryViewer();
      return;
    }
    const story = userGroup.items[currentStoryItemIndex];
    if (!story) {
      if (currentStoryUserIndex + 1 < allStories.length) {
        currentStoryUserIndex++;
        currentStoryItemIndex = 0;
        renderStoryItem();
      } else {
        closeStoryViewer();
      }
      return;
    }

    document.getElementById("storyViewerAvatar").src = userGroup.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(userGroup.author || userGroup.username)}`;
    document.getElementById("storyViewerName").textContent = userGroup.author || userGroup.username;
    
    const progressContainer = document.getElementById("storyProgressContainer");
    progressContainer.innerHTML = userGroup.items.map((_, idx) => `
      <div class="h-1 flex-1 bg-white/30 rounded-full overflow-hidden">
        <div class="h-full bg-white transition-all duration-100 ease-linear" 
             style="width: ${idx < currentStoryItemIndex ? '100%' : '0%'}"></div>
      </div>
    `).join("");

    const img = document.getElementById("storyViewerImage");
    const vid = document.getElementById("storyViewerVideo");
    img.classList.add("hidden");
    vid.classList.add("hidden");
    vid.pause();

    const currentProgressBar = progressContainer.children[currentStoryItemIndex].firstElementChild;
    requestAnimationFrame(() => {
      currentProgressBar.style.transitionDuration = `${STORY_DURATION}ms`;
      currentProgressBar.style.width = '100%';
    });

    if (story.mediaType === "video") {
      vid.src = story.mediaUrl;
      vid.classList.remove("hidden");
      vid.play().catch(() => {});
      vid.onended = nextStory;
    } else {
      img.onload = () => {
        img.classList.remove("hidden");
        img.style.display = "block";
      };
      img.onerror = () => {
        // Show a placeholder or error state if needed
      };
      img.src = `${story.mediaUrl}?t=${Date.now()}`;
      
      // If image is already in cache and loaded instantly
      if (img.complete) {
        img.classList.remove("hidden");
      }
      
      storyTimeout = setTimeout(nextStory, STORY_DURATION);
    }
  }

  function nextStory() {
    currentStoryItemIndex++;
    renderStoryItem();
  }

  function prevStory() {
    if (currentStoryItemIndex > 0) {
      currentStoryItemIndex--;
      renderStoryItem();
    } else if (currentStoryUserIndex > 0) {
      currentStoryUserIndex--;
      currentStoryItemIndex = allStories[currentStoryUserIndex].items.length - 1;
      renderStoryItem();
    }
  }

  const closeBtn = document.getElementById("closeStoryViewer");
  if (closeBtn) closeBtn.addEventListener("click", closeStoryViewer);

  const tapLeft = document.getElementById("storyTapLeft");
  if (tapLeft) tapLeft.addEventListener("click", prevStory);

  const tapRight = document.getElementById("storyTapRight");
  if (tapRight) tapRight.addEventListener("click", nextStory);
})();
