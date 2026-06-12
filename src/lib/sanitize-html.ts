import DOMPurify from "isomorphic-dompurify";

// Whiteboard node titles are edited via a contentEditable + execCommand,
// so only basic inline formatting is expected. Strip everything else
// (scripts, event handlers, iframes, etc.) before storing/rendering.
const ALLOWED_TAGS = ["b", "strong", "i", "em", "u", "span", "br", "div"];
const ALLOWED_ATTR = ["style"];

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
