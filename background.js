const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function loadIcon(owner, repo) {
  const key = `icon:${owner}/${repo}`.toLowerCase();
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Date.now() - stored.t < TTL) return stored.url; 

  let url = null;
  try {
    const res = await fetch(`https://github.com/${owner}/${repo}/raw/HEAD/.idea/icon.svg`, {
      credentials: "include"
    });
    if (res.ok) {
      const text = await res.text();
      if (/<svg[\s>]/i.test(text)) {
        url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(text)));
      }
    } else if (res.status !== 404) {
      return stored?.url ?? null; 
    }
  } catch (e) {
    return stored?.url ?? null;
  }
  await chrome.storage.local.set({ [key]: { url, t: Date.now() } });
  return url;
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type === "icon") {
    loadIcon(msg.owner, msg.repo).then(send);
    return true;
  }
});
