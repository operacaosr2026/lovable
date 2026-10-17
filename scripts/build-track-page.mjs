// Gera public/track-page.js a partir de shopify/track-page-v2.liquid (a fonte da
// página de rastreio da Voultie). Na loja fica só o carregador
// (shopify/track-page-loader.liquid), que chama este arquivo — assim mudança na
// página entra no ar com o deploy, sem colar nada no tema. Roda no build.
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../shopify/track-page-v2.liquid", import.meta.url), "utf8");

const between = (start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`track-page-v2.liquid: não achei ${start} … ${end}`);
  return src.slice(a + start.length, b);
};
const links = [...src.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
const css = between("<style>", "</style>");
const js = between("<script>", "</script>");
const htmlStart = src.indexOf('<div id="vt-track">');
const html = src.slice(htmlStart, src.indexOf("<style>")).trim();
if (htmlStart < 0) throw new Error('track-page-v2.liquid: não achei <div id="vt-track">');

const out = `/* Gerado por scripts/build-track-page.mjs a partir de shopify/track-page-v2.liquid — não editar aqui. */
(function () {
  var root = document.getElementById("vt-track-root");
  if (!root) { root = document.createElement("div"); (document.currentScript || document.body.lastChild).parentNode.insertBefore(root, document.currentScript); }
  if (root.getAttribute("data-loaded")) return;
  root.setAttribute("data-loaded", "1");
  ${JSON.stringify(links)}.forEach(function (l) { document.head.insertAdjacentHTML("beforeend", l); });
  var style = document.createElement("style");
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
  root.innerHTML = ${JSON.stringify(html)};
})();
${js}
`;
writeFileSync(new URL("../public/track-page.js", import.meta.url), out);
console.log(`public/track-page.js gerado (${(out.length / 1024).toFixed(0)} KB)`);
