(async function initCreatePostPage() {
  const me = await requireAuth();
  if (!me) return;

  const postContentInput = document.getElementById("postContent");
  const postImageInput = document.getElementById("postImageInput");
  const postImagePreview = document.getElementById("postImagePreview");
  const imagePreviewWrap = document.getElementById("imagePreviewWrap");
  const submitPostBtn = document.getElementById("submitPostBtn");
  const uploadProgressContainer = document.getElementById("uploadProgressContainer");
  const uploadProgressBar = document.getElementById("uploadProgressBar");
  const uploadProgressText = document.getElementById("uploadProgressText");
  const mentionSuggestions = document.getElementById("mentionSuggestions");
  const statusEl = document.getElementById("status");
  const removeImgBtn = document.getElementById("removeImgBtn");
  const progressCircle = document.getElementById("progressCircle");
  const charCountLabel = document.getElementById("charCountLabel");
  const indicatorWrap = document.getElementById("indicatorWrap");
  const emojiBtn = document.getElementById("emojiBtn");
  const emojiPicker = document.getElementById("emojiPicker");

  const MAX_CHARS = 280;
  let allUsers = [];
  let selectedImageUrl = "";
  let mentionSearchTerm = "";
  let selectedMentionIndex = -1;

  // Setup User Identity
  document.getElementById("composerUserAvatar").src = me.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(me.name || me.username)}&background=1d4ed8&color=fff`;
  document.getElementById("composerUserName").textContent = me.name || me.username;
  postContentInput.focus();

  function updateCharCount() {
    const len = postContentInput.value.length;
    const remaining = MAX_CHARS - len;
    const percentage = Math.min((len / MAX_CHARS) * 100, 100);
    
    // SVG Progress logic (Circumference is 100 in this viewBox setup)
    progressCircle.style.strokeDashoffset = 100 - percentage;

    // UI State
    if (len >= MAX_CHARS) {
      progressCircle.classList.add("over-limit");
      charCountLabel.textContent = remaining;
      charCountLabel.style.color = "#ef4444";
      
      if (len > MAX_CHARS) {
        indicatorWrap.classList.remove("shake");
        void indicatorWrap.offsetWidth; // Force reflow to restart animation
        indicatorWrap.classList.add("shake");
      }
    } else if (len >= MAX_CHARS * 0.8) {
      progressCircle.classList.remove("over-limit");
      progressCircle.classList.add("near-limit");
      charCountLabel.textContent = remaining;
      charCountLabel.style.color = "#fbbf24";
    } else {
      progressCircle.classList.remove("over-limit", "near-limit");
      charCountLabel.textContent = "";
    }

    submitPostBtn.disabled = len > MAX_CHARS || (len === 0 && !selectedImageUrl);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function setStatus(msg, isError = true) {
    statusEl.style.color = isError ? "#fca5a5" : "#86efac";
    statusEl.textContent = msg;
  }

  // Image Compression & Handling
  document.getElementById("addImgBtn").onclick = () => postImageInput.click();
  
  postImageInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    setStatus("Processing image...");
    submitPostBtn.disabled = true;

    try {
      const compressedBase64 = await compressImage(file);
      selectedImageUrl = compressedBase64;
      postImagePreview.src = compressedBase64;
      imagePreviewWrap.classList.add("active");
      setStatus("");
    } catch (err) {
      setStatus("Failed to process image.");
    } finally {
      submitPostBtn.disabled = false;
    }
  };

  async function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 1200;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = reject;
    });
  }

  removeImgBtn.onclick = () => {
    selectedImageUrl = "";
    postImageInput.value = "";
    imagePreviewWrap.classList.remove("active");
  };

  // Emoji Picker Logic
  const emojis = ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀", "☠️", "💩", "🤡", "👹", "👺", "👻", "👽", "👾", "🤖", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾", "🙈", "🙉", "🙊", "💋", "💌", "💘", "💝", "💖", "💗", "💓", "💞", "💕", "💟", "❣️", "💔", "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💯", "💢", "💥", "💫", "💦", "💨", "🕳️", "💣", "💬", "👁️‍🗨️", "🗨️", "🗯️", "💭", "💤"];
  
  emojiPicker.innerHTML = emojis.map(e => `<span class="emoji-item">${e}</span>`).join("");

  emojiBtn.onclick = (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle("active");
    hideMentionSuggestions();
  };

  emojiPicker.addEventListener("click", (e) => {
    const item = e.target.closest(".emoji-item");
    if (!item) return;
    
    const emoji = item.textContent;
    const start = postContentInput.selectionStart;
    const end = postContentInput.selectionEnd;
    const text = postContentInput.value;
    
    postContentInput.value = text.substring(0, start) + emoji + text.substring(end);
    postContentInput.focus();
    postContentInput.selectionStart = postContentInput.selectionEnd = start + emoji.length;
    
    updateCharCount();
    emojiPicker.classList.remove("active");
  });

  document.addEventListener("click", () => emojiPicker.classList.remove("active"));

  // Mention Logic
  postContentInput.addEventListener("input", handleMentionInput);
  postContentInput.addEventListener("input", updateCharCount);
  postContentInput.addEventListener("keydown", handleMentionKeydown);

  async function fetchAllUsers() {
    try {
      const res = await authFetch("/api/users");
      if (res.ok) allUsers = await res.json();
    } catch (_) {}
  }
  fetchAllUsers();

  function handleMentionInput() {
    const text = postContentInput.value;
    const cursorPosition = postContentInput.selectionStart;
    const lastAtIndex = text.lastIndexOf("@", cursorPosition - 1);
    if (lastAtIndex !== -1) {
      const mentionCandidate = text.substring(lastAtIndex + 1, cursorPosition);
      if (/^\w*$/.test(mentionCandidate)) {
        showMentionSuggestions(mentionCandidate);
        emojiPicker.classList.remove("active");
        return;
      }
    }
    hideMentionSuggestions();
  }

  function showMentionSuggestions(term) {
    const filteredUsers = allUsers.filter(u => 
      u.username.toLowerCase().startsWith(term.toLowerCase()) && u.username !== me.username
    ).slice(0, 5);

    if (filteredUsers.length === 0) return hideMentionSuggestions();

    mentionSuggestions.innerHTML = filteredUsers.map((user, index) => `
      <div class="mention-item ${index === selectedMentionIndex ? 'selected' : ''}" onclick="selectMention('${user.username}')">
        <span style="font-weight:700;">${escapeHtml(user.name || user.username)}</span>
        <span style="opacity:0.6; font-family:monospace; font-size:0.8rem;">@${user.username}</span>
      </div>
    `).join("");
    mentionSuggestions.classList.add("active");
  }

  window.selectMention = (username) => {
    const text = postContentInput.value;
    const cursorPosition = postContentInput.selectionStart;
    const lastAtIndex = text.lastIndexOf("@", cursorPosition - 1);
    const newText = text.substring(0, lastAtIndex) + `@${username} ` + text.substring(cursorPosition);
    postContentInput.value = newText;
    postContentInput.focus();
    hideMentionSuggestions();
  };

  function hideMentionSuggestions() {
    mentionSuggestions.classList.remove("active");
    selectedMentionIndex = -1;
  }

  function handleMentionKeydown(e) {
    if (!mentionSuggestions.classList.contains("active")) return;
    const items = mentionSuggestions.querySelectorAll(".mention-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedMentionIndex = (selectedMentionIndex + 1) % items.length;
      items.forEach((it, idx) => it.classList.toggle("selected", idx === selectedMentionIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedMentionIndex = (selectedMentionIndex - 1 + items.length) % items.length;
      items.forEach((it, idx) => it.classList.toggle("selected", idx === selectedMentionIndex));
    } else if (e.key === "Enter" && selectedMentionIndex !== -1) {
      e.preventDefault();
      items[selectedMentionIndex].click();
    } else if (e.key === "Escape") {
      hideMentionSuggestions();
    }
  }

  // Submission
  submitPostBtn.onclick = async () => {
    const content = postContentInput.value.trim();
    if (!content && !selectedImageUrl) return;

    submitPostBtn.disabled = true;
    uploadProgressContainer.classList.remove("hidden");
    
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/posts");
      xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);
      xhr.setRequestHeader("Content-Type", "application/json");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          uploadProgressBar.style.width = `${percent}%`;
          uploadProgressText.textContent = `${percent}%`;
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (window.navigateTo) window.navigateTo("/feed");
          else window.location.href = "/feed";
        } else {
          setStatus("Failed to create post.");
          submitPostBtn.disabled = false;
        }
      };

      xhr.onerror = () => {
        setStatus("Network error.");
        submitPostBtn.disabled = false;
      };

      xhr.send(JSON.stringify({ content, imageUrl: selectedImageUrl }));
    } catch (err) {
      setStatus("Request failed.");
      submitPostBtn.disabled = false;
    }
  };
})();