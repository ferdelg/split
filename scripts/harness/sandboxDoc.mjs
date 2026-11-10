// Builds the exact document Flinsh hands to a mini-app iframe, plus the parent
// page that hosts it.
//
// Source of truth: ../Flinch/web/src/lib/miniAppSandbox.ts (MINI_APP_SANDBOX,
// buildMiniAppCsp, buildMiniAppDocument, bridgeSource incl. flinsh.ai.chat via
// send() with err.code, the {__flinsh:"insets"} message and, when present, the
// store:user localStorage shim) and
// ../Flinch/web/src/components/phone/PhoneToolRunner.tsx (theme css +
// `html,body{margin:0;height:100%}`, insets posted on load).
//
// loadPlatform() compiles and imports THAT file when the sibling checkout
// exists, so the harness can't drift from the platform. Otherwise it falls
// back to the vendored copy below (same as the platform at the time of
// writing, minus the localStorage shim) and says so.
//
// Harness-only additions (never in the real frame), injected as a separate
// <script> right after the platform's bridge:
//   * a securitypolicyviolation reporter and an error/unhandledrejection
//     reporter, posted to the parent as {__flinsh:"csp"|"error"}.
// Not added: the PROPOSED flinsh.notifications and flinsh.files. The real
// bridge doesn't have them, so the harness exercises the in-app reminder
// banners and the inline photo mode.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PLATFORM_SOURCE = resolve(here, "../../../Flinch/web/src/lib/miniAppSandbox.ts");

/** The CSP the task (and docs/PLAN.md) expects for this app. */
export const EXPECTED_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

// ── vendored fallback (keep in sync by hand if the sibling repo is absent) ──
const AI_TIMEOUT_MS = 150_000;
const vendored = {
  MINI_APP_SANDBOX: "allow-scripts allow-forms",
  miniAppSandbox: () => "allow-scripts allow-forms",
  buildMiniAppCsp: () => EXPECTED_CSP,
  insetCss(insets = {}) {
    const v = (k) => Math.max(0, Math.round(Number(insets[k]) || 0));
    return `:root{${["top", "right", "bottom", "left"].map((k) => `--flinsh-inset-${k}:${v(k)}px`).join(";")}}`;
  },
  bridgeSource(input, scopes, ai) {
    return (
      `(function(){` +
      `var seq=0,waiting={};` +
      `function setInsets(i){if(!i||typeof document==="undefined")return;var s=document.documentElement.style;` +
      `["top","right","bottom","left"].forEach(function(k){if(typeof i[k]==="number"&&i[k]>=0)s.setProperty("--flinsh-inset-"+k,Math.round(i[k])+"px")})}` +
      `window.addEventListener("message",function(e){` +
      `if(e.source!==parent)return;` +
      `var d=e.data;if(!d)return;` +
      `if(d.__flinsh==="insets"){setInsets(d.insets);return}` +
      `if(d.__flinshReply==null)return;` +
      `var w=waiting[d.__flinshReply];if(!w)return;delete waiting[d.__flinshReply];` +
      `if(d.error){var err=new Error(d.error);if(d.code)err.code=d.code;w.reject(err)}else w.resolve(d.result);});` +
      `function send(msg,ms){return new Promise(function(res,rej){` +
      `var id=++seq;waiting[id]={resolve:res,reject:rej};msg.id=id;` +
      `parent.postMessage(msg,"*");` +
      `setTimeout(function(){if(waiting[id]){delete waiting[id];var t=new Error("timed out");t.code="timeout";rej(t)}},ms);` +
      `})}` +
      `function call(scope,op,payload){return send({__flinsh:"store",scope:scope,op:op,payload:payload||{}},15000)}` +
      `function api(scope){return{` +
      `get:function(k){return call(scope,"get",{key:k})},` +
      `set:function(k,v){return call(scope,"set",{key:k,value:v})},` +
      `list:function(p){return call(scope,"list",{prefix:p||""})},` +
      `delete:function(k){return call(scope,"delete",{key:k})}` +
      `}}` +
      `var store=api("user");` +
      (scopes.includes("app") ? `store.app=api("app");` : "") +
      (scopes.includes("office") ? `store.office=api("office");` : "") +
      `window.flinsh={input:${JSON.stringify(input)},` +
      `ready:function(){parent.postMessage({__flinsh:"ready"},"*")},` +
      `done:function(r){parent.postMessage({__flinsh:"done",result:r},"*")},` +
      `resize:function(h){parent.postMessage({__flinsh:"resize",height:h},"*")},` +
      `store:store,memory:api("user"),` +
      `log:function(label,status,detail){parent.postMessage(` +
      `{__flinsh:"worklog",event:{kind:"step",id:label,label:label,status:status||"done",detail:detail||""}},"*")}` +
      `};` +
      (ai ? `window.flinsh.ai={chat:function(r){return send({__flinsh:"ai",op:"chat",payload:r||{}},${AI_TIMEOUT_MS})}};` : "") +
      `window.dispatchEvent(new Event("flinsh:ready"));` +
      `})();`
    );
  },
  buildMiniAppDocument(opts) {
    const { html, themeCss, input, permissions = [], insets } = opts;
    const scopes = ["user", "app", "office"].filter((s) => permissions.includes(`store:${s}`));
    return (
      `<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP}">` +
      `<style>${themeCss}</style>` +
      `<style>${vendored.insetCss(insets)}</style>` +
      `<script>${vendored.bridgeSource(input, scopes, permissions.includes("ai"))}<\/script>` +
      html
    );
  },
};

