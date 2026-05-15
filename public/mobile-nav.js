(function initMobileNav() {
  if (window.__mobileNavInit) return;
  window.__mobileNavInit = true;

  const path = window.location.pathname || "/";
  const items = [
    { href: "/chat", label: "Home", icon: "⌂", match: (p) => p === "/chat" || p === "/" },
    { href: "/groups", label: "Groups", icon: "◌", match: (p) => p === "/groups" || p.startsWith("/groups/") },
    { href: "/groups", label: "Discover", icon: "▥", match: (p) => p === "/groups" || p === "/groups/join" || p.startsWith("/groups/") },
    { href: "/profile", label: "Profile", icon: "◎", match: (p) => p === "/profile" || p === "/settings" }
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
