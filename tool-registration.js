/* 工具マスタ・個人工具で共有するデータアクセス。採番の確定はDBで行う。 */
window.ToolRegistration = Object.freeze({
  async request(path, options = {}) {
    const response = await portalFetch(`${PORTAL_SUPABASE_URL}/rest/v1/${path}`, options);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || "工具情報を取得・保存できませんでした");
      error.code = data?.code;
      throw error;
    }
    return data;
  },
  loadTools(query = "select=*&order=tool_name.asc,management_code.asc") {
    return this.request(`tools?${query}`);
  },
  async loadMasterCatalog() {
    try {
      return await this.request("tool_catalog?select=*&order=sort_order.asc,tool_name.asc,id.asc");
    } catch (error) {
      if (["42P01", "PGRST205"].includes(error.code)) return null;
      throw error;
    }
  },
  async loadCatalog() {
    const catalog = await this.loadMasterCatalog();
    if (catalog !== null) return catalog.filter(item => item.active);
    return this.request("rpc/personal_tool_catalog", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
  },
  async correctPersonalIdentity(values) {
    const data = await this.request("rpc/correct_personal_tool_identity", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    return Array.isArray(data) ? data[0] : data;
  },
  async updatePersonal(values) {
    const data = await this.request("rpc/update_personal_tool", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    return Array.isArray(data) ? data[0] : data;
  },
  async registerPersonal(values) {
    const data = await this.request("rpc/register_personal_tool", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    return Array.isArray(data) ? data[0] : data;
  }
});
