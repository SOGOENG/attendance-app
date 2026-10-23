// No pre-auth employee lookup. The internal email format matches existing accounts.
const SUPABASE_URL = PORTAL_SUPABASE_URL;
const SUPABASE_KEY = PORTAL_SUPABASE_KEY;
const loginEmployee = document.getElementById("loginEmployee");
const loginPassword = document.getElementById("loginPassword");
const loginButton = document.getElementById("loginButton");
const loginMessage = document.getElementById("loginMessage");
const loginForm = document.getElementById("loginForm");
const LOGIN_FAILURE = "ログインできませんでした。社員IDとパスワードを確認し、時間をおいて再度お試しください。";
let loginInProgress = false;

async function loginRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
  } finally { clearTimeout(timeout); }
}

async function signInWithPassword(employeeId, password) {
  const response = await loginRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `employee-${employeeId}@staff-portal.local`, password })
  });
  // Never display or log Auth error bodies (banned/unconfirmed/missing accounts).
  if (!response.ok) throw new Error(LOGIN_FAILURE);
  const auth = await response.json();
  if (typeof auth.access_token !== "string" || !auth.access_token ||
      typeof auth.refresh_token !== "string" || !auth.refresh_token ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auth.user?.id || "")) {
    throw new Error(LOGIN_FAILURE);
  }
  return auth;
}

async function loadAuthenticatedEmployee(employeeId, auth) {
  const params = new URLSearchParams({
    select: "id,name,department,active,admin_scope,is_leave_manager,auth_user_id",
    auth_user_id: `eq.${auth.user.id}`, limit: "2"
  });
  // JWT is taken directly from Auth; local administrator information is never used.
  const response = await loginRequest(`${SUPABASE_URL}/rest/v1/employees?${params}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${auth.access_token}` }
  });
  if (!response.ok) throw new Error(LOGIN_FAILURE);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 ||
      String(rows[0].id) !== employeeId || rows[0].auth_user_id !== auth.user.id ||
      rows[0].active !== true) throw new Error(LOGIN_FAILURE);
  return rows[0];
}

async function discardUnverifiedSession(auth) {
  if (!auth?.access_token) return;
  try {
    await loginRequest(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${auth.access_token}` }
    });
  } catch { /* Best effort. Never persist this session. */ }
}

function saveLoginInformation(
  employee,
  authData
) {
  /*
    既存画面との互換性を保つため、
    portalLoginUserは引き続き保存する。
  */

  const loginUser = {
    id:
      Number(employee.id),

    name:
      employee.name,

    department:
      employee.department,

    adminScope:
      employee.admin_scope || "none",

    isLeaveManager:
      employee.is_leave_manager === true,

    authUserId:
      authData.user.id
  };

  localStorage.setItem(
    "portalLoginUser",
    JSON.stringify(loginUser)
  );


  /*
    accessToken・refreshTokenなどは、
    portal-auth.jsの共通処理で保存する。
  */

  savePortalAuthSession(
    authData
  );
}


async function login(event) {
  event?.preventDefault();
  if (loginInProgress) return;
  loginMessage.textContent = "";
  const enteredId = loginEmployee.value.trim().normalize("NFKC");
  const numericId = Number(enteredId);
  if (!/^[0-9]+$/.test(enteredId) || !Number.isSafeInteger(numericId) || numericId <= 0 || !loginPassword.value) {
    loginMessage.textContent = LOGIN_FAILURE;
    return;
  }
  const employeeId = String(numericId);
  loginInProgress = true;
  loginForm.setAttribute("aria-busy", "true");
  loginButton.disabled = loginEmployee.disabled = loginPassword.disabled = true;
  loginButton.textContent = "ログイン中...";
  let auth;
  try {
    clearPortalLoginInformation();
    auth = await signInWithPassword(employeeId, loginPassword.value);
    const employee = await loadAuthenticatedEmployee(employeeId, auth);
    saveLoginInformation(employee, auth);
    window.location.href = "home.html";
  } catch {
    clearPortalLoginInformation();
    loginMessage.textContent = LOGIN_FAILURE;
    await discardUnverifiedSession(auth);
  } finally {
    loginPassword.value = "";
    loginInProgress = false;
    loginForm.setAttribute("aria-busy", "false");
    loginButton.disabled = loginEmployee.disabled = loginPassword.disabled = false;
    loginButton.textContent = "ログイン";
  }
}

loginForm.addEventListener("submit", login);
loginEmployee.addEventListener("input", () => { loginMessage.textContent = ""; });
// Initial load performs no Auth/REST/RPC request.
clearPortalLoginInformation();
