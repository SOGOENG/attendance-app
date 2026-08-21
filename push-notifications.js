/* =========================================
   Push Notifications
   工事部ポータル
========================================= */

/*
  Supabase
*/
const PUSH_SUPABASE_URL =
  "https://fgmvmbjnoyagnpygcbky.supabase.co";

/*
  VAPID公開鍵
  ※ 後でSupabase Edge Function側と同じ鍵にする
*/
const VAPID_PUBLIC_KEY =
  "BMyVGYtevLUxBDueYenN_1hTjcLVOE5f80CsyeNZAI4t-AM4w-dJJwHTaytc7DqnWWV6B3Pxy7oxyWlmkW-kdVw";

/* =========================================
   Push通知対応確認
========================================= */

function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}


/* =========================================
   通知許可状態
========================================= */

function getNotificationPermission() {
  if (!("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}


/* =========================================
   Base64 URL → Uint8Array
========================================= */

function urlBase64ToUint8Array(
  base64String
) {
  const padding =
    "=".repeat(
      (4 - base64String.length % 4) % 4
    );

  const base64 =
    (
      base64String + padding
    )
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const rawData =
    window.atob(base64);

  const outputArray =
    new Uint8Array(
      rawData.length
    );

  for (
    let i = 0;
    i < rawData.length;
    i++
  ) {
    outputArray[i] =
      rawData.charCodeAt(i);
  }

  return outputArray;
}


/* =========================================
   ログイン社員取得
========================================= */

function getPushLoginEmployee() {
  const text =
    localStorage.getItem(
      "portalLoginUser"
    );

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(
      "ログイン社員情報の読込に失敗",
      error
    );

    return null;
  }
}


/* =========================================
   通知許可
========================================= */

async function requestNotificationPermission() {
  if (!isPushSupported()) {
    throw new Error(
      "この端末はプッシュ通知に対応していません"
    );
  }

  const permission =
    await Notification.requestPermission();

  return permission;
}


/* =========================================
   Service Worker取得
========================================= */

async function getServiceWorkerRegistration() {
  if (
    !("serviceWorker" in navigator)
  ) {
    throw new Error(
      "Service Workerに対応していません"
    );
  }

  const registration =
    await navigator.serviceWorker.ready;

  return registration;
}


/* =========================================
   現在のPush購読取得
========================================= */

async function getCurrentPushSubscription() {
  const registration =
    await getServiceWorkerRegistration();

  const subscription =
    await registration.pushManager
      .getSubscription();

  return subscription;
}


/* =========================================
   Push購読作成
========================================= */

async function createPushSubscription() {
  if (!isPushSupported()) {
    throw new Error(
      "この端末はプッシュ通知に対応していません"
    );
  }

  if (
    !VAPID_PUBLIC_KEY ||
    VAPID_PUBLIC_KEY ===
      "ここにVAPID公開鍵を入れる"
  ) {
    throw new Error(
      "VAPID公開鍵が設定されていません"
    );
  }

  const permission =
    await requestNotificationPermission();

  if (permission !== "granted") {
    throw new Error(
      "通知が許可されていません"
    );
  }

  const registration =
    await getServiceWorkerRegistration();

  let subscription =
    await registration.pushManager
      .getSubscription();

  if (subscription) {
    return subscription;
  }

  subscription =
    await registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          urlBase64ToUint8Array(
            VAPID_PUBLIC_KEY
          )
      });

  return subscription;
}


/* =========================================
   Push購読をSupabaseへ保存
========================================= */

