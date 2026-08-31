const SETTINGS_SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";


const settingsDarkMode =
  document.getElementById(
    "settingsDarkMode"
  );

const settingsFontSize =
  document.getElementById(
    "settingsFontSize"
  );

const settingsProfileForm =
  document.getElementById(
    "settingsProfileForm"
  );

const settingsProfileEmail =
  document.getElementById(
    "settingsProfileEmail"
  );

const settingsProfilePhone =
  document.getElementById(
    "settingsProfilePhone"
  );

const settingsProfileSaveButton =
  document.getElementById(
    "settingsProfileSaveButton"
  );

const settingsProfileMessage =
  document.getElementById(
    "settingsProfileMessage"
  );

const settingsPushNotifications =
  document.getElementById(
    "settingsPushNotifications"
  );

const settingsPushNotificationMessage =
  document.getElementById(
    "settingsPushNotificationMessage"
  );

const settingsPasswordForm =
  document.getElementById(
    "settingsPasswordForm"
  );

const settingsNewPassword =
  document.getElementById(
    "settingsNewPassword"
  );

const settingsNewPasswordConfirmation =
  document.getElementById(
    "settingsNewPasswordConfirmation"
  );

const settingsPasswordChangeButton =
  document.getElementById(
    "settingsPasswordChangeButton"
  );

const settingsPasswordMessage =
  document.getElementById(
    "settingsPasswordMessage"
  );

const settingsAppUpdateButton =
  document.getElementById(
    "settingsAppUpdateButton"
  );

const settingsAppUpdateMessage =
  document.getElementById(
    "settingsAppUpdateMessage"
  );

let isSettingsPasswordChanging = false;
let isSettingsPushChanging = false;
let isSettingsAppUpdating = false;


function getSettingsLoginUser() {
  const savedUser =
    localStorage.getItem(
      "portalLoginUser"
    );

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);

  } catch (error) {
    console.error(error);

    return null;
  }
}


async function loadSettingsProfile(
  loginUser
) {
  const authResponse =
    await portalFetch(
      `${SETTINGS_SUPABASE_URL}/auth/v1/user`
    );

  if (!authResponse.ok) {
    throw new Error(
      "ログイン情報を確認できませんでした"
    );
  }

  const authUser =
    await authResponse.json();

  const response =
    await portalFetch(
      `${SETTINGS_SUPABASE_URL}/rest/v1/employees` +
      `?select=name,department,job_title,profile_email,phone_number` +
      `&auth_user_id=eq.${encodeURIComponent(authUser.id)}` +
      `&limit=1`
    );

  if (!response.ok) {
    console.error(
      await response.text()
    );

    throw new Error(
      "プロフィールを読み込めませんでした"
    );
  }

  const employees =
    await response.json();

  const employee = employees[0];

  if (!employee) {
    throw new Error(
      "本人に対応する社員情報が見つかりません"
    );
  }

  document.getElementById(
    "settingsProfileName"
  ).textContent =
    employee.name ||
    loginUser.name ||
    "未設定";

  document.getElementById(
    "settingsProfileDepartment"
  ).textContent =
    employee.department ||
    loginUser.department ||
    "未設定";

  document.getElementById(
    "settingsProfilePosition"
  ).textContent =
    employee.job_title || "";

  document.getElementById(
    "settingsProfilePositionRow"
  ).classList.toggle(
    "hidden",
    !employee.job_title
  );

  settingsProfileEmail.value =
    employee.profile_email || "";

  settingsProfilePhone.value =
    employee.phone_number || "";

  settingsProfileEmail.disabled = false;
  settingsProfilePhone.disabled = false;
  settingsProfileSaveButton.disabled = false;
}


function showSettingsProfileMessage(
  message,
  type = ""
) {
  settingsProfileMessage.textContent =
    message;

  settingsProfileMessage.classList.remove(
    "is-success",
    "is-error"
  );

  if (type) {
    settingsProfileMessage.classList.add(
      `is-${type}`
    );
  }
}


function showSettingsPushMessage(
  message,
  type = ""
) {
  settingsPushNotificationMessage.textContent =
    message;

  settingsPushNotificationMessage.classList.remove(
    "is-success",
    "is-error"
  );

  if (type) {
    settingsPushNotificationMessage.classList.add(
      `is-${type}`
    );
  }
}


