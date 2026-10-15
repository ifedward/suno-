export function scanWait(ms, signal) {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort',finish); resolve(); };
    const timer = setTimeout(finish,ms);
    if (signal?.aborted) finish(); else signal?.addEventListener('abort',finish,{once:true});
  });
}

// Each snapshot is consumed before scrolling, preserving rows recycled by Suno.
export async function runTodayScan({snapshot,scroll,ingest,onProgress = ()=>{},signal,wait = scanWait,maxSteps = 300}) {
  let steps = 0, stable = 0, last = '', reason = 'limit', state, started = false, pass = 1, failure;
  try {
    await scroll('start');
    started = true;
    for (; steps < maxSteps; steps++) {
      if (signal?.aborted) {reason='stopped';break;}
      await wait(900,signal);
      if (signal?.aborted) {reason='stopped';break;}
      // Validate the tab/page before ingesting any rows after a user navigation.
      state = await scroll('status');
      const count = await ingest(await snapshot());
      onProgress({steps:steps+1,count,pass});
      if (signal?.aborted) {reason='stopped';break;}
      const stamp = `${state.phase}:${state.position}:${state.height}:${count}`;
      stable = stamp === last ? stable+1 : 0; last = stamp;
      if (stable >= 4 && ['boundary','missing'].includes(state.phase)) {
        if (state.phase === 'boundary' && pass === 1) {
          // A second pass catches delayed rows that loaded after leaving the viewport.
          await scroll('rewind'); pass++; stable=0; last=''; continue;
        }
        reason = state.phase === 'missing' ? 'no-today' : 'boundary';break;
      }
      if (state.phase === 'moving') await scroll('advance');
    }
    return {reason,steps:steps+1};
  } catch (error) {failure=error;throw error;}
  finally {
    if (started) try {await scroll('restore');} catch (error) {if (!failure) throw error;}
  }
}

// Self-contained, executed in Chrome's isolated extension world. No API or cookies.
export function controlTodayScroll(action, token, root = document) {
  const slot = '__sunoBatchTodayScroll';
  const view = root.defaultView;
  const songSelector = 'a[href*="/song/"],a[href*="/s/"]';
  const headings = () => [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(h=>
    !h.closest('a,button,nav,aside,[role="row"],[class*="title"],[data-testid*="title"],[contenteditable="true"]'));
  const todayHeading = () => headings().find(h=>/^(today|今天|今日)$/i.test(h.textContent.trim()));
  const pageNumber = () => root.querySelector('[aria-label="Current page number"]')?.value || '';
  if (action === 'start') {
    if (view[slot] && Date.now()-view[slot].touched < 15000) throw new Error('页面已有扫描进行中；若刚关闭侧栏，请等待 15 秒再重试。');
    const anchor = todayHeading() || root.querySelector('[role="table"]') || root.querySelector(songSelector);
    if (!anchor) throw new Error('找不到歌曲列表，请打开有 Today 日期分组的 Suno 页面。');
    let container = anchor;
    while (container && !(container.clientHeight > 0 && container.scrollHeight > container.clientHeight+2 && /auto|scroll/.test(view.getComputedStyle(container).overflowY))) container = container.parentElement;
    container ||= root.scrollingElement;
    if (!container) throw new Error('无法定位歌曲列表的滚动区域。');
    view[slot] = {token,container,original:container.scrollTop,href:view.location.href,page:pageNumber(),touched:Date.now()};
    container.scrollTo({top:0,behavior:'instant'});
    return {phase:'moving'};
  }
  const session = view[slot];
  if (!session || session.token !== token) throw new Error('扫描会话已失效，请重新扫描。');
  session.touched=Date.now();
  if (action === 'restore') {
    if (session.href === view.location.href && session.page === pageNumber() && session.container.isConnected)
      session.container.scrollTo({top:session.original,behavior:'instant'});
    delete view[slot]; return {phase:'restored'};
  }
  if (session.href !== view.location.href || session.page !== pageNumber()) throw new Error('扫描时页面发生切换，已停止；已收集歌曲保留。');
  const container = session.container;
  if (!container.isConnected) throw new Error('歌曲列表已更新，请重新扫描。');
  if (action === 'rewind') {container.scrollTo({top:0,behavior:'instant'});return {phase:'moving'};}
  const heading = todayHeading();
  const result = {position:Math.round(container.scrollTop),height:container.scrollHeight};
  if (!heading || !container.contains(heading)) return {...result,phase:'missing'};
  let scope = heading.closest('section');
  if (!scope) {
    scope = heading.parentElement;
    while (scope && !scope.querySelector(songSelector)) scope = scope.parentElement;
  }
  if (!scope || !container.contains(scope)) return {...result,phase:'missing'};
  const viewportBottom = container === root.scrollingElement ? view.innerHeight : container.getBoundingClientRect().bottom;
  const after = headings().find(h=>h!==heading && scope.contains(h) && (heading.compareDocumentPosition(h)&4));
  const bottom = after ? after.getBoundingClientRect().top : scope.getBoundingClientRect().bottom;
  const atEnd = container.scrollTop+container.clientHeight >= container.scrollHeight-2;
  const boundary = bottom <= viewportBottom+2 || atEnd;
  const busy = scope.querySelector('[aria-busy="true"],[data-loading="true"]');
  const phase = boundary ? (busy?'waiting':'boundary') : 'moving';
  if (action === 'advance' && phase === 'moving') container.scrollTo({top:container.scrollTop+Math.max(120,container.clientHeight*.65),behavior:'instant'});
  return {...result,phase};
}
