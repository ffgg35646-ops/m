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
  fetch("/api/site-settings", { credentials: "same-origin", cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const name = String(data?.organization?.name || "").trim();
      if (!data?.ok || !name || name === OLD_NAME) return;
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