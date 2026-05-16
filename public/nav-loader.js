(function initNavLoader() {
  if (window.__navLoaderInit) return;
  window.__navLoaderInit = true;

  const prefetched = new Set();
  let loaderEl = null;
  let centerLoaderEl = null;

  function ensureLoader() {
    if (loaderEl && !loaderEl.isConnected) loaderEl = null;
    if (centerLoaderEl && !centerLoaderEl.isConnected) centerLoaderEl = null;

    if (!loaderEl) {
      loaderEl = document.createElement("div");
      loaderEl.className = "top-route-loader";
      loaderEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(loaderEl);
    }

    if (!centerLoaderEl) {
      centerLoaderEl = document.createElement("div");
      centerLoaderEl.className = "center-route-loader";
      centerLoaderEl.setAttribute("aria-hidden", "true");
      centerLoaderEl.innerHTML = '<div class="route-spinner"></div>';
      document.body.appendChild(centerLoaderEl);
    }

    return loaderEl;
  }

  function startLoader() {
    ensureLoader();
    document.body.classList.add("route-loading");
  }

  function stopLoader() {
    document.body.classList.remove("route-loading");
    document.body.classList.add("route-finished");
    setTimeout(() => {
      document.body.classList.remove("route-finished");
    }, 600);
    
    // Safety: ensure the animation class is removed if stuck
    if (document.body.classList.contains("page-exit")) {
       document.body.classList.remove("page-exit");
    }
  }

  function isInternalNavigableAnchor(anchor) {
    if (!anchor) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download")) return false;
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return false;
    try {
      const url = new URL(anchor.href, window.location.origin);
      return url.origin === window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function prefetchHref(href) {
    if (!href || prefetched.has(href)) return;
    prefetched.add(href);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.href = href;
    link.as = "document";
    document.head.appendChild(link);
  }

  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!isInternalNavigableAnchor(anchor)) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const destination = anchor.href;
    if (destination === window.location.href) return;

    event.preventDefault();
    navigateTo(destination);
  });

  function cleanupPreviousPage() {
    // Close active chat/notification sockets to prevent duplicate connections
    if (window.__chatSocket) {
      window.__chatSocket.close();
      window.__chatSocket = null;
      window.__sovereignCallAlertsInit = false;
    }
    if (window.__globalNotificationSocket) {
      window.__globalNotificationSocket.close();
      window.__globalNotificationSocket = null;
      window.__sovereignCallAlertsInit = false;
    }

    // Force-clear all intervals set by previous pages (like "Last seen" timers)
    // This prevents background tasks from piling up and slowing down the site
    let id = window.setInterval(() => {}, 0);
    while (id--) {
      window.clearInterval(id);
    }
  }

  window.navigateTo = async function(url, addHistory = true) {
    // Clear state before moving to the next "page"
    cleanupPreviousPage();

    // Trigger exit animation (defined in style.css)
    document.body.classList.add("page-exit");
    
    // Start fetching immediately while the animation plays
    const fetchPromise = fetch(url);
    const animationWait = new Promise(r => setTimeout(r, 200));

    try {
      startLoader();
      const [response] = await Promise.all([fetchPromise, animationWait]);
      
      if (!response.ok) throw new Error("Network response was not ok");
      
      const html = await response.text();
      const parser = new DOMParser();
      const newDoc = parser.parseFromString(html, "text/html");

      // Update the URL and Document Title
      if (addHistory) {
        window.history.pushState({}, "", url);
      }
      document.title = newDoc.title;

      // Synchronize head elements (CSS and Styles)
      // 1. Remove old internal styles to prevent leakage from the previous page
      document.head.querySelectorAll('style').forEach(s => s.remove());
      
      // 2. Reconcile External Stylesheets
      const currentLinks = Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'));
      const newLinks = Array.from(newDoc.head.querySelectorAll('link[rel="stylesheet"]'));

      // Remove stylesheets that are not present in the new document
      currentLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!newLinks.some(nl => nl.getAttribute('href') === href)) {
          link.remove();
        }
      });

      // Add new stylesheets that aren't already in the head
      newLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (!document.head.querySelector(`link[href="${href}"]`)) {
          document.head.appendChild(link.cloneNode(true));
        }
      });

      // 3. Inject new internal styles
      newDoc.head.querySelectorAll('style').forEach(style => {
        document.head.appendChild(style.cloneNode(true));
      });

      // Synchronize body attributes (like class="auth-page") 
      // This ensures responsive layouts and background styles update automatically
      document.body.className = newDoc.body.className;
      Array.from(newDoc.body.attributes).forEach(attr => {
        if (attr.name !== 'class') document.body.setAttribute(attr.name, attr.value);
      });

      // Replace the body content
      document.body.innerHTML = newDoc.body.innerHTML;
      window.scrollTo(0, 0);

      // Ensure loaders are part of the new body after the swap
      ensureLoader();

      // Manually trigger scripts in the new content
      const scripts = newDoc.querySelectorAll("script");
      scripts.forEach((oldScript) => {
        const src = oldScript.getAttribute("src");
        
        // Prevent re-injecting the SPA loader and mobile nav to avoid redundant logic or loops
        if (src && (src.includes('nav-loader.js') || src.includes('mobile-nav.js'))) return;
        
        // Skip auth.js if it's already loaded to prevent "Identifier already declared" errors
        if (src && src.includes('auth.js') && document.querySelector('script[src*="auth.js"]')) return;

        const newScript = document.createElement("script");
        Array.from(oldScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });

        if (oldScript.src) {
          newScript.src = oldScript.src;
          newScript.async = false;
        } else {
          // If it's an inline script, check if it's the tailwind config and wrap it
          if (oldScript.id === "tailwind-config") {
            newScript.textContent = `
              if (window.tailwind) {
                ${oldScript.textContent}
              } else {
                window.addEventListener('load', () => {
                  if (window.tailwind) { ${oldScript.textContent} }
                });
              }
            `;
          } else {
            newScript.textContent = oldScript.textContent;
          }
        }
        document.body.appendChild(newScript);
      });

      // Initialize the new page content
      triggerPageInit(url);
    } catch (error) {
      console.error("SPA Navigation failed, falling back to refresh:", error);
      window.location.href = url;
    } finally {
      stopLoader();
    }
  }

  function triggerPageInit(url) {
    const path = new URL(url, window.location.origin).pathname;
    // Recognize '/', '/index.html', and '/chat' as the home/chat page
    const isChatPage = path === "/" || path === "/index.html" || path.includes("/chat");

    // Trigger entrance animation (fade-in)
    requestAnimationFrame(() => {
      document.body.classList.remove("page-exit");
      if (window.__renderMobileNav) {
        window.__renderMobileNav();
      }
      if (window.__startCallNotifications) {
        window.__startCallNotifications();
      }
      // Call specific init functions after scripts have been appended to the DOM
      if (window.initChatPage && isChatPage) {
        window.initChatPage();
      }
      if (window.initFeedPage && path.includes("/feed")) {
        window.initFeedPage();
      }
      // Add other page-specific init calls here if needed (e.g., window.initProfilePage())
    });
  }

  // Handle back/forward browser buttons
  window.addEventListener("popstate", () => {
    navigateTo(window.location.href, false);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (event.defaultPrevented) return;
    if (form.getAttribute("data-no-nav-loader") === "true") return;
    const method = String(form.method || "get").toLowerCase();
    if (method !== "get") return;
    startLoader();
  });

  document.addEventListener("mouseover", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!isInternalNavigableAnchor(anchor)) return;
    prefetchHref(anchor.href);
  });

  document.addEventListener("touchstart", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!isInternalNavigableAnchor(anchor)) return;
    prefetchHref(anchor.href);
  }, { passive: true });

  window.addEventListener("pageshow", stopLoader);
  window.addEventListener("load", stopLoader);

  // Ensure shared global scripts are loaded on every page.
  // This centralizes the loading of the mobile navigation bar and notifications.
  // It will only execute once due to the internal guard in mobile-nav.js
  if (!window.__mobileNavInit && !document.querySelector('script[src="/mobile-nav.js"]')) {
    const script = document.createElement("script");
    script.src = "/mobile-nav.js";
    script.defer = true; // Defer loading to not block rendering
    document.body.appendChild(script);
  }

  if (!window.__notificationsLoaderInit && !document.querySelector('script[src="/notifications-loader.js"]')) {
    const script = document.createElement("script");
    script.src = "/notifications-loader.js";
    script.defer = true;
    document.body.appendChild(script);
  }
})();
