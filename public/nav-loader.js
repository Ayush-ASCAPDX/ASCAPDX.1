(function initNavLoader() {
  if (window.__navLoaderInit) return;
  window.__navLoaderInit = true;

  const prefetched = new Set();
  let loaderEl = null;

  function ensureLoader() {
    if (loaderEl) return loaderEl;
    loaderEl = document.createElement("div");
    loaderEl.className = "top-route-loader";
    loaderEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(loaderEl);
    return loaderEl;
  }

  function startLoader() {
    ensureLoader();
    document.body.classList.add("route-loading");
  }

  function stopLoader() {
    document.body.classList.remove("route-loading");
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
    startLoader();
    window.setTimeout(() => {
      window.location.href = destination;
    }, 120);
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
})();
