const CookieUtil = {
  set: function(name, value, days) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "")  + expires + "; path=/";
  },
  get: function(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) == ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  },
  erase: function(name) {   
    document.cookie = name + '=; Max-Age=-99999999; path=/;';  
  }
};

function getToken() {
  return localStorage.getItem("token") || "";
}

(function trackFirstVisit() {
  if (typeof document === 'undefined') return;
  const token = getToken();
  if (!token) {
    if (!CookieUtil.get('hasVisited')) {
      CookieUtil.set('hasVisited', 'true', 365);
      CookieUtil.set('showInstallPopupPostLogin', 'true', 365);
    }
  }
})();

function saveAuth(token, user) {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

function getUser() {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/";
}

async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = {
    ...(options.headers || {})
  };

  const hasBody = options.body !== undefined && options.body !== null;
  const isBinaryBody =
    typeof Blob !== "undefined" && options.body instanceof Blob;
  const isFormDataBody =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!headers["Content-Type"] && hasBody && !isBinaryBody && !isFormDataBody) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401) {
    logout();
    throw new Error("Unauthorized");
  }

  return response;
}

async function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = "/";
    return null;
  }

  const response = await authFetch("/api/me");
  if (!response.ok) {
    logout();
    return null;
  }

  const user = await response.json();
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}