function showSettingsAppUpdateMessage(
  message,
  type = ""
) {
  settingsAppUpdateMessage.textContent =
    message;

  settingsAppUpdateMessage.classList.remove(
    "is-success",
    "is-error"
  );

  if (type) {
    settingsAppUpdateMessage.classList.add(
      `is-${type}`
    );
  }
}


function waitForSettingsWorkerActivation(
  worker,
  timeoutMilliseconds = 15000
) {
  if (!worker || worker.state === "activated") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => {
        worker.removeEventListener(
          "statechange",
          handleStateChange
        );
        reject(
          new Error(
            "Service Workerの有効化がタイムアウトしました"
          )
        );
      },
      timeoutMilliseconds
    );

    function handleStateChange() {
      if (worker.state === "activated") {
        window.clearTimeout(timeoutId);
        worker.removeEventListener(
          "statechange",
          handleStateChange
        );
        resolve();
      } else if (worker.state === "redundant") {
        window.clearTimeout(timeoutId);
        worker.removeEventListener(
          "statechange",
          handleStateChange
        );
        reject(
          new Error(
            "Service Workerを有効化できませんでした"
          )
        );
      }
    }

    worker.addEventListener(
      "statechange",
      handleStateChange
    );
  });
}


async function updateSettingsApp() {
  if (isSettingsAppUpdating) {
    return;
  }

  isSettingsAppUpdating = true;
  settingsAppUpdateButton.disabled = true;
  settingsAppUpdateButton.textContent =
    "更新しています…";
  showSettingsAppUpdateMessage("");

  try {
    if (!("serviceWorker" in navigator)) {
      throw new Error(
        "Service Workerを利用できません"
      );
    }

    let registration =
      await navigator.serviceWorker.getRegistration();

    if (!registration) {
      registration =
        await registerSettingsServiceWorker();
    }

    if (!registration) {
      throw new Error(
        "Service Workerが登録されていません"
      );
    }

    await registration.update();

    const updateWorker =
      registration.installing ||
      registration.waiting;

    if (updateWorker) {
      await waitForSettingsWorkerActivation(
        updateWorker
      );
    }

    await navigator.serviceWorker.ready;

    const cacheNames =
      await caches.keys();

    await Promise.all(
      cacheNames
        .filter(cacheName =>
          cacheName.startsWith(
            "staff-portal-"
          )
        )
        .map(cacheName =>
          caches.delete(cacheName)
        )
    );

    window.location.reload();

  } catch (error) {
    console.error(
      "アプリ更新エラー:",
      error
    );

    showSettingsAppUpdateMessage(
      "更新できませんでした。もう一度お試しください。",
      "error"
    );

    isSettingsAppUpdating = false;
    settingsAppUpdateButton.disabled = false;
    settingsAppUpdateButton.textContent =
      "最新状態に更新";
  }
}


async function registerSettingsServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  return navigator.serviceWorker.register(
    "./service-worker.js"
  );
}


async function loadSettingsPushState() {
  settingsPushNotifications.disabled = false;
  showSettingsPushMessage("");

  if (
    typeof window.isPushSupported !== "function" ||
    !window.isPushSupported()
  ) {
    settingsPushNotifications.checked = false;
    settingsPushNotifications.disabled = false;
    showSettingsPushMessage(
      "このブラウザでは通知を利用できません。",
      "error"
    );
    return;
  }

  try {
    await registerSettingsServiceWorker();

    settingsPushNotifications.checked =
      await window.isPushEnabled();
    if (Notification.permission === "denied") {
      showSettingsPushMessage(
        "ブラウザの通知設定を許可してください。",
        "error"
      );
    }
  } catch (error) {
    console.error("通知設定の読み込みエラー:", error);
    settingsPushNotifications.checked = false;
    showSettingsPushMessage(
      "通知設定を確認できませんでした。",
      "error"
    );
  } finally {
    settingsPushNotifications.disabled = false;
  }
}


