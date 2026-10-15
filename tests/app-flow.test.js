import test from 'node:test';
import assert from 'node:assert/strict';
import {localDateKey, previousDay} from '../dates.js';

const ID1 = '12345678-1234-4abc-8def-1234567890ab';
const ID2 = 'abcdef12-3456-4abc-8def-abcdef123456';

class Node {
  constructor(tag = 'div') {this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.hidden = false; this.disabled = false; this.scrollTop = 0; this.textContent = '';}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = [...nodes];}
  addEventListener(type, handler) {this.listeners[type] = handler;}
  setAttribute(name,value) {this[name] = value;}
  click() {this.listeners.click?.();}
  focus() {}
  select() {}
}
async function until(predicate) {for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw new Error('Timed out waiting for UI');}

test('real UI flow: recognition is separate from queue, selected songs enqueue, downloads complete', async () => {
  const orig = {document:globalThis.document, chrome:globalThis.chrome, fetch:globalThis.fetch, setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout};
  try {
    const ids = ['links','import','collect','collect-today','stop-import','select-all','select-none','select-today','select-yesterday','date-summary','clear-found','found-count','count','found-empty','empty','found-list','rows','summary','start','pause','retry','clear','concurrency','add','selection-count','import-status','notice'];
    const nodes = Object.fromEntries(ids.map(id => [id,new Node()]));
    nodes.concurrency.value = '2';
    globalThis.document = {getElementById:id => nodes[id], createElement:tag => new Node(tag)};
    const storage = {queue:[], found:[], sourceTab:11};
    const records = new Map();
    const saved = [];
    globalThis.chrome = {
      storage:{local:{get:async keys => Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in storage).map(k=>[k,storage[k]])),set:async o => Object.assign(storage, structuredClone(o))}},
      tabs:{query:async()=>[{id:11,url:'https://suno.com/me'}]},
      scripting:{executeScript:async()=>[{result:[{url:`https://suno.com/song/${ID2}`,title:'Suno 网页标题',dateLabel:'Today'}]}]},
      downloads:{download:async opts=>{saved.push(opts);records.set(saved.length,{state:'in_progress',bytesReceived:0,totalBytes:100});return saved.length;},search:async({id})=> records.has(id)?[records.get(id)]:[],show:async()=>{}}
    };
    globalThis.fetch = async url => {
      const id = new URL(String(url)).searchParams.get('id') || ID2;
      return {ok:true,status:200,json:async()=>({song:{id,title:'track_10',media:{url:'https://audio.example.test/test.m4a'}}})};
    };
    let interval;
    globalThis.setInterval = handler => {interval = handler;return 1;};
    await import('../app.js?mockflow=1');
    nodes.links.value = `https://suno.com/song/${ID1}`;
    nodes.import.click();
    await until(()=>nodes['found-count'].textContent==1);
    assert.equal(nodes.count.textContent,0,'Recognition must not enqueue automatically');
    assert.equal(nodes['selection-count'].textContent,'已选 1');
    await until(()=>nodes['import-status'].textContent.includes('识别结束'));
    const workingFetch = globalThis.fetch;
    globalThis.fetch = async()=>{throw new Error('Parser unavailable: page collection must still work');};
    nodes.collect.click();
    await until(()=>nodes['found-count'].textContent==2);
    await until(()=>!nodes.collect.disabled);
    assert.match(nodes['import-status'].textContent,/收集结束/);
    globalThis.fetch = workingFetch;
    // Let the user correct an API-provided generic song title before downloading.
    assert.equal(storage.found.find(s=>s.id===ID2).dateKey,localDateKey());
    assert.equal(nodes['select-today'].textContent,'全选今天（1）');
    assert.equal(nodes['select-yesterday'].disabled,true);
    const firstRow = nodes['found-list'].children.flatMap(g=>g.children.slice(1)).find(r=>r.children[1].children[1].textContent===ID1);
    const edit = firstRow.children[2].children[0];
    edit.click();
    firstRow.children[1].children[0].value = '自定义歌名';
    edit.click();
    await until(()=>storage.found[0].title==='自定义歌名');
    nodes['select-today'].click();
    assert.equal(nodes['selection-count'].textContent,'已选 1','Today selection replaces other selected songs');
    nodes.add.click();
    await until(()=>storage.queue.length===1);
    assert.equal(storage.queue[0].id,ID2,'Only today is enqueued');
    nodes['select-all'].click();
    nodes.add.click();
    await until(()=>storage.queue.length===2);
    assert.equal(storage.queue.find(s=>s.id===ID2).title,'Suno 网页标题','DOM title overrides third party generic title');
    nodes.start.click();
    await until(()=>saved.length===2);
    assert.ok(saved.some(x=>x.filename==='SunoBatch/Suno 网页标题.m4a'));
    assert.ok(saved.some(x=>x.filename==='SunoBatch/自定义歌名.m4a'));
    assert.ok(saved.every(x=>!x.filename.includes(ID1)&&!x.filename.includes(ID2)));
    for(const rec of records.values()) {rec.state='complete';rec.bytesReceived=100;}
    interval();
    await until(()=>storage.queue.every(x=>x.state==='complete'));
    assert.equal(nodes.summary.textContent.includes('完成 2'),true);
    // The client's imported-song list has no 50-item cap (the service might still impose one).
    const many = Array.from({length:120}, (_,i)=>`https://suno.com/song/12345678-1234-4abc-8abc-${String(i+1).padStart(12,'0')}`);
    nodes.links.value = many.join('\n');
    nodes.import.click();
    await until(()=>storage.found.length===122);
    assert.equal(storage.queue.length,2,'Recognition must not silently enqueue the 120 new items');
    await until(()=>!nodes.import.disabled);
    // A repeat scan enriches an old unknown item without duplicating it or replacing a manual title.
    globalThis.chrome.scripting.executeScript = async()=>[{result:[{url:`https://suno.com/song/${ID1}`,title:'API 名称',dateLabel:'Yesterday'}]}];
    nodes.collect.click();
    await until(()=>storage.found.find(s=>s.id===ID1).dateKey===previousDay());
    await until(()=>!nodes.import.disabled);
    assert.equal(storage.found.length,122);
    assert.equal(storage.found.find(s=>s.id===ID1).title,'自定义歌名');
    nodes['select-all'].click();
    nodes['select-yesterday'].click();
    assert.equal(nodes['selection-count'].textContent,'已选 1');
    const checkedRows = nodes['found-list'].children.flatMap(g=>g.children.slice(1)).filter(r=>r.children[0].checked);
    assert.equal(checkedRows[0].children[1].children[1].textContent,ID1);
    // The auto-scan UI accumulates virtual snapshots while the parser is unavailable.
    const autoIDs=['11223344-1234-4abc-8abc-000000000001','11223344-1234-4abc-8abc-000000000002'];
    const yesterdayID='11223344-1234-4abc-8abc-000000000003';
    let position=0,restored=false;
    globalThis.fetch=async()=>{throw new Error('Auto collection must not request parser');};
    globalThis.setTimeout=(handler,ms,...args)=>orig.setTimeout(handler,ms===900?1:ms,...args);
    globalThis.chrome.scripting.executeScript=async({func,args})=>{
      if(func.name==='controlTodayScroll') {
        const action=args[0];
        if(action==='start'||action==='rewind')position=0;
        if(action==='advance')position=1;
        if(action==='restore')restored=true;
        return [{result:{phase:position?'boundary':'moving',position,height:1000}}];
      }
      return [{result:[{url:`https://suno.com/song/${autoIDs[position]}`,title:`自动扫描 ${position}`,dateLabel:'Today'},
        {url:`https://suno.com/song/${yesterdayID}`,title:'昨天不得混入',dateLabel:'Yesterday'}]}];
    };
    nodes['collect-today'].click();
    assert.equal(nodes.collect.disabled,true);
    assert.equal(nodes['stop-import'].textContent,'停止扫描');
    await until(()=>!nodes['collect-today'].disabled);
    assert.match(nodes['import-status'].textContent,/今天分组末尾/);
    assert.equal(restored,true);
    for(const id of autoIDs)assert.equal(storage.found.find(s=>s.id===id).dateKey,localDateKey());
    assert.equal(storage.found.some(s=>s.id===yesterdayID),false);
    nodes['select-today'].click();nodes.add.click();
    await until(()=>storage.queue.length===4);
    assert.deepEqual(storage.queue.slice(2).map(s=>s.id),autoIDs);
  } finally {Object.assign(globalThis,orig);}
});

