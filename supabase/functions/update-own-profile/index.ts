import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

const allowedFields = new Set(["profile_email", "phone_number"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxPhoneNumberLength = 100;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "POSTメソッドで送信してください。" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const accessToken = tokenMatch?.[1]?.trim();

  if (!accessToken) {
    return jsonResponse({ success: false, error: "認証情報がありません。" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Required Supabase environment variables are not configured.");
    return jsonResponse({ success: false, error: "サーバー設定に問題があります。" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  const user = userData.user;

  if (userError || !user) {
    return jsonResponse({ success: false, error: "認証情報が無効です。再度ログインしてください。" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "JSON形式のリクエストを送信してください。" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ success: false, error: "入力内容が正しくありません。" }, 400);
  }

  const input = body as Record<string, unknown>;
  const unknownFields = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unknownFields.length > 0) {
    return jsonResponse({ success: false, error: "更新できない項目が含まれています。" }, 400);
  }

  if (!("profile_email" in input) && !("phone_number" in input)) {
    return jsonResponse({ success: false, error: "更新する項目を指定してください。" }, 400);
  }

  const updates: { profile_email?: string | null; phone_number?: string } = {};

  if ("profile_email" in input) {
    if (typeof input.profile_email !== "string") {
      return jsonResponse({ success: false, error: "メールアドレスは文字列で入力してください。" }, 400);
    }

    const profileEmail = input.profile_email.trim();
    if (profileEmail && (profileEmail.length > 254 || !emailPattern.test(profileEmail))) {
      return jsonResponse({ success: false, error: "メールアドレスの形式を確認してください。" }, 400);
    }
    updates.profile_email = profileEmail || null;
  }

  if ("phone_number" in input) {
    if (typeof input.phone_number !== "string") {
      return jsonResponse({ success: false, error: "電話番号は文字列で入力してください。" }, 400);
    }

    const phoneNumber = input.phone_number.trim();
    if (phoneNumber.length > maxPhoneNumberLength) {
      return jsonResponse({ success: false, error: "電話番号が長すぎます。" }, 400);
    }
    updates.phone_number = phoneNumber;
  }

  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (employeeError) {
    console.error("Failed to find employee record:", employeeError.message);
    return jsonResponse({ success: false, error: "社員情報の確認に失敗しました。" }, 500);
  }

  if (!employees || employees.length === 0) {
    return jsonResponse({ success: false, error: "本人に対応する社員情報が見つかりません。" }, 404);
  }

  if (employees.length > 1) {
    console.error(`Multiple employee records found for auth user ${user.id}.`);
    return jsonResponse({ success: false, error: "社員情報を一意に特定できません。" }, 409);
  }

  const { data: updatedEmployee, error: updateError } = await supabase
    .from("employees")
    .update(updates)
    .eq("id", employees[0].id)
    .eq("auth_user_id", user.id)
    .select("profile_email, phone_number")
    .single();

  if (updateError) {
    console.error("Failed to update employee profile:", updateError.message);
    return jsonResponse({ success: false, error: "プロフィールの保存に失敗しました。" }, 500);
  }

  return jsonResponse({
    success: true,
    profile_email: updatedEmployee.profile_email,
    phone_number: updatedEmployee.phone_number,
  }, 200);
});
