import {parseInput, filename, cleanTitle, checkedSong, mediaURL, downloadState, isRetryable, retryDelay, eligible, CONCURRENCY, UUID} from './core.js';
import {DATE_HEADING_PATTERN, localDateKey, previousDay, dateFromHeading, validDateKey, songDateLabel, groupSongs} from './dates.js';
import {scanPageSongs} from './page-scan.js';
import {runTodayScan, controlTodayScroll} from './auto-scan.js';

const $ = id => document.getElementById(id);
const API = 'https://download.ai-suno.com';
const labels = {pending:'排队中', resolving:'解析音频', downloading:'下载中', complete:'已完成', error:'失败'};
let queue = [];
let found = [];
const selected = new Set();
const active = new Set();
let running = false;
let importing = false;
let scanning = false;
let stopScan = null;
let stopImport = null;
let editingId = null;
let checking = false;
let persists = Promise.resolve();

function persist() {
  // Order snapshots so a slow storage write cannot restore stale state.
  const snapshot = JSON.parse(JSON.stringify({queue, found}));
  persists = persists.catch(() => {}).then(() => chrome.storage.local.set(snapshot));
  return persists;
}
function notice(message) { $('notice').textContent = message; }
function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function foundRow(item) {
  const row = element('div', 'song');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selected.has(item.id);
  checkbox.setAttribute('aria-label', `选择 ${item.title}`);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.add(item.id); else selected.delete(item.id);
    updateSelected();
  });
  const details = element('div', 'song-details');
  details.append(element('div','song-name',item.title), element('div','subtext',item.id));
  const actions = element('div','side-actions');
  const edit = element('button','secondary','改名');
  edit.setAttribute('aria-label', `修改歌曲名称：${item.title}`);
  edit.addEventListener('click', () => {
    editingId = item.id;
    const input = document.createElement('input');
    input.className = 'title-edit'; input.value = item.title;
    input.maxLength = 160;
    input.setAttribute('aria-label', '歌曲文件名');
    details.replaceChildren(input);
    edit.textContent = '保存';
    const commit = () => {
      if (!input.value.trim()) {notice('歌曲名称不能为空。');return;}
      editingId = null;
      item.title = cleanTitle(input.value);
      item.titleSource = 'manual';
      const queued = queue.find(q => q.id === item.id);
      if (queued && ['pending','error'].includes(queued.state)) queued.title = item.title;
      void persist(); render();
    };
    edit.addEventListener('click', commit, {once:true});
    input.addEventListener('keydown', event => {if(event.key==='Enter') commit();});
    input.focus(); input.select();
  }, {once:true});
  actions.append(edit);
  row.append(checkbox, details, actions);
  if (queue.some(q => q.id === item.id)) row.append(element('span','added','已在队列'));
  return row;
}
function queueRow(item) {
  const row = element('div','song');
  const details = element('div','song-details');
  details.append(element('div','song-name',item.title));
  const text = element('div','status ' + (item.state || ''), item.error || labels[item.state] || '未知状态');
  details.append(text);
  if (item.state === 'downloading') {
    const progress = document.createElement('progress');
    if (item.total > 0) {progress.max = item.total; progress.value = Math.min(item.received || 0, item.total);}
    progress.setAttribute('aria-label', '下载进度');
    details.append(progress);
  }
  const actions = element('div','side-actions');
  if (item.state === 'error') {
    const retry = element('button','secondary','重试');
    retry.addEventListener('click', () => {resetFailed(item); void persist(); render();});
    actions.append(retry);
  }
  if (item.state === 'complete' && Number.isInteger(item.downloadId)) {
    const show = element('button','secondary','文件位置');
    show.addEventListener('click', () => void chrome.downloads.show(item.downloadId).catch(e => notice(e.message)));
    actions.append(show);
  }
  row.append(details, actions);
  return row;
}
function updateSelected() {
  $('selection-count').textContent = `已选 ${selected.size}`;
  $('add').disabled = !selected.size;
}
function renderFound() {
  return groupSongs(found).map(([key,songs]) => {
    const group = element('div','date-group');
    group.append(element('h3','date-heading',`${songDateLabel(key)}（${songs.length} 首）`), ...songs.map(foundRow));
    return group;
  });
}
function selectDay(key, label) {
  if (importing || scanning || editingId) return;
  selected.clear();
  for (const song of found) if (song.dateKey === key) selected.add(song.id);
  render();
  notice(`已仅选中${label}的 ${selected.size} 首歌曲，请点击“加入队列”。`);
}
function render() {
  $('found-count').textContent = found.length;
  $('count').textContent = queue.length;
  $('found-empty').hidden = found.length > 0;
  $('empty').hidden = queue.length > 0;
  const fList = $('found-list'); const fScroll = fList.scrollTop;
  if (!editingId) { fList.replaceChildren(...renderFound()); fList.scrollTop = fScroll; }
  const today = found.filter(s=>s.dateKey===localDateKey()).length;
  const yesterday = found.filter(s=>s.dateKey===previousDay()).length;
  const unknown = found.filter(s=>!validDateKey(s.dateKey)).length;
  $('select-today').textContent = `全选今天（${today}）`;
  $('select-yesterday').textContent = `全选昨天（${yesterday}）`;
  $('select-today').disabled = importing || scanning || !!editingId || !today;
  $('select-yesterday').disabled = importing || scanning || !!editingId || !yesterday;
  $('date-summary').textContent = found.length ? `今天 ${today} · 昨天 ${yesterday} · 其他日期 ${found.length-today-yesterday-unknown} · 日期未知 ${unknown}` : '';
  const qList = $('rows'); const qScroll = qList.scrollTop;
  qList.replaceChildren(...queue.map(queueRow)); qList.scrollTop = qScroll;
  $('summary').textContent = `${running?'进行中':'已暂停'} · 完成 ${queue.filter(x => x.state === 'complete').length} · 失败 ${queue.filter(x => x.state === 'error').length} · 等待 ${queue.filter(x => x.state === 'pending').length}`;
  $('start').disabled = running;
  $('pause').disabled = !running;
  $('import').disabled = importing || scanning;
  $('collect').disabled = importing || scanning;
  $('collect-today').disabled = importing || scanning || !!editingId;
  $('stop-import').hidden = !importing && !scanning;
  $('stop-import').textContent = scanning ? '停止扫描' : '停止识别';
  updateSelected();
}

