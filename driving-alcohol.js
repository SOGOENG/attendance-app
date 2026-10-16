// Shared future Excel mapping; no export feature or conversion of legacy names.
window.DrivingAlcohol = Object.freeze({
  excelConfirmerCode(name) { return name === '中尾' ? 1 : name === '安藤' ? 2 : ''; }
});
