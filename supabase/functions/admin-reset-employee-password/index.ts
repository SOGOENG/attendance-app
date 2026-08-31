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

const allowedFields = new Set(["employeeId", "newPassword"]);

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
    return jsonResponse({ success: false, error: "変更できない項目が含まれています。" }, 400);
  }

  const employeeId = Number(input.employeeId);

  if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
    return jsonResponse({ success: false, error: "対象社員を指定してください。" }, 400);
  }

  if (typeof input.newPassword !== "string") {
    return jsonResponse({ success: false, error: "新しいパスワードを入力してください。" }, 400);
  }

  const newPassword = input.newPassword;

  if (newPassword.length < 8) {
    return jsonResponse({ success: false, error: "パスワードは8文字以上で入力してください。" }, 400);
  }

  if (newPassword.length > 128) {
    return jsonResponse({ success: false, error: "パスワードは128文字以内で入力してください。" }, 400);
  }

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id,auth_user_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (employeeError) {
    console.error("Failed to load target employee:", employeeError.message);
    return jsonResponse({ success: false, error: "対象社員を確認できませんでした。" }, 500);
  }

  if (!employee) {
    return jsonResponse({ success: false, error: "対象社員が見つかりません。" }, 404);
  }

  if (!employee.auth_user_id) {
    return jsonResponse({ success: false, error: "対象社員のログインアカウントがありません。" }, 409);
  }

  const { error: passwordError } = await supabase.auth.admin.updateUserById(
    employee.auth_user_id,
    { password: newPassword },
  );

  if (passwordError) {
    console.error("Failed to reset employee password:", passwordError.message);
    return jsonResponse({ success: false, error: "パスワードを再発行できませんでした。" }, 500);
  }

  return jsonResponse({
    success: true,
    message: "パスワードを再発行しました",
  }, 200);
});
