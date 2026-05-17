(function initMobileNav() {
  const NAV_STYLE_ID = "mobile-global-nav-style";

  const items = [
    { 
      href: "/chat", 
      label: "Home", 
      iconSvg: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline>', 
      match: (path) => path === "/chat" || path === "/" || path === "/index.html" 
    },
    { 
      href: "/feed", 
      label: "Feed", 
      iconSvg: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>', 
      match: (path) => path === "/feed" || path === "/create-post" 
    },
    { 
      href: "/groups", 
      label: "Groups", 
      iconSvg: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', 
      match: (path) => path === "/groups" || path.startsWith("/groups/") || path.startsWith("/g/") 
    },
    { 
      href: "/profile", 
      label: "Profile", 
      iconSvg: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>', 
      match: (path) => path === "/profile" || path === "/settings" || path === "/user-profile" 
    }
  ];

  function ensureStyles() {
    if (document.getElementById(NAV_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = NAV_STYLE_ID;
    style.textContent = `
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

      body .mobile-global-nav-icon-svg {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        transition: stroke-width 160ms ease;
      }

      body .mobile-global-nav-link.is-active {
        min-width: 78px;
        justify-self: center;
        padding: 6px 12px 5px;
        background: #43b8ea;
        color: #073249;
        box-shadow: 0 10px 22px rgba(67, 184, 234, 0.22);
      }

      body .mobile-global-nav-link.is-active .mobile-global-nav-icon-svg {
        stroke-width: 2.5px;
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

        body .mobile-global-nav-icon-svg {
          width: 22px;
          height: 22px;
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

        body .mobile-global-nav-icon-svg {
          width: 20px;
          height: 20px;
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
          <svg class="mobile-global-nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.iconSvg}</svg>
        </a>
      `;
    }).join("");

    document.body.appendChild(nav);
  }

  window.__renderMobileNav = renderMobileNav;
  window.__mobileNavInit = true;
  renderMobileNav();
})();
