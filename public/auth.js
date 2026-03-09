function getToken() {
  return localStorage.getItem("token") || "";
}

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
