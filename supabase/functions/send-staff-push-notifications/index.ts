import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type InvocationType = "morning" | "tomorrow" | "application";
type NotificationType =
  | "overdue_submission"
  | "today_schedule"
  | "tomorrow_schedule"
  | "application_submitted"
  | "application_approved"
  | "application_revision_required"
  | "application_rejected";

type Employee = {
  id: number;
  name: string | null;
  department: string | null;
  active: boolean;
  admin_scope: string | null;
  auth_user_id: string | null;
};

type PushSubscriptionRow = {
  id: number;
  employee_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type NotificationRequest = {
  notificationType: NotificationType;
  notificationDate: string;
  targetMonth: string | null;
  employeeIds: Set<number>;
  body: string;
  url: string;
  title?: string;
  applicationId?: number;
  eventType?: string;
};

type DeliverySummary = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  deactivated: number;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function getRequiredSecret(name: string): string {
  const value = Deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

async function secretsMatch(
  supplied: string,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const suppliedBytes = new Uint8Array(suppliedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = suppliedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < suppliedBytes.length; index += 1) {
    difference |= suppliedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

function getJstDateParts(date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function addDays(
  parts: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + days,
    12,
  ));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function formatDate(parts: {
  year: number;
  month: number;
  day: number;
}): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${
    String(parts.day).padStart(2, "0")
  }`;
}

function formatTargetMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function getAttendanceRange(year: number, month: number): {
  firstDay: string;
  nextFirstDay: string;
} {
  const firstDay = new Date(Date.UTC(year, month - 2, 21, 12));
  const nextFirstDay = new Date(Date.UTC(year, month - 1, 21, 12));

  return {
    firstDay: formatDate({
      year: firstDay.getUTCFullYear(),
      month: firstDay.getUTCMonth() + 1,
      day: firstDay.getUTCDate(),
    }),
    nextFirstDay: formatDate({
      year: nextFirstDay.getUTCFullYear(),
      month: nextFirstDay.getUTCMonth() + 1,
      day: nextFirstDay.getUTCDate(),
    }),
  };
}

function getStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const value = (error as { statusCode?: unknown }).statusCode;
  const statusCode = Number(value);

  return Number.isFinite(statusCode) ? statusCode : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 2000);
  }

  return String(error).slice(0, 2000);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    let input: unknown;

    try {
      input = await request.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
    }

    const invocationType =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as { type?: unknown }).type
        : null;

    if (!["morning", "tomorrow", "application"].includes(String(invocationType))) {
      return jsonResponse({
        success: false,
        error: "type must be morning, tomorrow or application",
      }, 400);
    }

    if (invocationType !== "application") {
      const cronSecret = getRequiredSecret("STAFF_PUSH_CRON_SECRET");
      const suppliedSecret = request.headers.get("x-cron-secret")?.trim() || "";

      if (!suppliedSecret || !(await secretsMatch(suppliedSecret, cronSecret))) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
    }

    const supabaseUrl = getRequiredSecret("SUPABASE_URL");
    const serviceRoleKey = getRequiredSecret("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = getRequiredSecret("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = getRequiredSecret("VAPID_PRIVATE_KEY");
    const vapidSubject = getRequiredSecret("VAPID_SUBJECT");

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey,
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let authenticatedUserId: string | null = null;

    if (invocationType === "application") {
      const authorization = request.headers.get("authorization") || "";
      const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
      const { data, error } = await supabase.auth.getUser(accessToken);

      if (error || !data.user) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }

      authenticatedUserId = data.user.id;
    }
    const todayParts = getJstDateParts();
    const today = formatDate(todayParts);
    const tomorrowParts = addDays(todayParts, 1);
    const tomorrow = formatDate(tomorrowParts);

    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("id,name,department,active,admin_scope,auth_user_id");

    if (employeeError) {
      throw new Error(`Failed to load employees: ${employeeError.message}`);
    }

    const employees = (employeeRows || []) as Employee[];
    const employeeById = new Map(
      employees.map((employee) => [Number(employee.id), employee]),
    );
    const notificationRequests: NotificationRequest[] = [];

    if (invocationType === "application") {
      const payload = input as {
        application_id?: unknown;
        event?: unknown;
      };
      const applicationId = Number(payload.application_id);
      const eventType = String(payload.event || "");
      const allowedEvents = [
        "submitted",
        "approved",
        "revision_required",
        "rejected",
      ];

      if (!Number.isInteger(applicationId) || !allowedEvents.includes(eventType)) {
        return jsonResponse({ success: false, error: "Invalid application event" }, 400);
      }

      const actor = employees.find((employee) =>
        employee.active === true && employee.auth_user_id === authenticatedUserId
      );
      const { data: application, error: applicationError } = await supabase
        .from("applications")
        .select("id,employee_id,application_type,status,reviewer_comment")
        .eq("id", applicationId)
        .single();

      if (applicationError || !application || !actor) {
        return jsonResponse({ success: false, error: "Application not found" }, 404);
      }

      const normalizedActorName = (actor.name || "").replace(/[ 　]/g, "");
      const actorIsAdmin = actor.admin_scope === "all" || normalizedActorName === "鈴木和弘";
      const applicationType = application.application_type === "paid_leave"
        ? "有給休暇申請"
        : "代替休日申請";

      if (eventType === "submitted") {
        if (
          Number(application.employee_id) !== Number(actor.id) ||
          actor.department !== "工事部" ||
          application.status !== "submitted"
        ) {
          return jsonResponse({ success: false, error: "Forbidden" }, 403);
        }

        notificationRequests.push({
          notificationType: "application_submitted",
          notificationDate: today,
          targetMonth: null,
          employeeIds: new Set(employees.filter((employee) =>
            employee.active === true &&
            (employee.admin_scope === "all" ||
              (employee.name || "").replace(/[ 　]/g, "") === "鈴木和弘")
          ).map((employee) => Number(employee.id))),
          title: "各種申請が提出されました",
          body: `${actor.name || "社員"}さんから${applicationType}が提出されました。`,
          url: `./applications-admin.html?panel=pending&application=${applicationId}`,
          applicationId,
          eventType,
        });
      } else {
        if (!actorIsAdmin || application.status !== eventType) {
          return jsonResponse({ success: false, error: "Forbidden" }, 403);
        }

        const resultText = eventType === "approved"
          ? "承認されました"
          : eventType === "revision_required"
          ? "差し戻されました"
          : "却下されました";
        const comment = String(application.reviewer_comment || "").trim();

        notificationRequests.push({
          notificationType: `application_${eventType}` as NotificationType,
          notificationDate: today,
          targetMonth: null,
          employeeIds: new Set([Number(application.employee_id)]),
          title: `${applicationType}の結果`,
          body: `${applicationType}が${resultText}。${comment ? ` 管理者コメント：${comment}` : ""}`.trim(),
          url: `./applications.html?panel=history&application=${applicationId}`,
          applicationId,
          eventType,
        });
      }
    }

    if (invocationType === "morning") {
      const overdueEmployeeIds = new Set<number>();
      const overdueTargetMonths = new Set<string>();

      // 20日に締め切られた対象月を、翌21日に判定する。
      if (todayParts.day === 21) {
        const targetMonth = formatTargetMonth(todayParts.year, todayParts.month);
        const range = getAttendanceRange(todayParts.year, todayParts.month);
        const { data, error } = await supabase
          .from("attendance")
          .select("employee_id,status")
          .gte("work_date", range.firstDay)
          .lt("work_date", range.nextFirstDay)
          .in("status", ["submitted", "locked"]);

        if (error) {
          throw new Error(`Failed to load attendance: ${error.message}`);
        }

        const submittedIds = new Set(
          (data || []).map((row) => Number(row.employee_id)),
        );

        for (const employee of employees) {
          if (!submittedIds.has(Number(employee.id))) {
            overdueEmployeeIds.add(Number(employee.id));
          }
        }

        overdueTargetMonths.add(targetMonth);
      }

      // 向上提案とヒヤリハットは25日締め、翌26日に判定する。
      if (todayParts.day === 26) {
        const targetMonth = formatTargetMonth(todayParts.year, todayParts.month);
        const { data: settings, error: settingError } = await supabase
          .from("improvement_settings")
          .select("target_month")
          .eq("is_published", true)
          .order("target_month", { ascending: false })
          .limit(1);

        if (settingError) {
          throw new Error(
            `Failed to load improvement settings: ${settingError.message}`,
          );
        }

        const publishedTargetMonth = settings?.[0]?.target_month
          ? String(settings[0].target_month).slice(0, 10)
          : null;
        const normalizedPublishedMonth = publishedTargetMonth
          ? `${publishedTargetMonth.slice(0, 7)}-01`
          : null;

        if (normalizedPublishedMonth === targetMonth) {
          const { data, error } = await supabase
            .from("improvements")
            .select("department,employee_name")
            .eq("target_month", settings![0].target_month)
            .eq("status", "submitted");

          if (error) {
            throw new Error(`Failed to load improvements: ${error.message}`);
          }

          const submittedKeys = new Set(
            (data || []).map((row) =>
              `${row.department || ""}\u0000${row.employee_name || ""}`
            ),
          );

          for (const employee of employees) {
            const key = `${employee.department || ""}\u0000${employee.name || ""}`;

            if (!submittedKeys.has(key)) {
              overdueEmployeeIds.add(Number(employee.id));
            }
          }

          overdueTargetMonths.add(targetMonth);
        }

        const { data: nearMisses, error: nearMissError } = await supabase
          .from("near_misses")
          .select("department,employee_name")
          .eq("target_month", targetMonth)
          .eq("status", "submitted");

        if (nearMissError) {
          throw new Error(`Failed to load near misses: ${nearMissError.message}`);
        }

        const nearMissSubmittedKeys = new Set(
          (nearMisses || []).map((row) =>
            `${row.department || ""}\u0000${row.employee_name || ""}`
          ),
        );

        for (const employee of employees) {
          const key = `${employee.department || ""}\u0000${employee.name || ""}`;

          if (!nearMissSubmittedKeys.has(key)) {
            overdueEmployeeIds.add(Number(employee.id));
          }
        }

        overdueTargetMonths.add(targetMonth);
      }

      if (overdueEmployeeIds.size > 0) {
        notificationRequests.push({
          notificationType: "overdue_submission",
          notificationDate: today,
          targetMonth: [...overdueTargetMonths][0] || null,
          employeeIds: overdueEmployeeIds,
          body: "未提出があります。マイページを確認してください",
          url: "./my-page.html",
        });
      }

      const { data: todaySchedules, error: todayScheduleError } = await supabase
        .from("schedules")
        .select("target_scope")
        .eq("schedule_date", today);

      if (todayScheduleError) {
        throw new Error(
          `Failed to load today's schedules: ${todayScheduleError.message}`,
        );
      }

      const scopes = new Set(
        (todaySchedules || []).map((schedule) => String(schedule.target_scope)),
      );
      const scheduledEmployeeIds = new Set(
        employees
          .filter((employee) =>
            scopes.has("all") || scopes.has(employee.department || "")
          )
          .map((employee) => Number(employee.id)),
      );

      if (scheduledEmployeeIds.size > 0) {
        notificationRequests.push({
          notificationType: "today_schedule",
          notificationDate: today,
          targetMonth: null,
          employeeIds: scheduledEmployeeIds,
          body: "本日の予定があります。ホームを確認してください",
          url: "./home.html",
        });
      }
    }

    if (invocationType === "tomorrow") {
      const { data: tomorrowSchedules, error: tomorrowScheduleError } =
        await supabase
          .from("schedules")
          .select("target_scope")
          .eq("schedule_date", tomorrow);

      if (tomorrowScheduleError) {
        throw new Error(
          `Failed to load tomorrow's schedules: ${tomorrowScheduleError.message}`,
        );
      }

      const scopes = new Set(
        (tomorrowSchedules || []).map((schedule) =>
          String(schedule.target_scope)
        ),
      );
      const scheduledEmployeeIds = new Set(
        employees
          .filter((employee) =>
            scopes.has("all") || scopes.has(employee.department || "")
          )
          .map((employee) => Number(employee.id)),
      );

      if (scheduledEmployeeIds.size > 0) {
        notificationRequests.push({
          notificationType: "tomorrow_schedule",
          notificationDate: tomorrow,
          targetMonth: null,
          employeeIds: scheduledEmployeeIds,
          body: "明日の予定があります。ホームを確認してください",
          url: "./home.html",
        });
      }
    }

    const allTargetEmployeeIds = new Set(
      notificationRequests.flatMap((item) => [...item.employeeIds]),
    );
    let subscriptions: PushSubscriptionRow[] = [];

    if (allTargetEmployeeIds.size > 0) {
      const { data, error } = await supabase
        .from("push_subscriptions")
        .select("id,employee_id,endpoint,p256dh,auth")
        .eq("active", true)
        .in("employee_id", [...allTargetEmployeeIds]);

      if (error) {
        throw new Error(`Failed to load push subscriptions: ${error.message}`);
      }

      subscriptions = (data || []) as PushSubscriptionRow[];
    }

    const summary: DeliverySummary = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      deactivated: 0,
    };

    for (const notification of notificationRequests) {
      const targetSubscriptions = subscriptions.filter((subscription) =>
        notification.employeeIds.has(Number(subscription.employee_id))
      );

      for (const subscription of targetSubscriptions) {
        const idempotencyKey = notification.applicationId
          ? [
            `application_${notification.eventType}`,
            notification.applicationId,
            subscription.employee_id,
            subscription.id,
          ].join(":")
          : [
            notification.notificationType,
            notification.notificationDate,
            subscription.employee_id,
            subscription.id,
          ].join(":");
        const { data: delivery, error: deliveryError } = await supabase
          .from("notification_deliveries")
          .insert({
            notification_type: notification.notificationType,
            employee_id: subscription.employee_id,
            push_subscription_id: subscription.id,
            notification_date: notification.notificationDate,
            target_month: notification.targetMonth,
            application_id: notification.applicationId || null,
            event_type: notification.eventType || null,
            idempotency_key: idempotencyKey,
            status: "pending",
            attempted_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (deliveryError?.code === "23505") {
          summary.skipped += 1;
          continue;
        }

        if (deliveryError || !delivery) {
          throw new Error(
            `Failed to reserve notification delivery: ${deliveryError?.message}`,
          );
        }

        summary.attempted += 1;

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: notification.title || "工事部ポータル",
              body: notification.body,
              url: notification.url,
            }),
            { TTL: 60 * 60 * 12, urgency: "normal" },
          );

          const { error } = await supabase
            .from("notification_deliveries")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              error_message: null,
            })
            .eq("id", delivery.id);

          if (error) {
            console.error("Failed to mark delivery sent", delivery.id, error.message);
          }

          summary.sent += 1;
        } catch (error) {
          const statusCode = getStatusCode(error);
          const errorMessage = getErrorMessage(error);
          const { error: updateError } = await supabase
            .from("notification_deliveries")
            .update({ status: "failed", error_message: errorMessage })
            .eq("id", delivery.id);

          if (updateError) {
            console.error(
              "Failed to mark delivery failed",
              delivery.id,
              updateError.message,
            );
          }

          if (statusCode === 404 || statusCode === 410) {
            const { error: deactivateError } = await supabase
              .from("push_subscriptions")
              .update({
                active: false,
                updated_at: new Date().toISOString(),
              })
              .eq("id", subscription.id)
              .eq("endpoint", subscription.endpoint);

            if (deactivateError) {
              console.error(
                "Failed to deactivate push subscription",
                subscription.id,
                deactivateError.message,
              );
            } else {
              summary.deactivated += 1;
            }
          }

          summary.failed += 1;
          console.error(
            "Push delivery failed",
            notification.notificationType,
            subscription.id,
            statusCode,
            errorMessage,
          );
        }
      }
    }

    return jsonResponse({
      success: true,
      type: invocationType,
      jst_date: today,
      notifications: notificationRequests.map((item) => ({
        type: item.notificationType,
        employees: item.employeeIds.size,
      })),
      delivery: summary,
      known_employees: employeeById.size,
    }, 200);
  } catch (error) {
    console.error("send-staff-push-notifications failed", error);

    return jsonResponse({
      success: false,
      error: "Notification processing failed",
    }, 500);
  }
});