async function changeSettingsPushNotifications() {
  if (isSettingsPushChanging) {
    return;
  }

  const shouldEnable =
    settingsPushNotifications.checked;

  isSettingsPushChanging = true;
  showSettingsPushMessage("");

  try {
    if (shouldEnable) {
      await registerSettingsServiceWorker();
      await window.enablePushNotifications();
      settingsPushNotifications.checked = true;
      showSettingsPushMessage(
        "通知をONにしました。",
        "success"
      );
    } else {
      await window.disablePushNotifications();
      settingsPushNotifications.checked = false;
      showSettingsPushMessage(
        "通知をOFFにしました。",
        "success"
      );
    }
  } catch (error) {
    console.error("通知設定の変更エラー:", error);
    settingsPushNotifications.checked =
      !shouldEnable;

    const permissionDenied =
      "Notification" in window &&
      Notification.permission === "denied";

    showSettingsPushMessage(
      permissionDenied
        ? "ブラウザの通知設定を許可してください。"
        : error.message || "通知設定を変更できませんでした。",
      "error"
    );
  } finally {
    isSettingsPushChanging = false;
    settingsPushNotifications.disabled = false;
  }
}


function showSettingsPasswordMessage(
  message,
  type = ""
) {
  settingsPasswordMessage.textContent =
    message;

  settingsPasswordMessage.classList.remove(
    "is-success",
    "is-error"
  );

  if (type) {
    settingsPasswordMessage.classList.add(
      `is-${type}`
    );
  }
}


function getSettingsPasswordErrorMessage(
  error
) {
  const status = Number(error?.status || 0);
  const originalMessage = String(
    error?.message || ""
  );
  const message = originalMessage.toLowerCase();
  let userMessage = "パスワードを変更できませんでした。";

  if (
    status === 401 ||
    message.includes("session") ||
    message.includes("jwt") ||
    message.includes("not authenticated") ||
    message.includes("ログイン")
  ) {
    userMessage =
      "認証セッションがありません。再度ログインしてください。";
  } else if (
    message.includes("same password") ||
    message.includes("different from the old password")
  ) {
    userMessage =
      "現在とは異なるパスワードを設定してください。";
  } else if (
    message.includes("weak") ||
    message.includes("password") &&
    message.includes("characters")
  ) {
    userMessage =
      "パスワードの強度が不足しています。8文字以上で設定してください。";
  }

  const details = [
    status ? `HTTP ${status}` : "",
    originalMessage
  ].filter(Boolean).join(" / ");

  return details
    ? `${userMessage}（詳細: ${details}）`
    : userMessage;
}


async function changeSettingsPassword(event) {
  event.preventDefault();

  if (isSettingsPasswordChanging) {
    return;
  }

  const newPassword =
    settingsNewPassword.value;
  const confirmation =
    settingsNewPasswordConfirmation.value;

  showSettingsPasswordMessage("");

  if (!newPassword || !confirmation) {
    showSettingsPasswordMessage(
      "2つのパスワードを入力してください。",
      "error"
    );
    return;
  }

  if (newPassword !== confirmation) {
    showSettingsPasswordMessage(
      "入力したパスワードが一致しません。",
      "error"
    );
    return;
  }

  if (newPassword.length < 8) {
    showSettingsPasswordMessage(
      "パスワードは8文字以上で入力してください。",
      "error"
    );
    return;
  }

  if (newPassword.length > 128) {
    showSettingsPasswordMessage(
      "パスワードは128文字以内で入力してください。",
      "error"
    );
    return;
  }

  let portalSession =
    getPortalAuthSession();

  if (
    !portalSession?.accessToken ||
    !portalSession?.refreshToken
  ) {
    showSettingsPasswordMessage(
      "認証セッションがありません。再度ログインしてください。",
      "error"
    );
    return;
  }

  isSettingsPasswordChanging = true;
  settingsPasswordChangeButton.disabled = true;
  settingsPasswordChangeButton.textContent =
    "変更中...";

  try {
    if (!window.supabase?.createClient) {
      throw new Error(
        "Supabase client is unavailable"
      );
    }

    await getPortalAccessToken();

    portalSession =
      getPortalAuthSession();

    if (
      !portalSession?.accessToken ||
      !portalSession?.refreshToken
    ) {
      throw Object.assign(
        new Error("Auth session missing"),
        { status: 401 }
      );
    }

    const settingsSupabase =
      window.supabase.createClient(
        PORTAL_SUPABASE_URL,
        PORTAL_SUPABASE_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
          }
        }
      );

    const { error: sessionError } =
      await settingsSupabase.auth.setSession({
        access_token:
          portalSession.accessToken,
        refresh_token:
          portalSession.refreshToken
      });

    if (sessionError) {
      throw sessionError;
    }

    const { error } =
      await settingsSupabase.auth.updateUser({
        password: newPassword
      });

    if (error) {
      throw error;
    }

    settingsNewPassword.value = "";
    settingsNewPasswordConfirmation.value = "";

    showSettingsPasswordMessage(
      "パスワードを変更しました",
      "success"
    );

  } catch (error) {
    showSettingsPasswordMessage(
      getSettingsPasswordErrorMessage(error),
      "error"
    );

  } finally {
    isSettingsPasswordChanging = false;
    settingsPasswordChangeButton.disabled = false;
    settingsPasswordChangeButton.textContent =
      "パスワードを変更";
  }
}


