try {
  var p = localStorage.getItem("vibe-panel.tone");
  var t = p === "light" || p === "dark" ? p : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.tone = t;
} catch (e) {}
