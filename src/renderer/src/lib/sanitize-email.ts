import type { InlineAttachment } from '@shared/settings'
import DOMPurify from 'dompurify'

/**
 * Turn a stored message's HTML body into a self-contained HTML document that
 * is safe to drop into an `<iframe sandbox srcdoc="...">`. We rely on THREE
 * independent defenses, not any single one:
 *
 *  1. DOMPurify strips scripts, event handlers, iframes/objects/forms, and
 *     any `javascript:` / `vbscript:` URLs from href/src/style.
 *  2. A strict `<meta http-equiv="Content-Security-Policy">` blocks remote
 *     requests entirely — no tracking pixels, no remote fonts, no XHR. Only
 *     inline styles and `data:` images (for inlined `cid:` parts) are allowed.
 *  3. The caller renders the result inside an iframe with `sandbox="allow-popups
 *     allow-popups-to-escape-sandbox"` — no scripts, no same-origin, no form
 *     submission. `<base target="_blank">` below promotes link clicks to
 *     window-open events, which Electron's `setWindowOpenHandler` routes to
 *     the system browser.
 *
 * We also rewrite `cid:<content-id>` image refs to `data:<mime>;base64,...`
 * using the inline attachments that `messages.get` returned.
 */
export type SanitizeOptions = {
  /**
   * When true, the iframe is allowed to fetch http/https images. This enables
   * normal email rendering but also enables tracking pixels — the caller
   * controls this via a user-facing setting.
   */
  loadRemoteImages: boolean
}

export function buildSanitizedEmailDocument(
  bodyHtml: string,
  inlineAttachments: InlineAttachment[],
  options: SanitizeOptions = { loadRemoteImages: false }
): string {
  // DOMPurify needs `window` — we're in the renderer, so that's fine.
  const clean = DOMPurify.sanitize(bodyHtml, {
    // Strip the whole node, not just its contents, for dangerous tags.
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'textarea',
      'select',
      'button',
      'meta',
      'link',
      'base'
    ],
    // No target= anywhere — we set one <base target="_blank"> at the top.
    FORBID_ATTR: ['srcset', 'ping', 'formaction'],
    ALLOW_DATA_ATTR: false,
    // Keep inline styles. Email clients rely heavily on them.
    ALLOW_UNKNOWN_PROTOCOLS: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    WHOLE_DOCUMENT: false,
    RETURN_TRUSTED_TYPE: false
  })

  // After purification we still need to turn `cid:` refs into `data:` URLs.
  // We do this on a detached DOM so the main document is never touched.
  const parser = new DOMParser()
  const doc = parser.parseFromString(
    `<!doctype html><html><body>${clean}</body></html>`,
    'text/html'
  )

  const byCid = new Map<string, InlineAttachment>()
  for (const a of inlineAttachments) byCid.set(a.contentId.toLowerCase(), a)

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (src.toLowerCase().startsWith('cid:')) {
      const cid = src.slice(4).replace(/^<|>$/g, '').trim().toLowerCase()
      const hit = byCid.get(cid)
      if (hit) {
        img.setAttribute('src', `data:${hit.mime};base64,${hit.dataBase64}`)
      } else {
        // Missing inline part — drop the broken image rather than leaving a
        // `cid:` URL that would trigger a CSP violation for no reason.
        img.removeAttribute('src')
      }
    }
  }

  const innerHtml = doc.body.innerHTML

  // Strict CSP: no scripts, no remote scripts/styles/fonts. `style-src
  // 'unsafe-inline'` is required because email relies on inline styles — this
  // only allows inline style attributes, not script execution.
  // Remote images (http/https) are gated by the user-facing
  // `loadRemoteImages` setting because they double as tracking pixels.
  const imgSrc = options.loadRemoteImages ? 'img-src data: https: http:' : 'img-src data:'
  const csp = [
    "default-src 'none'",
    imgSrc,
    "style-src 'unsafe-inline'",
    'font-src data:',
    'media-src data:',
    "form-action 'none'",
    "frame-ancestors 'self'"
  ].join('; ')

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta charset="utf-8">
    <base target="_blank">
    <style>
      html, body { margin: 0; padding: 0; background: transparent; color: inherit; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.5;
        padding: 0 4px;
        word-break: break-word;
        user-select: text;
        -webkit-user-select: text;
        cursor: text;
      }
      img { max-width: 100%; height: auto; }
      a { color: #2563eb; }
    </style>
  </head>
  <body>${innerHtml}</body>
</html>`
}