async function savePushSubscription(
  subscription
) {
  const employee =
    getPushLoginEmployee();

  if (!employee || !employee.id) {
    throw new Error(
      "ログイン社員情報を取得できません"
    );
  }

  if (!subscription) {
    throw new Error(
      "Push購読情報がありません"
    );
  }

  const json =
    subscription.toJSON();

  const p256dh =
    json.keys?.p256dh || "";

  const auth =
    json.keys?.auth || "";

  const data = {
    employee_id:
      Number(employee.id),

    endpoint:
      subscription.endpoint,

    p256dh:
      p256dh,

    auth:
      auth,

    user_agent:
      navigator.userAgent,

    active:
      true,

    updated_at:
      new Date().toISOString()
  };

  const endpointFilter =
    encodeURIComponent(
      subscription.endpoint
    );

  const existingResponse =
    await portalFetch(
      `${PUSH_SUPABASE_URL}` +
      `/rest/v1/push_subscriptions` +
      `?endpoint=eq.${endpointFilter}` +
      `&select=id`
    );

  if (!existingResponse.ok) {
    const text =
      await existingResponse.text();

    throw new Error(
      "通知端末の確認に失敗しました\n" +
      text
    );
  }

  const existing =
    await existingResponse.json();

  /*
    既存購読あり
  */
  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    const id =
      existing[0].id;

    const updateResponse =
      await portalFetch(
        `${PUSH_SUPABASE_URL}` +
        `/rest/v1/push_subscriptions` +
        `?id=eq.${id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
            Prefer:
              "return=minimal"
          },
          body:
            JSON.stringify(data)
        }
      );

    if (!updateResponse.ok) {
      const text =
        await updateResponse.text();

      throw new Error(
        "通知端末の更新に失敗しました\n" +
        text
      );
    }

    return;
  }

  /*
    新規購読
  */
  const insertResponse =
    await portalFetch(
      `${PUSH_SUPABASE_URL}` +
      `/rest/v1/push_subscriptions`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          Prefer:
            "return=minimal"
        },
        body:
          JSON.stringify(data)
      }
    );

  if (!insertResponse.ok) {
    const text =
      await insertResponse.text();

    throw new Error(
      "通知端末の登録に失敗しました\n" +
      text
    );
  }
}


/* =========================================
   通知ON
========================================= */

async function enablePushNotifications() {
  const subscription =
    await createPushSubscription();

  await savePushSubscription(
    subscription
  );

  return true;
}


/* =========================================
   通知OFF
========================================= */

async function disablePushNotifications() {
  const employee =
    getPushLoginEmployee();

  if (!employee || !employee.id) {
    throw new Error(
      "ログイン社員情報を取得できません"
    );
  }

  const subscription =
    await getCurrentPushSubscription();

  if (!subscription) {
    return true;
  }

  const endpointFilter =
    encodeURIComponent(
      subscription.endpoint
    );

  const response =
    await portalFetch(
      `${PUSH_SUPABASE_URL}` +
      `/rest/v1/push_subscriptions` +
      `?employee_id=eq.${employee.id}` +
      `&endpoint=eq.${endpointFilter}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type":
            "application/json",
          Prefer:
            "return=minimal"
        },
        body:
          JSON.stringify({
            active:
              false,
            updated_at:
              new Date().toISOString()
          })
      }
    );

  if (!response.ok) {
    const text =
      await response.text();

    throw new Error(
      "通知OFFの保存に失敗しました\n" +
      text
    );
  }

  try {
    await subscription.unsubscribe();
  } catch (error) {
    console.warn(
      "Push購読解除に失敗",
      error
    );
  }

  return true;
}


/* =========================================
   通知ON状態確認
========================================= */

async function isPushEnabled() {
  if (!isPushSupported()) {
    return false;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    return false;
  }

  const subscription =
    await getCurrentPushSubscription();

  return Boolean(subscription);
}


/* =========================================
   外部公開
========================================= */

window.isPushSupported =
  isPushSupported;

window.getNotificationPermission =
  getNotificationPermission;

window.requestNotificationPermission =
  requestNotificationPermission;

window.getCurrentPushSubscription =
  getCurrentPushSubscription;

window.enablePushNotifications =
  enablePushNotifications;

window.disablePushNotifications =
  disablePushNotifications;

window.isPushEnabled =
  isPushEnabled;

/* =========================================
   既存Push購読をSupabaseへ同期
========================================= */

async function syncPushSubscription() {
  if (!isPushSupported()) {
    return false;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    return false;
  }

  const subscription =
    await getCurrentPushSubscription();

  if (!subscription) {
    return false;
  }

  await savePushSubscription(
    subscription
  );

  return true;
}  