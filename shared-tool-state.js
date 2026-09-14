// Shared-tool display and operation rules. No database state is inferred from status
// except the three exceptional states; location is the source of normal state.
window.SharedToolState = (() => {
  function getDisplayToolStatus(tool) {
    if (["repair", "stopped", "disposed"].includes(tool.status)) return tool.status;
    return tool.current_site_id != null ? "in_use" : "available";
  }

  function isSharedToolAvailable(tool) {
    return tool?.ownership_type === "shared" && getDisplayToolStatus(tool) === "available";
  }

  function isSharedToolInUse(tool) {
    return tool?.ownership_type === "shared" && getDisplayToolStatus(tool) === "in_use";
  }

  function isManaged(tool) {
    return tool?.active === true && tool.checkout_managed === true;
  }

  const canCheckout = tool => isManaged(tool) && isSharedToolAvailable(tool);
  const canMoveOrReturn = tool => isManaged(tool) && isSharedToolInUse(tool);

  async function returnSharedTool(toolId, supabaseUrl) {
    const response = await portalFetch(`${supabaseUrl}/rest/v1/rpc/return_shared_tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_tool_id: toolId })
    });
    if (!response.ok) {
      let message = "工具の返却に失敗しました";
      try {
        const error = await response.json();
        if (error?.message) message = error.message;
      } catch {
        // Keep the fallback for non-JSON errors.
      }
      throw new Error(message);
    }
  }

  return Object.freeze({ getDisplayToolStatus, isSharedToolAvailable,
    isSharedToolInUse, canCheckout, canMoveOrReturn, returnSharedTool });
})();
