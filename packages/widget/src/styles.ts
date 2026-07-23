// Scoped styles for the embedded widget. Injected once per mount; everything
// is namespaced under .fx- so it can't collide with the host page.

const CSS = `
.fx-card{--fx-ink:#14202b;--fx-muted:#5f6f7e;--fx-line:#e3e8ee;--fx-surface:#fff;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fx-ink);
  background:var(--fx-surface);border:1px solid var(--fx-line);border-radius:16px;
  padding:22px;max-width:440px;box-shadow:0 10px 40px rgba(20,32,43,.08);box-sizing:border-box}
.fx-card *{box-sizing:border-box}
.fx-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.fx-brand{font-weight:700;font-size:15px}
.fx-badge{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#fff;
  background:var(--fx-accent);border-radius:999px;padding:3px 10px}
.fx-steps{display:flex;gap:6px;margin-bottom:16px;font-size:11px;color:var(--fx-muted)}
.fx-steps span{flex:1;padding-bottom:6px;border-bottom:2px solid var(--fx-line)}
.fx-steps span.on{color:var(--fx-accent);border-color:var(--fx-accent);font-weight:600}
.fx-steps span.past{color:var(--fx-ink);border-color:var(--fx-accent)}
.fx-result{display:flex;flex-direction:column;gap:2px;background:#f6f9f7;border:1px solid var(--fx-line);
  border-radius:12px;padding:14px 16px;margin-bottom:16px}
.fx-result span{font-size:12px;color:var(--fx-muted)}
.fx-result strong{font-size:30px;letter-spacing:-.02em;color:var(--fx-accent)}
.fx-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}
.fx-field>span{font-size:12.5px;font-weight:600}
.fx-field em{font-style:normal;font-size:11px;color:var(--fx-muted)}
.fx-field input[type=text],.fx-field input[type=email],.fx-field input[type=tel],.fx-field select{
  border:1px solid var(--fx-line);border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;
  color:var(--fx-ink);background:#fff;width:100%}
.fx-field input:focus,.fx-field select:focus{outline:2px solid color-mix(in srgb,var(--fx-accent) 40%,transparent);border-color:var(--fx-accent)}
.fx-field input[type=range]{width:100%;accent-color:var(--fx-accent);margin:2px 0}
.fx-field output{font-size:13px;font-weight:600;color:var(--fx-ink);font-variant-numeric:tabular-nums}
.fx-chips{display:flex;gap:8px;flex-wrap:wrap}
.fx-chip{border:1px solid var(--fx-line);background:#fff;border-radius:999px;padding:8px 13px;font-size:13px;
  font-family:inherit;cursor:pointer;color:var(--fx-muted)}
.fx-chip.on{background:var(--fx-accent);border-color:var(--fx-accent);color:#fff;font-weight:600}
.fx-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.fx-summary{font-size:13px;color:var(--fx-muted);margin-bottom:14px;padding:10px 12px;background:#f6f9f7;border-radius:9px}
.fx-summary b{color:var(--fx-accent)}
.fx-consent{border-top:1px solid var(--fx-line);margin-top:6px;padding-top:12px;display:flex;flex-direction:column;gap:9px}
.fx-consent label{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:var(--fx-ink);line-height:1.4;cursor:pointer}
.fx-consent input{margin-top:2px;accent-color:var(--fx-accent)}
.fx-terms{font-size:11px;color:var(--fx-muted);margin:6px 0 0;line-height:1.5}
.fx-terms a{color:var(--fx-accent);text-decoration:underline}
.fx-row{display:flex;gap:10px;margin-top:6px}
.fx-next{flex:1;background:var(--fx-accent);color:#fff;border:0;border-radius:10px;padding:12px;font-size:14.5px;
  font-weight:600;font-family:inherit;cursor:pointer}
.fx-next:disabled{opacity:.45;cursor:not-allowed}
.fx-back{background:#fff;border:1px solid var(--fx-line);border-radius:10px;padding:12px 16px;font-size:14px;
  font-family:inherit;cursor:pointer;color:var(--fx-muted)}
.fx-error{background:#fdecea;color:#a3281b;border-radius:9px;padding:10px 12px;font-size:12.5px;margin:6px 0}
.fx-done{text-align:center;padding:14px 6px}
.fx-check{width:46px;height:46px;border-radius:50%;background:var(--fx-accent);color:#fff;font-size:24px;
  display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
.fx-done h3{margin:0 0 6px;font-size:19px}
.fx-done p{margin:0 auto 14px;color:var(--fx-muted);font-size:14px;max-width:34ch;line-height:1.5}
.fx-done p b{color:var(--fx-ink)}
.fx-readiness{display:inline-block;font-size:13px;background:#f6f9f7;border:1px solid var(--fx-line);
  border-radius:999px;padding:6px 14px}
.fx-readiness b{color:var(--fx-accent);font-size:15px}
`;

export function renderStyles(mount: HTMLElement) {
  if (document.getElementById("fx-styles")) return;
  const style = document.createElement("style");
  style.id = "fx-styles";
  style.textContent = CSS;
  (mount.ownerDocument.head ?? mount.ownerDocument.body).appendChild(style);
}
