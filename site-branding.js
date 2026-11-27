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

  // Shared entrance and card motion for public pages and student/admin screens.
  const motionStyle = document.createElement("style");
  motionStyle.id = "site-entrance-card-motion";
  motionStyle.textContent = [
    ".site-hero-rise, .site-hero-part { opacity:0; will-change:opacity,transform,filter; animation:siteHeroRise .86s cubic-bezier(.2,.78,.24,1) both; }",
    "@keyframes siteHeroRise { from { opacity:0; transform:translate3d(0,28px,0) scale(.988); filter:blur(2px); } to { opacity:1; transform:translate3d(0,0,0) scale(1); filter:blur(0); } }",
    "[data-site-motion-card='pending'] { opacity:0; transform:translate3d(var(--site-motion-x,12px),0,0); transition:opacity .56s ease,transform .64s cubic-bezier(.2,.78,.24,1),box-shadow .28s ease,border-color .28s ease; transition-delay:var(--site-motion-delay,0ms); will-change:opacity,transform; }",
    "[data-site-motion-card='visible'] { opacity:1; transform:translate3d(0,0,0); }",
    "[data-site-motion-card='visible']:hover { transform:translate3d(0,-3px,0) scale(1.012); box-shadow:0 14px 32px rgba(15,35,60,.11); border-color:rgba(42,169,224,.22); transition-delay:0ms; }",
    "[data-site-motion-card='visible']:hover img:not([data-no-zoom]) { transform:scale(1.035); }",
    "@media(max-width:768px) { [data-site-motion-card='pending'] { transform:translate3d(var(--site-motion-mobile-x,8px),0,0); } [data-site-motion-card='visible']:hover { transform:translate3d(0,-2px,0) scale(1.008); } }",
    "@media(prefers-reduced-motion:reduce) { .site-hero-rise,.site-hero-part { opacity:1; transform:none; filter:none; animation:none; } [data-site-motion-card='pending'],[data-site-motion-card='visible'] { opacity:1; transform:none; transition:none; } [data-site-motion-card='visible']:hover { transform:none; box-shadow:inherit; } [data-site-motion-card='visible']:hover img:not([data-no-zoom]) { transform:none; } }"
  ].join("\n");
  (document.head || document.documentElement).appendChild(motionStyle);

  const motionCardSelector = [
    ".course-card", ".benefit", ".teacher", ".pcard", ".post",
    ".card", ".panel", ".stat", ".surface", ".security-card",
    ".feature-card", ".form-card", ".tablecard", ".product",
    ".plan", ".course", ".grade-card", ".about-visual", ".promo-panel",
    ".featured > article", ".benefits > article", ".teacher-grid > *",
    "#gradeGrid > *", "#coursesGrid > article",
    "#libraryGrid > article", "#blogGrid > article"
  ].join(",");
  let motionCardIndex = 0;
  let cardObserver = null;

  if (typeof IntersectionObserver === "function") {
    cardObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-site-motion-card", "visible");
        cardObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -4% 0px" });
  }

  function prepareHeroMotion(hero) {
    if (!(hero instanceof HTMLElement) || hero.dataset.siteHeroMotion === "1") return;
    hero.dataset.siteHeroMotion = "1";

    const content = hero.querySelector(".hero-content") || hero.querySelector(":scope > .wrap");
    if (content) {
      if (content.classList.contains("wrap") && content.children.length > 1) {
        [...content.children].forEach((part, index) => {
          if (!(part instanceof HTMLElement) || part.classList.contains("circle")) return;
          part.classList.add("site-hero-part");
          part.style.animationDelay = String(index * 110) + "ms";
        });
      } else {
        content.classList.add("site-hero-rise");
      }
      return;
    }

    [...hero.children].forEach((part, index) => {
      if (!(part instanceof HTMLElement) || part.classList.contains("circle")) return;
      part.classList.add("site-hero-part");
      part.style.animationDelay = String(index * 95) + "ms";
    });
  }

  function prepareMotionCard(card) {
    if (!(card instanceof HTMLElement) || card.dataset.siteMotionCard) return;
    const index = motionCardIndex++;
    const offset = index % 2 === 0 ? 12 : -12;
    card.style.setProperty("--site-motion-x", String(offset) + "px");
    card.style.setProperty("--site-motion-mobile-x", String(offset > 0 ? 8 : -8) + "px");
    card.style.setProperty("--site-motion-delay", String((index % 4) * 45) + "ms");

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.dataset.siteMotionCard = "visible";
      return;
    }

    card.dataset.siteMotionCard = cardObserver ? "pending" : "visible";
    if (cardObserver) cardObserver.observe(card);
  }

  function prepareMotionTree(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(".hero")) prepareHeroMotion(root);
    root.querySelectorAll(".hero").forEach(prepareHeroMotion);
    if (root.matches(motionCardSelector)) prepareMotionCard(root);
    root.querySelectorAll(motionCardSelector).forEach(prepareMotionCard);
  }

  prepareMotionTree(document.documentElement);
  if (document.body && typeof MutationObserver === "function") {
    const motionMutationObserver = new MutationObserver(records => {
      records.forEach(record => {
        record.addedNodes.forEach(node => {
          if (node instanceof Element) prepareMotionTree(node);
        });
      });
    });
    motionMutationObserver.observe(document.body, { childList: true, subtree: true });
  }

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


  function isPrivacyPolicyLink(link) {
    const label = String(link.textContent || "").replace(/\s+/g, " ").trim();
    return label === "سياسة الخصوصية" || link.getAttribute("href") === "#privacy";
  }
  function installPrivacyPolicyModal() {
    const hasPrivacyLink = [...document.querySelectorAll("a")].some(isPrivacyPolicyLink);
    if (!hasPrivacyLink) return;

    const style = document.createElement("style");
    style.id = "site-privacy-modal-style";
    style.textContent = "\n    .site-privacy-overlay{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:22px;background:rgba(15,23,42,.62);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}\n    .site-privacy-overlay[hidden]{display:none}\n    .site-privacy-dialog{width:min(760px,100%);max-height:min(86vh,820px);display:flex;flex-direction:column;overflow:hidden;background:#fff;border:1px solid rgba(42,169,224,.22);border-radius:22px;box-shadow:0 24px 80px rgba(15,23,42,.28);direction:rtl;animation:sitePrivacyIn .2s ease-out}\n    .site-privacy-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 24px;background:linear-gradient(120deg,#effaff,#fff);border-bottom:1px solid #e5eef4}\n    .site-privacy-heading{margin:0;color:#0f7a9a;font-size:22px;font-weight:800}\n    .site-privacy-subtitle{margin:5px 0 0;color:#64748b;font-size:13px}\n    .site-privacy-close{width:40px;height:40px;flex:none;border:1px solid #dbe7ee;border-radius:12px;background:#fff;color:#0f7a9a;font:700 24px/1 \"Segoe UI\",Tahoma,sans-serif;cursor:pointer;transition:background .18s ease,color .18s ease,border-color .18s ease,transform .18s ease}\n    .site-privacy-close:hover{background:#20b9ad;border-color:#20b9ad;color:#fff;transform:rotate(4deg)}\n    .site-privacy-content{padding:24px;overflow:auto;min-height:170px;color:#334155;font-size:16px;line-height:2;white-space:pre-wrap;overflow-wrap:anywhere}\n    @keyframes sitePrivacyIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}\n    @media(max-width:600px){.site-privacy-overlay{padding:12px}.site-privacy-dialog{max-height:90vh;border-radius:17px}.site-privacy-head{padding:16px}.site-privacy-heading{font-size:19px}.site-privacy-content{padding:18px;font-size:15px}}\n    @media(prefers-reduced-motion:reduce){.site-privacy-dialog{animation:none}.site-privacy-close{transition:none}}\n";
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.className = "site-privacy-overlay";
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");

    const dialog = document.createElement("section");
    dialog.className = "site-privacy-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "site-privacy-heading");
    dialog.tabIndex = -1;

    const header = document.createElement("header");
    header.className = "site-privacy-head";
    const headingWrap = document.createElement("div");
    const heading = document.createElement("h2");
    heading.className = "site-privacy-heading";
    heading.id = "site-privacy-heading";
    heading.textContent = "سياسة الخصوصية";
    const subtitle = document.createElement("p");
    subtitle.className = "site-privacy-subtitle";
    subtitle.textContent = "منصة علي عليان الدولية";
    headingWrap.append(heading, subtitle);

    const closeButton = document.createElement("button");
    closeButton.className = "site-privacy-close";
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "إغلاق نافذة سياسة الخصوصية");
    closeButton.textContent = "×";
    header.append(headingWrap, closeButton);

    const content = document.createElement("div");
    content.className = "site-privacy-content";
    content.setAttribute("aria-live", "polite");
    content.textContent = "جار تحميل سياسة الخصوصية...";
    dialog.append(header, content);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let lastFocused = null;
    let previousOverflow = "";
    let requestNumber = 0;

    function closeModal() {
      if (overlay.hidden) return;
      requestNumber += 1;
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = previousOverflow;
      if (lastFocused && lastFocused.isConnected) lastFocused.focus();
    }

    async function openModal(trigger) {
      lastFocused = trigger;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      overlay.hidden = false;
      overlay.setAttribute("aria-hidden", "false");
      content.textContent = "جار تحميل سياسة الخصوصية...";
      closeButton.focus();
      const currentRequest = ++requestNumber;
      try {
        const response = await fetch("/api/site-settings", {
          credentials: "same-origin",
          cache: "no-store"
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error("privacy settings unavailable");
        if (currentRequest !== requestNumber || overlay.hidden) return;
        const policy = String(data.legal && data.legal.privacyText || "").trim();
        content.textContent = policy || "لم يتم نشر سياسة الخصوصية بعد. يرجى مراجعة إدارة المنصة.";
      } catch (_) {
        if (currentRequest !== requestNumber || overlay.hidden) return;
        content.textContent = "تعذر تحميل سياسة الخصوصية حاليًا. يرجى المحاولة مرة أخرى لاحقًا.";
      }
    }

    document.addEventListener("click", event => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || !isPrivacyPolicyLink(link)) return;
      event.preventDefault();
      openModal(link);
    });
    closeButton.addEventListener("click", closeModal);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closeModal();
    });
    document.addEventListener("keydown", event => {
      if (overlay.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      } else if (event.key === "Tab") {
        event.preventDefault();
        closeButton.focus();
      }
    });
  }
  installPrivacyPolicyModal();


  function applyFooterSocialLinks(links) {
    const fieldsByLabel = {
      "فيسبوك": "facebook",
      "facebook": "facebook",
      "إنستجرام": "instagram",
      "انستجرام": "instagram",
      "instagram": "instagram",
      "يوتيوب": "youtube",
      "youtube": "youtube"
    };
    document.querySelectorAll(".footer-social a").forEach(link => {
      const label = String(link.getAttribute("aria-label") || link.textContent || "")
        .replace(/\s+/g, " ").trim().toLowerCase();
      const field = fieldsByLabel[label];
      const rawUrl = field ? String(links && links[field] || "").trim() : "";
      let safeUrl = "";
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") safeUrl = parsed.href;
      } catch (_) {}

      if (safeUrl) {
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.removeAttribute("aria-disabled");
        link.removeAttribute("tabindex");
      } else {
        link.removeAttribute("href");
        link.removeAttribute("target");
        link.removeAttribute("rel");
        link.setAttribute("aria-disabled", "true");
        link.tabIndex = -1;
      }
    });
  }

  applyFooterSocialLinks({});

  fetch("/api/site-settings", { credentials: "same-origin", cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      if (!data?.ok) return;
      applyFooterSocialLinks(data.socialLinks || {});
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