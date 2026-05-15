(function initMobileNav() {
  window.__mobileNavInit = true;

  // Remove existing nav to prevent duplicates during SPA navigation
  const existingNav = document.querySelector(".mobile-global-nav");
  if (existingNav) existingNav.remove();

  const path = window.location.pathname || "/";
  const items = [
    { href: "/chat", label: "Home", icon: "⌂", match: (p) => p === "/chat" || p === "/" },
    { href: "/feed", label: "Feed", icon: "▥", match: (p) => p === "/feed" },
    { href: "/groups", label: "Groups", icon: "◌", match: (p) => p === "/groups" || p.startsWith("/groups/") },
    { href: "/profile", label: "Profile", icon: "◎", match: (p) => p === "/profile" || p === "/settings" || p === "/user-profile" }
  ];

  const nav = document.createElement("nav");
  nav.className = "mobile-global-nav";
  nav.setAttribute("aria-label", "Mobile navigation");

  nav.innerHTML = items.map((item) => {
    const active = item.match(path) ? " is-active" : "";
    return `<a class="mobile-global-nav-item${active}" href="${item.href}"><span class="mobile-global-nav-icon">${item.icon}</span><span class="mobile-global-nav-label">${item.label}</span></a>`;
  }).join("");

  document.body.appendChild(nav);
})();
