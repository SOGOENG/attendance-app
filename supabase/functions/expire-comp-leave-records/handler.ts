type ExpirationRow = {
  newly_expired_days: number | string;
};

type Dependencies = {
  secret: () => string | undefined;
  expire: () => Promise<ExpirationRow[]>;
};

async function secretsMatch(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const hashes = await Promise.all([supplied, expected].map(value =>
    crypto.subtle.digest("SHA-256", encoder.encode(value))
  ));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function createHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, {
        status: 405, headers: { Allow: "POST" },
      });
    }
    const expected = dependencies.secret()?.trim();
    if (!expected) {
      return Response.json({ error: "Expiration secret is not configured" }, { status: 503 });
    }
    const supplied = request.headers.get("x-cron-secret")?.trim();
    if (!supplied || !(await secretsMatch(supplied, expected))) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      // 日付・社員IDをリクエストから受け取らない。DBのJST当日で一括処理する。
      const rows = await dependencies.expire();
      return Response.json({
        success: true,
        processed_records: rows.length,
        newly_expired_days: rows.reduce((total, row) =>
          total + Number(row.newly_expired_days), 0),
      });
    } catch {
      // DBの詳細やsecret、社員情報をレスポンス・ログへ出さない。
      console.error("Comp leave expiration RPC failed");
      return Response.json({ error: "Expiration failed" }, { status: 500 });
    }
  };
}