async function saveSettingsProfile(event) {
  event.preventDefault();

  if (settingsProfileSaveButton.disabled) {
    return;
  }

  settingsProfileSaveButton.disabled = true;
  settingsProfileSaveButton.textContent =
    "保存中...";
  showSettingsProfileMessage("");

  try {
    const response =
      await portalFetch(
        `${SETTINGS_SUPABASE_URL}/functions/v1/update-own-profile`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            profile_email:
              settingsProfileEmail.value,
            phone_number:
              settingsProfilePhone.value
          })
        }
      );

    let responseData = {};

    try {
      responseData =
        await response.json();
    } catch (error) {
      console.error(error);
    }

    if (!response.ok) {
      const message =
        response.status === 401
          ? "ログインの有効期限が切れています。再度ログインしてください。"
          : responseData.error ||
            "プロフィールを保存できませんでした。";

      throw new Error(message);
    }

    settingsProfileEmail.value =
      responseData.profile_email || "";

    settingsProfilePhone.value =
      responseData.phone_number || "";

    showSettingsProfileMessage(
      "保存しました。",
      "success"
    );

  } catch (error) {
    console.error(error);

    showSettingsProfileMessage(
      error.message ||
        "プロフィールを保存できませんでした。",
      "error"
    );

  } finally {
    settingsProfileSaveButton.disabled = false;
    settingsProfileSaveButton.textContent =
      "保存";
  }
}


function loadDisplayPreferenceControls() {
  settingsDarkMode.checked =
    localStorage.getItem(
      PORTAL_THEME_KEY
    ) === "dark";

  const savedFontSize =
    localStorage.getItem(
      PORTAL_FONT_SIZE_KEY
    );

  settingsFontSize.value =
    ["small", "large"].includes(
      savedFontSize
    )
      ? savedFontSize
      : "standard";
}


function saveDisplayPreferenceControls() {
  savePortalDisplayPreferences(
    settingsDarkMode.checked
      ? "dark"
      : "light",
    settingsFontSize.value
  );
}


settingsDarkMode.addEventListener(
  "change",
  saveDisplayPreferenceControls
);

settingsFontSize.addEventListener(
  "change",
  saveDisplayPreferenceControls
);

settingsProfileForm.addEventListener(
  "submit",
  saveSettingsProfile
);

settingsPasswordForm.addEventListener(
  "submit",
  changeSettingsPassword
);

if (settingsPushNotifications) {
  settingsPushNotifications.addEventListener(
    "change",
    changeSettingsPushNotifications
  );
}

if (settingsAppUpdateButton) {
  settingsAppUpdateButton.addEventListener(
    "click",
    updateSettingsApp
  );
}


async function initializeSettingsPage() {
  const loginUser =
    getSettingsLoginUser();

  if (
    !loginUser ||
    !loginUser.id
  ) {
    window.location.href =
      "login.html";

    return;
  }

  loadDisplayPreferenceControls();

  if (settingsPushNotifications) {
    await loadSettingsPushState();
  }

  try {
    await loadSettingsProfile(
      loginUser
    );

  } catch (error) {
    console.error(error);

    document.getElementById(
      "settingsProfileName"
    ).textContent =
      loginUser.name ||
      "読込失敗";

    document.getElementById(
      "settingsProfileDepartment"
    ).textContent =
      loginUser.department ||
      "読込失敗";

    document.getElementById(
      "settingsProfilePositionRow"
    ).classList.add("hidden");

    settingsProfileEmail.value = "";
    settingsProfilePhone.value = "";

    showSettingsProfileMessage(
      error.message ||
        "プロフィールを読み込めませんでした。",
      "error"
    );
  }
}


initializeSettingsPage();
