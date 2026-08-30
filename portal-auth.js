/* =========================================
   工事部ポータル 共通認証処理
========================================= */


/* =========================================
   共通表示設定
========================================= */

const PORTAL_THEME_KEY =
  "staffPortalTheme";

const PORTAL_FONT_SIZE_KEY =
  "staffPortalFontSize";


function applyPortalDisplayPreferences() {
  const savedTheme =
    localStorage.getItem(
      PORTAL_THEME_KEY
    );

  const savedFontSize =
    localStorage.getItem(
      PORTAL_FONT_SIZE_KEY
    );

  document.documentElement.dataset.portalTheme =
    savedTheme === "dark"
      ? "dark"
      : "light";

  document.documentElement.dataset.portalFontSize =
    ["small", "large"].includes(
      savedFontSize
    )
      ? savedFontSize
      : "standard";
}


function savePortalDisplayPreferences(
  theme,
  fontSize
) {
  localStorage.setItem(
    PORTAL_THEME_KEY,
    theme === "dark"
      ? "dark"
      : "light"
  );

  localStorage.setItem(
    PORTAL_FONT_SIZE_KEY,
    ["small", "large"].includes(fontSize)
      ? fontSize
      : "standard"
  );

  applyPortalDisplayPreferences();
}


applyPortalDisplayPreferences();


/* =========================================
   Supabase接続設定
========================================= */

const PORTAL_SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

const PORTAL_SUPABASE_KEY =
  "sb_publishable_pePa2xjccUZB6xpneNhCRQ_pJJ5fn6h";


/* =========================================
   保存キー
========================================= */

const PORTAL_LOGIN_USER_KEY =
  "portalLoginUser";

const PORTAL_AUTH_SESSION_KEY =
  "portalAuthSession";


/*
  同時に複数の通信が発生した場合、
  トークン更新が重複しないようにする。
*/

let portalRefreshPromise = null;


/* =========================================
   認証セッション取得
========================================= */

function getPortalAuthSession() {
  const savedSession =
    localStorage.getItem(
      PORTAL_AUTH_SESSION_KEY
    );

  if (!savedSession) {
    return null;
  }

  try {
    return JSON.parse(
      savedSession
    );

  } catch (error) {
    console.error(
      "認証セッションの読込に失敗しました",
      error
    );

    return null;
  }
}


/* =========================================
   認証セッション保存
========================================= */

function savePortalAuthSession(
  authData,
  previousSession = null
) {
  if (
    !authData ||
    !authData.access_token
  ) {
    throw new Error(
      "認証情報が正しくありません"
    );
  }

  const expiresIn =
    Number(
      authData.expires_in || 3600
    );

  const authSession = {
    accessToken:
      authData.access_token,

    refreshToken:
      authData.refresh_token ||
      previousSession?.refreshToken ||
      "",

    expiresIn,

    expiresAt:
      Date.now() +
      expiresIn * 1000,

    tokenType:
      authData.token_type ||
      previousSession?.tokenType ||
      "bearer",

    user:
      authData.user ||
      previousSession?.user ||
      null
  };

  localStorage.setItem(
    PORTAL_AUTH_SESSION_KEY,
    JSON.stringify(authSession)
  );

  return authSession;
}


/* =========================================
   ログイン情報削除
========================================= */

function clearPortalLoginInformation() {
  localStorage.removeItem(
    PORTAL_LOGIN_USER_KEY
  );

  localStorage.removeItem(
    PORTAL_AUTH_SESSION_KEY
  );
}


/* =========================================
   ログイン画面へ戻す
========================================= */

function redirectToPortalLogin() {
  clearPortalLoginInformation();

  if (
    !window.location.pathname
      .endsWith("/login.html")
  ) {
    window.location.href =
      "login.html";
  }
}


/* =========================================
   アクセストークン期限確認
========================================= */

function isPortalAccessTokenValid(
  session
) {
  if (
    !session ||
    !session.accessToken ||
    !session.expiresAt
  ) {
    return false;
  }

  /*
    期限の60秒前を期限切れとして扱う。
  */

  const safetyMargin =
    60 * 1000;

  return (
    Number(session.expiresAt) -
    safetyMargin
  ) > Date.now();
}


/* =========================================
   リフレッシュトークンで更新
========================================= */

async function refreshPortalAuthSession() {
  if (portalRefreshPromise) {
    return portalRefreshPromise;
  }

  portalRefreshPromise =
    (async () => {
      const currentSession =
        getPortalAuthSession();

      if (
        !currentSession ||
        !currentSession.refreshToken
      ) {
        throw new Error(
          "ログイン情報がありません"
        );
      }

      const url =
        `${PORTAL_SUPABASE_URL}/auth/v1/token` +
        `?grant_type=refresh_token`;

      const response =
        await fetch(
          url,
          {
            method:
              "POST",

            headers: {
              apikey:
                PORTAL_SUPABASE_KEY,

              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                refresh_token:
                  currentSession.refreshToken
              })
          }
        );

      const responseData =
        await response.json();

      if (!response.ok) {
        console.error(
          "トークン更新エラー",
          responseData
        );

        throw new Error(
          "ログインの有効期限が切れました"
        );
      }

      return savePortalAuthSession(
        responseData,
        currentSession
      );
    })();

  try {
    return await portalRefreshPromise;

  } catch (error) {
    redirectToPortalLogin();

    throw error;

  } finally {
    portalRefreshPromise = null;
  }
}


/* =========================================
   有効なアクセストークン取得
========================================= */

async function getPortalAccessToken() {
  const session =
    getPortalAuthSession();

  if (!session) {
    redirectToPortalLogin();

    throw new Error(
      "ログイン情報がありません"
    );
  }

  if (
    isPortalAccessTokenValid(
      session
    )
  ) {
    return session.accessToken;
  }

  const refreshedSession =
    await refreshPortalAuthSession();

  return refreshedSession.accessToken;
}


/* =========================================
   認証済みヘッダー作成
========================================= */

async function portalSupabaseHeaders(
  extraHeaders = {}
) {
  const accessToken =
    await getPortalAccessToken();

  return {
    apikey:
      PORTAL_SUPABASE_KEY,

    Authorization:
      `Bearer ${accessToken}`,

    ...extraHeaders
  };
}


/* =========================================
   認証済みSupabase通信
========================================= */

async function portalFetch(
  url,
  options = {}
) {
  const originalHeaders =
    options.headers || {};

  const headers =
    await portalSupabaseHeaders(
      originalHeaders
    );

  let response =
    await fetch(
      url,
      {
        ...options,
        headers
      }
    );

  /*
    401の場合はトークンを更新し、
    1回だけ通信をやり直す。
  */

  if (response.status === 401) {
    await refreshPortalAuthSession();

    const retryHeaders =
      await portalSupabaseHeaders(
        originalHeaders
      );

    response =
      await fetch(
        url,
        {
          ...options,
          headers:
            retryHeaders
        }
      );
  }

  return response;
}
