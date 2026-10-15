// Self-contained: Chrome serializes this function into the authorized Suno tab.
export function scanPageSongs(datePattern, root = document) {
  const songSelector = 'a[href*="/song/"], a[href*="/s/"]';
  const rowSelector = 'article, li, [role="row"], [data-testid*="song"], [class*="song-card"]';
  const links = [...root.querySelectorAll(songSelector)];
  const pattern = new RegExp(datePattern,'i');
  const markers = [];
  for (const node of root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],div,span,p,time')) {
    const label = (node.textContent || '').replace(/\s+/g,' ').trim();
    const heading = /^H[1-6]$/.test(node.tagName) || node.getAttribute('role') === 'heading';
    const barrier = /^(last week|last month|earlier|older|previous|上周|上个月|更早)$/i.test(label);
    if (!label || label.length > 60 || (!pattern.test(label) && !heading && !barrier)) continue;
    if (node.closest('a,button,nav,aside,[role="navigation"]') || node.querySelector(songSelector)) continue;
    const row = node.closest(rowSelector);
    if (row?.querySelector(songSelector)) continue; // A song can itself be named Today or Monday.
    if (node.closest('[data-testid*="title"], [class*="title"]')) continue;
    if ([...node.children].some(child=>(child.textContent || '').replace(/\s+/g,' ').trim()===label)) continue;
    // Scope a heading to the nearest song-list container, preventing dates from
    // leaking into a different playlist, sidebar, or recommendation section.
    let scope = node.parentElement;
    while (scope && !scope.querySelector(songSelector)) scope = scope.parentElement;
    if (scope && scope !== root.body && scope !== root.documentElement) markers.push({node,scope,label});
  }
  const titleOf = a => {
    const wrapper = a.closest(rowSelector);
    const raw = wrapper?.querySelector('[data-testid*="title"], [class*="title"]')?.textContent ||
      a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '';
    const title = raw.replace(/\s+/g,' ').trim();
    return title && title.length <= 160 && !/^(play|pause|播放|暂停|song)$/i.test(title) ? title : '';
  };
  const map = new Map();
  for (const a of links) {
    let dateLabel = '';
    for (const marker of markers) {
      if (marker.scope.contains(a) && (marker.node.compareDocumentPosition(a) & 4)) dateLabel = marker.label;
    }
    const item = {url:a.href,title:titleOf(a),dateLabel};
    const existing = map.get(item.url);
    if (!existing) map.set(item.url,item);
    else {if (!existing.title) existing.title = item.title; if (!existing.dateLabel) existing.dateLabel = dateLabel;}
  }
  return [...map.values()];
}
