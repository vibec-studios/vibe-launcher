export const css = `
:root{color-scheme:light;--surface:#fcfcfb;--panel:#ffffff;--border:#e4e3df;--text:#0b0b0b;--text2:#52514e;--muted:#8a8984;--grid:#ecebe7;--warn-bg:#fff6e0;--warn:#8a5a00;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#6250d6}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;--surface:#1a1a19;--panel:#222221;--border:#3a3936;--text:#f0efec;--text2:#c3c2b7;--muted:#8f8e86;--grid:#2e2d2b;--warn-bg:#3a2f12;--warn:#f0c060;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#9085e9}}
:root[data-theme="dark"]{color-scheme:dark;--surface:#1a1a19;--panel:#222221;--border:#3a3936;--text:#f0efec;--text2:#c3c2b7;--muted:#8f8e86;--grid:#2e2d2b;--warn-bg:#3a2f12;--warn:#f0c060;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#9085e9}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;overflow-wrap:anywhere;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 8px;padding-top:8px;border-top:1px solid var(--border)}
p,li{color:var(--text2)}.sub{color:var(--text2);margin:0 0 16px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 16px}.legend span{display:inline-flex;align-items:center;gap:6px;color:var(--text2)}
.legend i{width:12px;height:12px;border-radius:3px;display:inline-block}
.grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,480px),1fr));gap:16px}
figure.chart{min-width:0;margin:0;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
figcaption{font-weight:600;font-size:14px;margin-bottom:4px}
svg{width:100%;height:auto;display:block}
svg .grid{stroke:var(--grid);stroke-width:1}svg .axis{stroke:var(--muted);stroke-width:1}
svg text{font:12px system-ui,sans-serif;fill:var(--text2)}svg .tick{fill:var(--muted);font-size:11px}svg .value{fill:var(--text)}
svg .label{fill:var(--text)}svg .whisker{stroke:var(--text2);stroke-width:1.5}svg .hit{fill:transparent}
svg .mark:hover .bar{opacity:.8}
.s1{fill:var(--s1);background:var(--s1)}.s2{fill:var(--s2);background:var(--s2)}.s3{fill:var(--s3);background:var(--s3)}.s4{fill:var(--s4);background:var(--s4)}
.note{font-size:12px;color:var(--muted);margin:6px 0 0}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 14px;margin:12px 0}
.warn p,.warn li{color:var(--warn)}
.tablewrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
td{overflow-wrap:anywhere}
th,td{border-bottom:1px solid var(--border);padding:6px 8px;text-align:left;vertical-align:top}th{color:var(--text2);font-weight:600}
code{font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
details{margin:12px 0}summary{cursor:pointer;color:var(--text2)}
`;
