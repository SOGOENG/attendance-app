/* =========================================
   Supabase接続設定
========================================= */

const SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_pePa2xjccUZB6xpneNhCRQ_pJJ5fn6h";


/* =========================================
   HTML要素
========================================= */

const loginEmployee =
  document.getElementById(
    "loginEmployee"
  );

const loginPassword =
  document.getElementById(
    "loginPassword"
  );

const loginButton =
  document.getElementById(
    "loginButton"
  );

const loginMessage =
  document.getElementById(
    "loginMessage"
  );


/* =========================================
   読み込んだ社員データ
========================================= */

let employees = [];


/* =========================================
   Supabase共通ヘッダー
========================================= */

function supabaseHeaders() {
  return {
    apikey:
      SUPABASE_KEY,

    Authorization:
      `Bearer ${SUPABASE_KEY}`
  };
}


/* =========================================
   社員一覧読込
========================================= */

async function loadEmployees() {
  loginMessage.textContent = "";

  loginEmployee.disabled = true;
  loginButton.disabled = true;

  loginEmployee.innerHTML =
    '<option value="">' +
    '社員一覧を読み込み中...' +
    '</option>';

  const url =
    `${SUPABASE_URL}/rest/v1/employees` +
    `?select=` +
    `id,name,department,active,admin_scope,is_leave_manager,auth_user_id` +
    `&active=eq.true` +
    `&order=department.asc,id.asc`;

  const response =
    await fetch(url, {
      headers:
        supabaseHeaders()
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(errorText);

    throw new Error(
      "社員一覧の読み込みに失敗しました"
    );
  }

  employees =
    await response.json();

  makeEmployeeOptions();

  loginEmployee.disabled = false;
  loginButton.disabled = false;

  loginButton.textContent =
    "ログイン";
}


/* =========================================
   氏名プルダウン作成
========================================= */

function makeEmployeeOptions() {
  loginEmployee.innerHTML =
    '<option value="">' +
    '氏名を選択してください' +
    '</option>';

  let currentDepartment = "";

  employees.forEach(employee => {
    /*
      部署が変わったら、
      プルダウン内に部署見出しを作る。
    */

    if (
      employee.department !==
      currentDepartment
    ) {
      currentDepartment =
        employee.department;

      const group =
        document.createElement(
          "optgroup"
        );

      group.label =
        currentDepartment || "部署未設定";

      group.dataset.department =
        currentDepartment || "";

      loginEmployee.appendChild(
        group
      );
    }

    const option =
      document.createElement(
        "option"
      );

    option.value =
      String(employee.id);

    option.textContent =
      employee.name;

    const currentGroup =
      loginEmployee.querySelector(
        `optgroup[data-department="${CSS.escape(
          currentDepartment || ""
        )}"]`
      );

    if (currentGroup) {
      currentGroup.appendChild(
        option
      );

    } else {
      loginEmployee.appendChild(
        option
      );
    }
  });
}


/* =========================================
   選択した社員情報取得
========================================= */

function getSelectedEmployee() {
  const employeeId =
    Number(loginEmployee.value);

  if (!employeeId) {
    return null;
  }

  return (
    employees.find(
      employee =>
        Number(employee.id) ===
        employeeId
    ) || null
  );
}


/* =========================================
   Supabase Authでログイン
========================================= */

async function signInWithPassword(
  email,
  password
) {
  const url =
    `${SUPABASE_URL}/auth/v1/token` +
    `?grant_type=password`;

  const response =
    await fetch(url, {
      method:
        "POST",

      headers: {
        apikey:
          SUPABASE_KEY,

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify({
          email,
          password
        })
    });

  const responseData =
    await response.json();

  if (!response.ok) {
    console.error(
      responseData
    );

    throw new Error(
      "氏名またはパスワードが違います"
    );
  }

  return responseData;
}


/* =========================================
   ログイン情報保存
========================================= */

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


/* =========================================
   保存済みログイン情報を削除
========================================= */

function clearLoginInformation() {
  clearPortalLoginInformation();
}


/* =========================================
   ログイン処理
========================================= */

async function login() {
  loginMessage.textContent = "";

  const employee =
    getSelectedEmployee();

  const password =
    loginPassword.value;

  if (!employee) {
    loginMessage.textContent =
      "氏名を選択してください";

    loginEmployee.focus();

    return;
  }

  if (!password) {
    loginMessage.textContent =
      "パスワードを入力してください";

    loginPassword.focus();

    return;
  }

  if (!employee.auth_user_id) {
    loginMessage.textContent =
      "ログインアカウントが未登録です。管理者へ連絡してください";

    return;
  }

  loginButton.disabled = true;

  loginEmployee.disabled = true;
  loginPassword.disabled = true;

  loginButton.textContent =
    "ログイン中...";

  clearLoginInformation();

  try {
    /*
      社員IDから内部メールを作成する。
    */

    const internalEmail =
      `employee-${employee.id}` +
      `@staff-portal.local`;

    /*
      Supabase Authで認証する。
    */

    const authData =
      await signInWithPassword(
        internalEmail,
        password
      );

    /*
      認証したAuthユーザーと、
      employeesのauth_user_idが一致するか確認する。
    */

    if (
      String(authData.user.id) !==
      String(employee.auth_user_id)
    ) {
      clearLoginInformation();

      throw new Error(
        "社員情報とログイン情報が一致しません。管理者へ連絡してください"
      );
    }

    /*
      ログイン情報を保存する。
    */

    saveLoginInformation(
      employee,
      authData
    );

    /*
      ホーム画面へ移動する。
    */

    window.location.href =
      "home.html";

  } catch (error) {
    console.error(error);

    clearLoginInformation();

    loginMessage.textContent =
      error.message;

  } finally {
    loginButton.disabled = false;

    loginEmployee.disabled = false;
    loginPassword.disabled = false;

    loginButton.textContent =
      "ログイン";
  }
}


/* =========================================
   イベント設定
========================================= */

loginButton.addEventListener(
  "click",
  login
);


loginEmployee.addEventListener(
  "change",
  () => {
    loginMessage.textContent = "";

    if (loginEmployee.value) {
      loginPassword.focus();
    }
  }
);


/*
  パスワード欄でEnterを押しても
  ログインする。
*/

loginPassword.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      login();
    }
  }
);


/* =========================================
   初期読込
========================================= */

clearLoginInformation();

loadEmployees()
  .catch(error => {
    console.error(error);

    loginMessage.textContent =
      error.message;

    loginEmployee.innerHTML =
      '<option value="">' +
      '社員一覧を読み込めませんでした' +
      '</option>';

    loginEmployee.disabled = true;

    loginButton.disabled = true;

    loginButton.textContent =
      "ログイン";
  });