async function request(route, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('请求超时','TimeoutError')), 45000);
  const cancel = () => controller.abort(signal.reason || new DOMException('已停止识别','AbortError'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, {once:true});
  try {
    const response = await fetch(API + route, {cache:'no-store', credentials:'omit', signal:controller.signal});
    // Preserve HTTP status even if a 429 / 5xx response is HTML or empty.
    let data = null;
    try {data = await response.json();} catch { /* handled below */ }
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : `解析失败 HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (!data || typeof data !== 'object') throw new Error('解析服务未返回有效 JSON 数据');
    return data;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}
async function parseSource(source, signal) {
  if (source.kind === 'playlist') {
    const data = await request('/api/playlist?url=' + encodeURIComponent(source.value), signal);
    if (!Array.isArray(data.playlist?.songs)) throw new Error('歌单数据无效');
    const songs = data.playlist.songs.map(checkedSong);
    return {songs, total: Number(data.playlist.total) || songs.length};
  }
  const data = await request('/api/song?id=' + encodeURIComponent(source.value), signal);
  return {songs:[checkedSong(data.song)], total:1};
}
function receiveSong(s, sourceTitle, sourceDate) {
  const title = sourceTitle ? cleanTitle(sourceTitle) : s.title;
  const existing = found.find(x => x.id === s.id);
  if (existing) {
    if (validDateKey(sourceDate)) existing.dateKey = sourceDate;
    // The Suno page's displayed title is preferred to the third-party title.
    if (sourceTitle && !['page','manual'].includes(existing.titleSource)) {existing.title = title; existing.titleSource = 'page';
      const queued = queue.find(q => q.id === s.id); if (queued && ['pending','error'].includes(queued.state)) queued.title = title;}
    return false;
  }
  found.push({id:s.id, title, titleSource:sourceTitle?'page':'api', dateKey:validDateKey(sourceDate)});
  selected.add(s.id);
  return true;
}
async function importSources(lines) {
  if (importing || scanning) return;
  importing = true;
  stopImport = new AbortController();
  let added = 0;
  let processed = 0;
  let truncated = 0;
  const errors = [];
  const sources = new Map();
  for (const input of lines) {
    const line = typeof input === 'string' ? input : input.url;
    if (!line?.trim()) continue;
    const parsed = parseInput(line);
    if (!parsed) {if (errors.length < 6) errors.push('输入无效：' + line.slice(0,60)); continue;}
    const key = parsed.kind + ':' + parsed.value;
    if (!sources.has(key)) sources.set(key, {...parsed, uiTitle:typeof input === 'string'?'':input.title || '',
      dateKey:typeof input === 'string'?'':validDateKey(input.dateKey)});
  }
  render();
  try {
    for (const source of sources.values()) {
      if (stopImport.signal.aborted) break;
      $('import-status').textContent = `识别中 ${processed + 1}/${sources.size} · 新增 ${added} 首`;
      try {
        const result = await parseSource(source, stopImport.signal);
        for (const s of result.songs) if (receiveSong(s,source.kind==='song'?source.uiTitle:'',source.kind==='song'?source.dateKey:'')) added++;
        if (result.total > result.songs.length) truncated++;
      } catch (error) {
        if (stopImport.signal.aborted) break;
        if (errors.length < 6) errors.push(source.value.slice(0,30) + '：' + error.message);
        if (error.status === 429) {errors.push('第三方解析服务触发 429 限流，请稍后继续剩余链接'); break;}
      }
      processed++;
      await persist();
      render();
    }
    const stopped = stopImport.signal.aborted;
    $('import-status').textContent = `${stopped?'已停止':'识别结束'} · 已处理 ${processed}/${sources.size} 个输入 · 本次新增 ${added} 首`;
    notice((truncated?`有 ${truncated} 个歌单返回不完整：第三方接口可能只给前 50 首，可从 Suno 页面继续分次收集。`:'') +
      (errors.length?` ${errors.join('；')}`:''));
  } finally {
    importing = false;
    stopImport = null;
    await persist();
    render();
  }
}

async function sourceTabId() {
    const {sourceTab} = await chrome.storage.local.get('sourceTab');
    if (!Number.isInteger(sourceTab)) throw new Error('请先在 Suno 页面点击扩展图标。');
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    if (tab?.id !== sourceTab || !/^https:\/\/(www\.)?suno\.com\//.test(tab.url || ''))
      throw new Error('请切回已授权的 Suno 页面，再点击扩展图标。');
    return sourceTab;
}

function receivePageSongs(songs, scannedAt, onlyToday = false) {
  let added = 0, unresolved = 0;
  for (const song of songs) {
    const dateKey = dateFromHeading(song.dateLabel,scannedAt);
    if (onlyToday && dateKey !== localDateKey(scannedAt)) continue;
    const parsed = parseInput(song.url);
    // The UUID and displayed title already identify a page song. Resolve audio only on download.
    if (parsed?.kind === 'song' && UUID.test(parsed.value)) {
      if (receiveSong({id:parsed.value,title:cleanTitle(song.title)},song.title,dateKey)) added++;
    } else unresolved++;
  }
  return {added,unresolved};
}

async function collect() {
  if (importing || scanning) return;
  importing = true; render();
  stopImport = new AbortController();
  try {
    const sourceTab = await sourceTabId();
    const scannedAt = new Date();
    const results = await chrome.scripting.executeScript({target:{tabId:sourceTab}, func:scanPageSongs, args:[DATE_HEADING_PATTERN.source]});
    const songs = results[0]?.result || [];
    if (!songs.length) {notice('当前页面没有发现歌曲链接。请滚动页面加载更多歌曲后重试。'); return;}
    let {added} = receivePageSongs(songs,scannedAt);
    const errors = [];
    for (const song of songs) {
      const source = parseInput(song.url);
      if (stopImport.signal.aborted) break;
      if (source?.kind !== 'song' || UUID.test(source.value)) continue;
      try {
        const result = await parseSource(source,stopImport.signal);
        for (const item of result.songs) if (receiveSong(item,song.title,dateFromHeading(song.dateLabel,scannedAt))) added++;
      } catch (error) {if (!stopImport.signal.aborted && errors.length<3) errors.push(error.message);}
    }
    await persist();
    $('import-status').textContent = `${stopImport.signal.aborted?'收集已停止':'收集结束'} · 本次新增 ${added} 首 · 共 ${found.length} 首`;
    notice(`已收集当前加载的歌曲。滑动后需再次点击“收集当前页面”，或使用“自动扫描今天”。${errors.length?' 部分短链接解析失败：'+errors.join('；'):''}`);
  } catch (e) {notice('收集失败：' + e.message);}
  finally {importing = false;stopImport=null;render();}
}

async function collectToday() {
  if (importing || scanning || editingId) return;
  scanning = true; stopScan = new AbortController(); render();
  const scannedAt = new Date();
  const token = crypto.randomUUID();
  const scanned = new Set();
  try {
    const tabId = await sourceTabId();
    notice('正在自动滚动歌曲列表。请保持侧栏打开，扫描期间不要切换页面或翻页。');
    const result = await runTodayScan({
      signal:stopScan.signal,
      scroll:async action => {
        const results = await chrome.scripting.executeScript({target:{tabId},func:controlTodayScroll,args:[action,token]});
        return results[0]?.result;
      },
      snapshot:async()=>{
        if (localDateKey()!==localDateKey(scannedAt)) throw new Error('已跨过午夜，请刷新 Suno 页面后重新扫描。');
        const results = await chrome.scripting.executeScript({target:{tabId},func:scanPageSongs,args:[DATE_HEADING_PATTERN.source]});
        return results[0]?.result || [];
      },
      ingest:async songs => {
        for (const song of songs) if (dateFromHeading(song.dateLabel,scannedAt)===localDateKey(scannedAt)) {
          const parsed = parseInput(song.url);
          if (parsed?.kind==='song' && UUID.test(parsed.value)) scanned.add(parsed.value);
        }
        receivePageSongs(songs,scannedAt,true);
        await persist();render();return scanned.size;
      },
      onProgress:({pass,count})=>{ $('import-status').textContent=`自动扫描第 ${pass} 遍 · 今天已收集 ${count} 首`; }
    });
    const messages = {
      boundary:'已到当前页今天分组末尾',stopped:'扫描已停止',
      'no-today':'未找到可识别的 Today / 今天分组',limit:'达到扫描上限，可能尚未收集完整'
    };
    $('import-status').textContent = `${messages[result.reason]} · 本次今天收集 ${scanned.size} 首`;
    notice(`${messages[result.reason]}。已收集结果保留，请点击“全选今天”再加入队列。若今天还有下一页，请翻页后再次扫描。`);
  } catch (error) {notice('扫描未完成：'+error.message+' 已收集结果保留，可重新扫描。');}
  finally {scanning = false;stopScan=null;await persist();render();}
}

function resetFailed(item) {
  if (item.state !== 'error') return;
  item.state = 'pending'; item.error = ''; item.attempts = 0; item.nextAttempt = 0;
  delete item.downloadId; delete item.received; delete item.total;
}
async function launch(item) {
  active.add(item.id);
  item.state = 'resolving'; item.error = ''; item.attempts = (item.attempts || 0) + 1;
  try {
    await persist(); render();
    const data = await request('/api/song?id=' + encodeURIComponent(item.id));
    const song = checkedSong(data.song);
    if (song.id !== item.id) throw new Error('解析服务返回的歌曲 ID 不匹配');
    // Keep the catalog or Suno UI title; don't replace it with a possibly generic API title.
    const url = mediaURL(data.song);
    const downloadId = await chrome.downloads.download({url, filename:filename(item), saveAs:false, conflictAction:'uniquify'});
    if (!Number.isInteger(downloadId)) throw new Error('浏览器未返回有效的下载编号');
    item.downloadId = downloadId;
    item.state = 'downloading'; item.received = 0; item.total = 0;
  } catch (e) {
    if (e.status === 429) {running = false; notice('第三方服务限流（429），队列已暂停；稍后再开始。');}
    if (isRetryable(e) && item.attempts < 3) {
      item.state = 'pending'; item.nextAttempt = Date.now() + retryDelay(item.attempts); item.error = '';
    } else {item.state = 'error'; item.error = e.message;}
  } finally {
    active.delete(item.id);
    await persist(); render();
  }
}

async function tick() {
  if (checking) return;
  checking = true;
  try {
    let changed = false;
    for (const item of queue.filter(x => x.state === 'downloading')) {
      if (!Number.isInteger(item.downloadId)) {
        item.state = 'error'; item.error = '下载编号丢失，请重试'; changed = true; continue;
      }
      const [record] = await chrome.downloads.search({id:item.downloadId});
      const next = downloadState(item, record);
      if (next.state !== item.state) changed = true;
      Object.assign(item,next);
    }
    if (changed) await persist();
    if (running) {
      const limit = CONCURRENCY.includes(Number($('concurrency').value)) ? Number($('concurrency').value) : 2;
      let count = active.size + queue.filter(x => x.state === 'downloading').length;
      for (const item of queue) {
        if (count >= limit) break;
        if (eligible(item) && !active.has(item.id)) {
          count++;
          void launch(item).catch(e => {running = false; notice('下载调度错误：' + e.message);});
        }
      }
      if (!active.size && !queue.some(x => ['pending','resolving','downloading'].includes(x.state))) running = false;
    }
    render();
  } catch (e) {running = false; notice('无法读取浏览器下载状态：' + e.message);}
  finally {checking = false;}
}

$('import').addEventListener('click', () => void importSources($('links').value.split(/\r?\n/)));
$('collect').addEventListener('click', () => void collect());
$('collect-today').addEventListener('click', () => void collectToday());
$('stop-import').addEventListener('click', () => {stopImport?.abort(new DOMException('用户停止','AbortError'));stopScan?.abort();});
$('select-all').addEventListener('click', () => {for (const x of found) selected.add(x.id); render();});
$('select-none').addEventListener('click', () => {selected.clear(); render();});
$('select-today').addEventListener('click', () => selectDay(localDateKey(),'今天'));
$('select-yesterday').addEventListener('click', () => selectDay(previousDay(),'昨天'));
$('clear-found').addEventListener('click', () => {
  if (importing || scanning) return notice('请先停止识别或扫描再清空。');
  found = []; selected.clear(); void persist(); render();
});
$('add').addEventListener('click', () => {
  let added = 0;
  for (const s of found) {
    if (selected.has(s.id) && !queue.some(q => q.id === s.id)) {
      queue.push({id:s.id,title:s.title,state:'pending',attempts:0,error:''}); added++;
    }
  }
  selected.clear();
  void persist(); render(); notice(`已加入 ${added} 首到下载队列。`);
});
$('start').addEventListener('click', () => {running = true; notice('下载已开始；请保持侧栏打开直到所有任务派发。'); void tick(); render();});
$('pause').addEventListener('click', () => {running = false; render();});
$('retry').addEventListener('click', () => {for (const item of queue) resetFailed(item); void persist(); render();});
$('clear').addEventListener('click', () => {queue = queue.filter(x => x.state !== 'complete'); void persist(); render();});
$('concurrency').addEventListener('change', () => {
  const value = Number($('concurrency').value);
  if (CONCURRENCY.includes(value)) void chrome.storage.local.set({concurrency:value});
});

// On reopen, previously dispatched downloads are reconciled against the browser's own record.
try {
  const stored = await chrome.storage.local.get(['queue','found','concurrency']);
  queue = Array.isArray(stored.queue) ? stored.queue.filter(s => UUID.test(s?.id) && typeof s.title === 'string') : [];
  found = Array.isArray(stored.found) ? stored.found.filter(s => UUID.test(s?.id) && typeof s.title === 'string') : [];
  for (const song of found) song.dateKey = validDateKey(song.dateKey);
  for (const item of queue) {
    item.title = cleanTitle(item.title);
    if (item.state === 'resolving') item.state = Number.isInteger(item.downloadId) ? 'downloading' : 'pending';
    if (item.state === 'downloading' && !Number.isInteger(item.downloadId)) {
      item.state = 'error'; item.error = '上次启动时未保存下载编号，请确认下载目录后重试';
    }
  }
  if (CONCURRENCY.includes(stored.concurrency)) $('concurrency').value = String(stored.concurrency);
  await tick();
  render();
  setInterval(() => void tick(), 1200);
} catch (e) {notice('无法恢复下载清单：' + e.message);}