/** The platform module: the real one (compiled from TS) or the vendored copy. */
export async function loadPlatform() {
  if (existsSync(PLATFORM_SOURCE)) {
    try {
      const { transformWithOxc } = await import("vite");
      const ts = readFileSync(PLATFORM_SOURCE, "utf8");
      const out = await transformWithOxc(ts, PLATFORM_SOURCE, { lang: "ts" });
      const mod = await import(`data:text/javascript;base64,${Buffer.from(out.code).toString("base64")}`);
      if (typeof mod.buildMiniAppDocument === "function" && typeof mod.MINI_APP_SANDBOX === "string") {
        return { ...mod, source: PLATFORM_SOURCE, real: true };
      }
    } catch (err) {
      console.warn(`harness: couldn't compile ${PLATFORM_SOURCE} (${String(err.message || err).split("\n")[0]}); using the vendored bridge.`);
    }
  }
  return { ...vendored, source: "scripts/harness/sandboxDoc.mjs (vendored)", real: false };
}

// ── harness-only reporters ───────────────────────────────────────────────────
export const REPORTER_SOURCE =
  `(function(){` +
  `document.addEventListener("securitypolicyviolation",function(e){parent.postMessage({__flinsh:"csp",detail:{` +
  `blockedURI:e.blockedURI,violatedDirective:e.violatedDirective,sourceFile:e.sourceFile,lineNumber:e.lineNumber,sample:e.sample}},"*")});` +
  `window.addEventListener("error",function(e){parent.postMessage({__flinsh:"error",detail:String(e.message||e.error)},"*")});` +
  `window.addEventListener("unhandledrejection",function(e){var r=e.reason;parent.postMessage({__flinsh:"error",detail:"unhandledrejection: "+(r&&r.stack||r)},"*")});` +
  `})();`;

// Flinsh's phone theme vars (light), as PhoneToolRunner reads them.
export const THEME_CSS =
  ":root{--bg:#fff;--surface:#fff;--surface-2:#f4f4f5;--border:#e4e4e7;--text:#111;--muted:#666;--accent:#c026a6;color-scheme:light dark}" +
  ";html,body{margin:0;height:100%}";

/** The srcdoc: CSP first, theme, insets, the platform bridge, our reporters, the app. */
export function buildSrcdoc(platform, html, { permissions, input = {} }) {
  return platform.buildMiniAppDocument({
    html: `<script>${REPORTER_SOURCE}<\/script>` + html,
    themeCss: THEME_CSS,
    input,
    permissions,
  });
}

/**
 * The parent page. Store and AI requests are answered by Node through exposed
 * bindings (__hStore, __hAi, __hEvent), after the same identity check Flinsh
 * makes (e.source === frame.contentWindow). Replies use the platform's shape
 * {__flinshReply, result, error, code}. On load (and on __hInsets()) the
 * parent posts {__flinsh:"insets", insets} like PhoneToolRunner.
 */
export function buildParentPage(srcdoc, { sandbox, insets, title = "Split" }) {
  const doc = JSON.stringify(srcdoc).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;height:100%;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;display:block}</style>
</head><body><script>
(function(){
  var frame = document.createElement("iframe");
  frame.setAttribute("sandbox", ${JSON.stringify(sandbox)});
  frame.setAttribute("title", ${JSON.stringify(title)});
  var insets = ${JSON.stringify(insets)};
  window.__hPostInsets = function (i) { if (i) insets = i; frame.contentWindow && frame.contentWindow.postMessage({ __flinsh: "insets", insets: insets }, "*"); };
  frame.addEventListener("load", function () { window.__hPostInsets(); });
  window.addEventListener("message", function (e) {
    if (e.source !== frame.contentWindow) { window.__hEvent({ kind: "foreign-message" }); return; }
    var d = e.data;
    if (!d || typeof d !== "object") return;
    var reply = function (r) { frame.contentWindow && frame.contentWindow.postMessage(Object.assign({ __flinshReply: d.id }, r), "*"); };
    if (d.__flinsh === "store") { window.__hStore(d).then(reply); return; }
    if (d.__flinsh === "ai") { window.__hAi(d).then(reply); return; }
    window.__hEvent({ kind: d.__flinsh, detail: d.detail !== undefined ? d.detail : d.result !== undefined ? d.result : d.height });
  });
  frame.srcdoc = ${doc};
  document.body.appendChild(frame);
})();
</script></body></html>`;
}
