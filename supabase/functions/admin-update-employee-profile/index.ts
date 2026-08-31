import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

const allowedFields = new Set([
  "employeeId",
  "name",
  "department",
  "job_title",
  "profile_email",
  "phone_number",
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  return match?.[1]?.trim() || null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "POSTメソッドで送信してください。" }, 405);
  }

  const accessToken = getBearerToken(request);

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
  const { data: userData, error: userError } =
    await supabase.auth.getUser(accessToken);
  const user = userData.user;

  if (userError || !user) {
    return jsonResponse({
      success: false,
      error: "認証情報が無効です。再度ログインしてください。",
    }, 401);
  }

  const { data: administrators, error: administratorError } = await supabase
    .from("employees")
    .select("id,active,admin_scope")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (administratorError) {
    console.error("Failed to verify administrator:", administratorError.message);
    return jsonResponse({ success: false, error: "管理者権限を確認できませんでした。" }, 500);
  }

  if (
    !administrators ||
    administrators.length !== 1 ||
    administrators[0].active !== true ||
    administrators[0].admin_scope !== "all"
  ) {
    return jsonResponse({ success: false, error: "この操作を行う権限がありません。" }, 403);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, error: "JSON形式で送信してください。" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ success: false, error: "入力内容が正しくありません。" }, 400);
  }

  const input = body as Record<string, unknown>;
  const unknownFields = Object.keys(input).filter(
    (field) => !allowedFields.has(field),
  );

  if (unknownFields.length > 0) {
    return jsonResponse({ success: false, error: "更新できない項目が含まれています。" }, 400);
  }

  const employeeId = Number(input.employeeId);

  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    return jsonResponse({ success: false, error: "対象社員を指定してください。" }, 400);
  }

  if (typeof input.name !== "string" || !input.name.trim()) {
    return jsonResponse({ success: false, error: "氏名を入力してください。" }, 400);
  }

  if (typeof input.department !== "string" || !input.department.trim()) {
    return jsonResponse({ success: false, error: "部署を入力してください。" }, 400);
  }

  if (
    typeof input.job_title !== "string" ||
    typeof input.profile_email !== "string" ||
    typeof input.phone_number !== "string"
  ) {
    return jsonResponse({ success: false, error: "プロフィールの形式が正しくありません。" }, 400);
  }

  const name = input.name.trim();
  const department = input.department.trim();
  const jobTitle = input.job_title.trim();
  const profileEmail = input.profile_email.trim();
  const phoneNumber = input.phone_number.trim();

  if (name.length > 100) {
    return jsonResponse({ success: false, error: "氏名が長すぎます。" }, 400);
  }

  if (department.length > 100) {
    return jsonResponse({ success: false, error: "部署名が長すぎます。" }, 400);
  }

  if (jobTitle.length > 100) {
    return jsonResponse({ success: false, error: "役職が長すぎます。" }, 400);
  }

  if (profileEmail.length > 254) {
    return jsonResponse({ success: false, error: "メールアドレスが長すぎます。" }, 400);
  }

  if (profileEmail && !emailPattern.test(profileEmail)) {
    return jsonResponse({ success: false, error: "メールアドレスの形式を確認してください。" }, 400);
  }

  if (phoneNumber.length > 100) {
    return jsonResponse({ success: false, error: "電話番号が長すぎます。" }, 400);
  }

  const { data: employee, error: updateError } = await supabase
    .from("employees")
    .update({
      name,
      department,
      job_title: jobTitle || null,
      profile_email: profileEmail || null,
      phone_number: phoneNumber,
    })
    .eq("id", employeeId)
    .select("id,name,department,job_title,profile_email,phone_number")
    .maybeSingle();

  if (updateError) {
    console.error("Failed to update employee profile:", updateError.message);
    return jsonResponse({ success: false, error: "社員プロフィールを更新できませんでした。" }, 500);
  }

  if (!employee) {
    return jsonResponse({ success: false, error: "対象社員が見つかりません。" }, 404);
  }

  return jsonResponse({ success: true, employee }, 200);
});
