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

const allowedFields = new Set(["cycleName", "startStickerNumber"]);

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

function createCycleCode(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");

  return `${year}-${month}-${crypto.randomUUID()}`;
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

  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id,active,admin_scope")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (employeeError) {
    console.error("Failed to verify tool administrator:", employeeError.message);
    return jsonResponse({ success: false, error: "権限を確認できませんでした。" }, 500);
  }

  if (
    !employees ||
    employees.length !== 1 ||
    employees[0].active !== true ||
    !["all", "tool_admin"].includes(employees[0].admin_scope)
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
    return jsonResponse({ success: false, error: "使用できない項目が含まれています。" }, 400);
  }

  if (typeof input.cycleName !== "string") {
    return jsonResponse({ success: false, error: "点検サイクル名を入力してください。" }, 400);
  }

  const cycleName = input.cycleName.trim();
  const startStickerNumber = Number(input.startStickerNumber);

  if (!cycleName) {
    return jsonResponse({ success: false, error: "点検サイクル名を入力してください。" }, 400);
  }

  if (cycleName.length > 100) {
    return jsonResponse({ success: false, error: "点検サイクル名は100文字以内で入力してください。" }, 400);
  }

  if (!Number.isSafeInteger(startStickerNumber) || startStickerNumber < 1) {
    return jsonResponse({ success: false, error: "開始シール番号を正しく入力してください。" }, 400);
  }

  const now = new Date().toISOString();
  const { data: cycle, error: insertError } = await supabase
    .from("tool_inspection_cycles")
    .insert({
      cycle_code: createCycleCode(),
      cycle_name: cycleName,
      start_sticker_number: startStickerNumber,
      next_sticker_number: startStickerNumber,
      status: "active",
      created_by_employee_id: employees[0].id,
      updated_at: now,
    })
    .select("*")
    .single();

  if (insertError) {
    console.error("Failed to create inspection cycle:", insertError.message);
    return jsonResponse({ success: false, error: "半年点検を開始できませんでした。" }, 500);
  }

  return jsonResponse({ success: true, cycle }, 201);
});
