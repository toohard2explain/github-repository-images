(() => {
  const RESERVED = new Set(["settings", "orgs", "users", "marketplace", "topics", "sponsors", "notifications", "explore", "login", "pulls", "issues"]);
  const TTL = 7 * 24 * 60 * 60 * 1000;
  const BIG = 40;
  const GAP = 12;
  const EASE = "900ms cubic-bezier(.65,0,.35,1)";
  const BADGE_END = "translate(25px,14px) scale(.75)";
  const RING = "0 0 0 2px var(--bgColor-default,#fff)";
  const NO_RING = "0 0 0 0 var(--bgColor-default,#fff)";

  const animated = new Set();
  const animating = new Map();
  const ready = new Map();
  const pending = new Set();

  function repoFromUrl() {
    const [owner, repo] = location.pathname.split("/").filter(Boolean);
    if (!owner || !repo || RESERVED.has(owner)) return null;
    return { owner, repo };
  }

  function findAvatar(repo) {
    for (const img of document.querySelectorAll('img[class*="prc-Avatar-Avatar"], img.avatar')) {
      if (img.closest("nav, .Header, [data-idea-wrap]")) continue;
      const parent = img.parentElement;
      if (parent && parent.textContent.trim().startsWith(repo) && img.width <= 40) return img;
    }
    return null;
  }

  // The enlarged icon overflows below the title row; forks have the "forked from" line right there
  const FORK_SPACE = "10px";
  function isFork(el) {
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      if (/forked from/i.test(n.textContent) && n.textContent.length < 400) return true;
    }
    return false;
  }

  function makeRoom(wrap, on) {
    const row = wrap.parentElement;
    if (!row || !isFork(wrap)) return;
    row.style.setProperty("margin-bottom", on ? FORK_SPACE : "0px");
  }

  // Wraps the avatar and keeps its original look until the animation starts
  function reserve(img, final = false) {
    const wrap = document.createElement("span");
    wrap.dataset.ideaWrap = "1";
    wrap.style.cssText =
      `position:relative;display:inline-block;flex-shrink:0;width:${final ? BIG : 24}px;height:24px;margin-right:${final ? GAP : 8}px`;

    const style = getComputedStyle(img);
    const radius = final ? "50%" : style.borderRadius || "0px";
    const shadow = final ? RING : style.boxShadow !== "none" ? style.boxShadow : NO_RING;

    img.replaceWith(wrap);
    img.style.cssText +=
      `;position:absolute!important;left:0;top:0;margin:0!important;z-index:2;` +
      `border-radius:${radius}!important;box-shadow:${shadow}!important;will-change:transform`;
    wrap.append(img);
    if (final) makeRoom(wrap, true);
    return { wrap, key: "" };
  }

  function makeIcon(url) {
    const icon = new Image();
    icon.src = url;
    Object.assign(icon.style, {
      position: "absolute", left: "0", top: "-8px", width: BIG + "px", height: BIG + "px",
      objectFit: "contain", borderRadius: "8px",
      boxShadow: "0 0 0 1px var(--avatar-borderColor, var(--borderColor-default, #d1d9e0))",
      background: "var(--bgColor-default, #fff)", willChange: "transform, opacity"
    });
    return icon;
  }

  function setEndState(r, img) {
    r.wrap.style.width = BIG + "px";
    r.wrap.style.marginRight = GAP + "px";
    makeRoom(r.wrap, true);
    img.style.transform = BADGE_END;
    img.style.setProperty("box-shadow", RING, "important");
    img.style.setProperty("border-radius", "50%", "important");
  }

  function morph(r, img, icon, animate) {
    r.wrap.prepend(icon);
    if (!animate) {
      ready.set(r.key, icon.src);
      setEndState(r, img);
      return;
    }

    icon.style.opacity = "0";
    icon.style.transform = "scale(.6)";
    // force a layout so the transitions have a start value
    void r.wrap.offsetWidth;
    void img.offsetWidth;
    void icon.offsetWidth;

    const token = { wrap: r.wrap, icon };
    animating.set(r.key, token);
    setTimeout(() => {
      if (animating.get(r.key) !== token) return;
      animating.delete(r.key);
      ready.set(r.key, icon.src);
      apply();
    }, 1000);

    r.wrap.style.transition = `width ${EASE}, margin-right ${EASE}`;
    if (r.wrap.parentElement) r.wrap.parentElement.style.transition = `margin-bottom ${EASE}`;
    icon.style.transition = `transform ${EASE}, opacity ${EASE}`;
    img.style.transition = `transform ${EASE}, border-radius ${EASE}, box-shadow ${EASE}`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      icon.style.opacity = "1";
      icon.style.transform = "none";
      setEndState(r, img);
    }));
  }

  async function cachedIcon(key) {
    const k = `icon:${key}`.toLowerCase();
    const entry = (await chrome.storage.local.get(k))[k];
    return entry && Date.now() - entry.t < TTL ? entry : null;
  }

  async function apply() {
    const info = repoFromUrl();
    if (!info) return;
    const key = `${info.owner}/${info.repo}`;
    const img = findAvatar(info.repo);
    if (!img) return;

    if (animating.has(key)) {
      const current = animating.get(key);
      if (current.wrap.isConnected) return;
      // GitHub re-rendered (e.g. hydration after a reload) and dropped our wrapper, so restart on the new avatar
      animating.delete(key);
      const r = reserve(img);
      r.key = key;
      morph(r, img, current.icon, true);
      return;
    }

    // GitHub brought the original avatar back: restore synchronously to avoid flicker
    if (ready.has(key)) {
      const r = reserve(img, true);
      r.wrap.prepend(makeIcon(ready.get(key)));
      img.style.transform = BADGE_END;
      return;
    }

    if (pending.has(key)) return;
    pending.add(key);
    try {
      const cached = await cachedIcon(key);
      if (cached && cached.url === null) return;
      if (!img.isConnected) return;

      const url = cached ? cached.url : await chrome.runtime.sendMessage({ type: "icon", ...info });
      if (!url) return;

      // don't touch the page until the icon is fully loaded
      const icon = makeIcon(url);
      try { await icon.decode(); } catch { return; }

      const now = repoFromUrl();
      if (!now || `${now.owner}/${now.repo}` !== key) return;
      const target = img.isConnected ? img : findAvatar(info.repo);
      if (!target) return;

      const first = !animated.has(key);
      animated.add(key);
      const r = reserve(target);
      r.key = key;
      morph(r, target, icon, first);
    } finally {
      pending.delete(key);
    }
  }

  let lastRepo = null;
  function onNav() {
    const info = repoFromUrl();
    const key = info && `${info.owner}/${info.repo}`;
    if (key !== lastRepo) {
      animated.clear();
      animating.clear();
      ready.clear();
      lastRepo = key;
    }
    apply();
  }

  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("turbo:render", onNav);
  onNav();
})();
