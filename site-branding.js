(function () {
  "use strict";
  const OLD_NAME = "منصة علي عليان الدولية";
  let currentName = "";
  const replaceText = value => typeof value === "string" && currentName ? value.split(OLD_NAME).join(currentName) : value;
  function walk(node) {
    if (node.nodeType === 3) { const next = replaceText(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; return; }
    if (node.nodeType !== 1 || node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
    for (const attr of ["title","aria-label","alt","placeholder","content","value"]) {
      if (node.hasAttribute(attr)) { const value=node.getAttribute(attr), next=replaceText(value); if(next!==value) node.setAttribute(attr,next); }
    }
    for (const child of node.childNodes) walk(child);
  }
  // Consistent hover feedback for interactive controls and gentle zoom for all site images.
  const interactionStyle = document.createElement("style");
  interactionStyle.id = "site-interaction-effects";
  interactionStyle.textContent = `
    button, input[type="button"], input[type="submit"], input[type="reset"],
    a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"],
    .site-nav nav a, .auth-link, .nav-tools .tool, .tabs button, .join, .back,
    .primary, .secondary, .cta, [data-interactive="true"] {
      transition: background-color .22s ease, background-image .22s ease, color .22s ease,
        border-color .22s ease, box-shadow .22s ease, filter .22s ease, transform .22s ease;
    }
    .site-hover-light:hover {
      background: linear-gradient(135deg,#20b9ad 0%,#078e91 100%) !important;
      border-color: #078e91 !important;
      color: #fff !important;
      box-shadow: 0 7px 18px rgba(7,142,145,.22) !important;
    }
    .site-hover-color:hover {
      filter: brightness(.86) saturate(1.18);
      box-shadow: 0 7px 18px rgba(15,75,90,.18);
    }
    .site-hover-light:active, .site-hover-color:active { transform: translateY(1px) scale(.975); }
    img:not([data-no-zoom]) {
      transition: transform .32s cubic-bezier(.2,.7,.25,1), filter .32s ease;
      transform-origin: center;
    }
    img:not([data-no-zoom]):hover {
      transform: scale(1.045);
      filter: saturate(1.04);
    }
    @media (prefers-reduced-motion: reduce) {
      button, input[type="button"], input[type="submit"], input[type="reset"],
      a.btn, a.button, a[class*="btn"], a[class*="button"], a[role="button"],
      .site-nav nav a, .auth-link, .nav-tools .tool, .tabs button, .join, .back,
      .primary, .secondary, .cta, [data-interactive="true"],
      img:not([data-no-zoom]) { transition-duration: .01ms !important; }
      img:not([data-no-zoom]):hover { transform: none; }
    }`;
  (document.head || document.documentElement).appendChild(interactionStyle);

  const interactiveSelector = 'button:not(:disabled),input[type="button"]:not(:disabled),input[type="submit"]:not(:disabled),input[type="reset"]:not(:disabled),a.btn,a.button,a[class*="btn"],a[class*="button"],a[role="button"],.site-nav nav a,.tabs button,.join,.back,.grade-card,.primary,.secondary,.cta,[data-interactive="true"]';
  function colorBrightness(value) {
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1].split(",").map(Number);
    if (parts.length < 3 || parts.slice(0,3).some(Number.isNaN)) return null;
    if (parts.length > 3 && parts[3] === 0) return null;
    const [r,g,b] = parts;
    return (Math.max(r,g,b) + Math.min(r,g,b)) / 510;
  }
  function classifyHoverTarget(target) {
    const control = target.closest(interactiveSelector);
    if (!control || control.dataset.siteHoverBound === "1") return;
    control.dataset.siteHoverBound = "1";
    control.addEventListener("pointerenter", () => {
      const style = getComputedStyle(control);
      const brightness = colorBrightness(style.backgroundColor);
      const gradient = style.backgroundImage && style.backgroundImage !== "none";
      const lightSurface = brightness === null
        ? !gradient || /#fff|255,\s*255,\s*255|#f[0-9a-f]{5}/i.test(style.backgroundImage)
        : brightness >= .76;
      control.classList.toggle("site-hover-light", lightSurface);
      control.classList.toggle("site-hover-color", !lightSurface);
    });
  }
  document.addEventListener("pointerover", event => {
    if (event.target instanceof Element) classifyHoverTarget(event.target);
  }, true);
  document.querySelectorAll(interactiveSelector).forEach(classifyHoverTarget);

  fetch("/api/site-settings", { credentials: "same-origin", cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (!data?.ok) return;
      const logoData = String(data.branding?.logoData || "");
      const bannerData = String(data.branding?.bannerData || "");
      document.querySelectorAll("[data-site-logo]").forEach(image => {
        if (logoData) {
          image.src = logoData;
          image.hidden = false;
        } else {
          image.removeAttribute("src");
          image.hidden = true;
        }
      });
      const heroVisual = document.querySelector(".hero-visual");
      if (heroVisual && bannerData) {
        const image = document.createElement("img");
        image.src = bannerData;
        image.alt = "صورة المنصة الرئيسية";
        image.className = "site-hero-image";
        heroVisual.replaceChildren(image);
        heroVisual.classList.add("has-image");
      }
      const name = String(data?.organization?.name || "").trim();
      if (!name || name === OLD_NAME) return;
      currentName = name;
      document.title = replaceText(document.title);
      walk(document.documentElement);
      const observer = new MutationObserver(records => {
        for (const record of records) {
          if (record.type === "characterData") walk(record.target);
          for (const node of record.addedNodes || []) walk(node);
        }
        document.title = replaceText(document.title);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    }).catch(() => {});
})();