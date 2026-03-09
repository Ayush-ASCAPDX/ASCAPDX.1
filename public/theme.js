(function initTheme() {
  const STORAGE_KEY = "chat:theme";
  const root = document.documentElement;

  function getStoredTheme() {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "dark" || value === "light") return value;
    return "";
  }

  function getPreferredTheme() {
    const stored = getStoredTheme();
    if (stored) return stored;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }

  function applyTheme(theme) {
    const dark = theme === "dark";
    root.classList.toggle("theme-dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  }

  function setTheme(theme) {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const btn = document.getElementById("themeToggleBtn");
    if (btn) {
      btn.textContent = theme === "dark" ? "Light" : "Dark";
      btn.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
      btn.title = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    }
  }

  applyTheme(getPreferredTheme());

  function mountButton() {
    if (document.getElementById("themeToggleBtn")) return;
    if (!document.body) return;

    const btn = document.createElement("button");
    btn.id = "themeToggleBtn";
    btn.type = "button";
    btn.className = "theme-toggle-btn";
    document.body.appendChild(btn);

    const active = root.classList.contains("theme-dark") ? "dark" : "light";
    setTheme(active);

    btn.addEventListener("click", () => {
      const next = root.classList.contains("theme-dark") ? "light" : "dark";
      setTheme(next);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountButton);
  } else {
    mountButton();
  }
})();
