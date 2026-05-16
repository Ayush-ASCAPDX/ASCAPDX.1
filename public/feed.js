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

  function closeShareModal() {
    if (shareModal) shareModal.style.display = "none";
    currentSharingPost = null;
  }

  async function openShareModal(post) {
    if (!shareModal || !shareUserList) return;
    currentSharingPost = post;
    shareModal.style.display = "flex";

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

    if (whatsApp) whatsApp.href = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    if (instagram) {
      instagram.onclick = (event) => {
        event.preventDefault();
        navigator.clipboard.writeText(shareUrl);
        alert("Instagram requires manual pasting. Link copied to clipboard!");
      };
    }

    shareUserList.innerHTML = allUsers.map((user) => {
      const username = escapeHtml(user.username);
      const encodedUsername = encodeURIComponent(user.username || "");
      const avatar = user.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.username)}&background=15324f&color=d3e3ff`;
      return `
        <button class="share-tile w-full flex items-center gap-3 p-3 text-left" onclick="shareToUser(decodeURIComponent('${encodedUsername}'))" type="button">
          <img class="h-9 w-9 rounded-full border border-white/10 object-cover" src="${avatar}" alt="">
          <span class="text-sm font-semibold">@${username}</span>
        </button>
      `;
    }).join("");
  }

  window.shareToUser = (username) => {
    if (!currentSharingPost) return;
    const shareUrl = window.location.origin + postProfileUrl(currentSharingPost);
    const msg = `Check out @${currentSharingPost.username}'s post: "${currentSharingPost.content}"\n\n${shareUrl}`;

    localStorage.setItem(`chat:prefill:${username}`, msg);
    closeShareModal();
    if (window.navigateTo) {
      window.navigateTo(`/chat?with=${encodeURIComponent(username)}`);
    } else {
      window.location.href = `/chat?with=${encodeURIComponent(username)}`;
    }
  };

  function hideContextMenu() {
    if (contextMenu) contextMenu.style.display = "none";
  }

  function showContextMenu(post, x, y, cardEl) {
    if (!contextMenu) return;

    currentSharingPost = post;
    contextMenu.style.left = `${Math.min(x, window.innerWidth - 190)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - 150)}px`;
    contextMenu.style.display = "block";

    const likeBtn = cardEl.querySelector(".like-btn");
    const isLiked = likeBtn.classList.contains("liked");
    const ctxLikeText = document.getElementById("ctxLikeText");
    if (ctxLikeText) ctxLikeText.textContent = isLiked ? "Unlike Post" : "Like Post";

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
        alert("Link copied!");
      };
    }

    if (!ctxDeleteBtn) return;
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
        } catch (_) {
          alert("Error deleting post.");
        }
      };
    } else {
      ctxDeleteBtn.style.display = "none";
    }
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
          <span class="material-symbols-outlined">favorite</span>
          <span class="like-count">${post.likes || 0}</span>
        </button>
        <button class="comment-btn feed-action" type="button" aria-label="View comments">
          <span class="material-symbols-outlined">chat_bubble</span>
          <span>0</span>
        </button>
        <button class="share-btn feed-action" type="button" aria-label="Share post">
          <span class="material-symbols-outlined">share</span>
          <span>Share</span>
        </button>
      </div>
    `;

    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showContextMenu(post, event.pageX, event.pageY, card);
    });

    card.addEventListener("touchstart", (event) => {
      longPressTimer = setTimeout(() => showContextMenu(post, event.touches[0].pageX, event.touches[0].pageY, card), 500);
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
      showContextMenu(post, event.pageX, event.pageY, card);
    };

    const likeBtn = card.querySelector(".like-btn");
    const likeCountEl = likeBtn.querySelector(".like-count");
    let liked = false;
    let count = post.likes || 0;

    likeBtn.onclick = () => {
      liked = !liked;
      count = liked ? count + 1 : Math.max(0, count - 1);
      likeBtn.classList.toggle("liked", liked);
      likeCountEl.textContent = count;
    };

    card.querySelector(".share-btn").onclick = () => openShareModal(post);
    return card;
  }

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

  const shareCopyLink = document.getElementById("shareCopyLink");
  if (shareCopyLink) {
    shareCopyLink.onclick = () => {
      if (!currentSharingPost) return;
      navigator.clipboard.writeText(window.location.origin + postProfileUrl(currentSharingPost));
      alert("Link copied!");
      closeShareModal();
    };
  }

  try {
    const [freshMe, posts] = await Promise.all([authPromise, postsPromise]);
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

    // --- STORIES INITIALIZATION ---
    await loadStories();

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
const storiesContainer = document.getElementById("storiesContainer");
const storyUploadInput = document.getElementById("storyUploadInput");
const storyViewerModal = document.getElementById("storyViewerModal");
let allStories = []; 
let currentStoryUserIndex = 0;
let currentStoryItemIndex = 0;
let storyTimeout = null;
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
    vid.play().catch(e => console.log("Video autoplay prevented", e));
    vid.onended = nextStory;
  } else {
    img.src = story.mediaUrl;
    img.classList.remove("hidden");
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

