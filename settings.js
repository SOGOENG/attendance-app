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
