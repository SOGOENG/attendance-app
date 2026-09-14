/* Shared inspection access and cycle eligibility. Registration/numbering stay in existing RPCs. */
window.ToolInspectionWorkflow = (() => {
  let adminRequest;
  let latestCompletedId = null;
  return Object.freeze({
    requireAdmin() {
      return adminRequest ||= ToolRegistration.request("rpc/is_tool_registration_admin", {
        method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
      }).then(allowed => {
        if (allowed !== true) throw new Error("半年点検を利用する権限がありません。");
        return true;
      });
    },
    async refreshLatestCompleted() {
      latestCompletedId = null; // Fail closed if the query fails.
      latestCompletedId = await ToolRegistration.request("rpc/latest_completed_tool_inspection_cycle_id", {
        method: "POST", headers: {"Content-Type": "application/json"}, body: "{}"
      });
    },
    canAddToCycle(cycle) {
      return cycle.status === "active" || (cycle.status === "completed" &&
        latestCompletedId != null && String(cycle.id) === String(latestCompletedId));
    },
    calendarYear(cycle) {
      const namedYear = String(cycle.cycle_name || "").match(/(\d{4})\s*(?:年|[-/])/);
      if (namedYear) return Number(namedYear[1]);
      const date = new Date(cycle.created_at);
      return Number.isNaN(date.getTime()) ? null : date.getFullYear();
    },
    async rows(path) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await ToolRegistration.request(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`);
        rows.push(...page);
        if (page.length < 1000) return rows;
      }
    },
    async additions(cycleId, required = false) {
      try {
        return await this.rows(`tool_inspection_additions?select=*&inspection_cycle_id=eq.${encodeURIComponent(cycleId)}&order=tool_id.asc`);
      } catch (error) {
        // Existing inspections remain readable before the incremental SQL is installed.
        if (["42P01", "PGRST205"].includes(error.code) && !required) return [];
        throw error;
      }
    },
    canInspect(cycle, tool, additions, records) {
      if (!tool || tool.inspection_required !== true || tool.status === "disposed") return false;
      if (records.some(row => String(row.tool_id) === String(tool.id))) return false;
      if (cycle.status === "active") return true;
      return cycle.status === "completed" && this.canAddToCycle(cycle) && additions.some(row =>
        String(row.tool_id) === String(tool.id) && row.initial_purchase === true && !row.consumed_at);
    },
    async register(cycleId, record, latheSize, requestId, initialPurchase) {
      const result = await ToolRegistration.request("rpc/register_inspection_tool", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({p_cycle_id: cycleId, p_record: record, p_lathe_size: latheSize,
          p_request_id: requestId, p_initial_purchase: initialPurchase})
      });
      return Array.isArray(result) ? result[0] : result;
    }
  });
})();
