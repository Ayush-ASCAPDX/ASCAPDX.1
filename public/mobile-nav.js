(function initMobileNav() {
  const NAV_STYLE_ID = "mobile-global-nav-style";
  const ICON_FONT_ID = "mobile-global-nav-icons";

  const items = [
    { href: "/chat", label: "Home", icon: "home", match: (path) => path === "/chat" || path === "/" || path === "/index.html" },
    { href: "/feed", label: "Feed", icon: "dynamic_feed", match: (path) => path === "/feed" || path === "/create-post" },
    { href: "/groups", label: "Groups", icon: "group", match: (path) => path === "/groups" || path.startsWith("/groups/") || path.startsWith("/g/") },
    { href: "/profile", label: "Profile", icon: "account_circle", match: (path) => path === "/profile" || path === "/settings" || path === "/user-profile" }
  ];

  function ensureIconFont() {
    if (document.getElementById(ICON_FONT_ID)) return;
    if (document.querySelector('link[href*="Material+Symbols+Outlined"]')) return;

    const link = document.createElement("link");
    link.id = ICON_FONT_ID;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap";
    document.head.appendChild(link);
  }

  function ensureStyles() {
    if (document.getElementById(NAV_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = NAV_STYLE_ID;
    style.textContent = `
      .material-symbols-outlined {
        font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
      }

      body .mobile-global-nav {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        width: 100%;
        min-height: 62px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        gap: 4px;
        padding: 5px 12px calc(6px + env(safe-area-inset-bottom));
        border-top: 1px solid rgba(116, 159, 207, 0.2);
        background: rgba(14, 31, 50, 0.92);
        box-shadow: 0 -18px 42px rgba(0, 9, 22, 0.38);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }

      body .mobile-global-nav-link {
        min-width: 0;
        min-height: 46px;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1px;
        border-radius: 999px;
        color: #bfcede;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 11px;
        line-height: 1;
        text-decoration: none;
        transition: background-color 160ms ease, color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        -webkit-tap-highlight-color: transparent;
      }

      body .mobile-global-nav-link:hover {
        color: #78d2ff;
      }

      body .mobile-global-nav-link:active {
        transform: scale(0.96);
      }

      body .mobile-global-nav-icon {
        font-size: 24px;
        line-height: 1;
      }

      body .mobile-global-nav-label {
        font-size: inherit;
        line-height: 1;
      }

      body .mobile-global-nav-link.is-active {
        min-width: 78px;
        justify-self: center;
        padding: 6px 12px 5px;
        background: #43b8ea;
        color: #073249;
        box-shadow: 0 10px 22px rgba(67, 184, 234, 0.22);
      }

      body .mobile-global-nav-link.is-active .mobile-global-nav-icon {
        font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
      }

      @media (min-width: 769px) {
        body .mobile-global-nav {
          display: none;
        }
      }

      @media (max-width: 520px) {
        body .mobile-global-nav {
          min-height: 56px;
          gap: 2px;
          padding: 4px 8px calc(5px + env(safe-area-inset-bottom));
        }

        body .mobile-global-nav-link {
          min-height: 42px;
          font-size: 9px;
        }

        body .mobile-global-nav-icon {
          font-size: 22px;
        }

        body .mobile-global-nav-link.is-active {
          min-width: 70px;
          padding-inline: 10px;
        }
      }

      @media (max-width: 380px) {
        body .mobile-global-nav {
          padding-inline: 6px;
        }

        body .mobile-global-nav-link {
          font-size: 8px;
        }

        body .mobile-global-nav-icon {
          font-size: 20px;
        }

        body .mobile-global-nav-link.is-active {
          min-width: 64px;
          padding-inline: 8px;
        }
      }

      .chat-page.mobile-chat-open .mobile-global-nav {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  function renderMobileNav() {
    ensureIconFont();
    ensureStyles();

    const existingNav = document.querySelector(".mobile-global-nav");
    if (existingNav) existingNav.remove();

    const path = window.location.pathname || "/";
    const nav = document.createElement("nav");
    nav.className = "mobile-global-nav";
    nav.setAttribute("aria-label", "Mobile navigation");

    nav.innerHTML = items.map((item) => {
      const isActive = item.match(path);
      return `
        <a class="mobile-global-nav-link${isActive ? " is-active" : ""}" href="${item.href}" aria-label="${item.label}"${isActive ? ' aria-current="page"' : ""}>
          <span class="material-symbols-outlined mobile-global-nav-icon">${item.icon}</span>
          <span class="mobile-global-nav-label">${item.label}</span>
        </a>
      `;
    }).join("");

    document.body.appendChild(nav);
  }

  window.__renderMobileNav = renderMobileNav;
  window.__mobileNavInit = true;
  renderMobileNav();
})();
