import {controlTodayScroll,runTodayScan,scanWait} from '../auto-scan.js';
import {scanPageSongs} from '../page-scan.js';
import {DATE_HEADING_PATTERN} from '../dates.js';
const $=id=>document.getElementById(id);
const frame=$('fixture');let abort;
frame.srcdoc=`<!doctype html><style>body{margin:0;font:15px sans-serif}#list{height:240px;overflow-y:auto}h3{margin:0;height:30px}.row{height:110px;box-sizing:border-box;padding:20px;border-bottom:1px solid #ccc}</style><div id="list" role="table"><section><h3>Today</h3>${Array.from({length:8},(_,i)=>`<div class="row" role="row" data-index="${i}">加载中</div>`).join('')}</section><section><h3>Yesterday</h3>${Array.from({length:2},(_,i)=>`<div class="row" role="row" data-index="${i+8}">加载中</div>`).join('')}</section></div>`;
frame.addEventListener('load',()=>{
  const doc=frame.contentDocument,list=doc.getElementById('list');
  let firstVisits=0,lastFirstVisible=false,timer;
  const update=()=>{
    const bounds=list.getBoundingClientRect();
    for(const row of doc.querySelectorAll('.row')) {
      const rect=row.getBoundingClientRect(),index=Number(row.dataset.index);
      const visible=rect.bottom>bounds.top&&rect.top<bounds.bottom;
      if(index===0){if(visible&&!lastFirstVisible)firstVisits++;lastFirstVisible=visible;}
      row.replaceChildren();
      if(visible&&(index!==0||firstVisits>=2)) {
        const link=doc.createElement('a');link.href=`https://suno.com/song/12345678-1234-4abc-8abc-${String(index+1).padStart(12,'0')}`;
        link.textContent=`${index<8?'今天':'昨天'}歌曲 ${index+1}`;row.append(link);
      }else row.textContent='未加载';
    }
  };
  list.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(update,60);});
  list.scrollTop=190;update();
  $('run').addEventListener('click',async()=>{
    $('run').disabled=true;$('stop').disabled=false;abort=new AbortController();
    const original=list.scrollTop,seen=new Set(),token=crypto.randomUUID();
    try {
      const result=await runTodayScan({signal:abort.signal,
        wait:(_ms,signal)=>scanWait(120,signal),
        scroll:async action=>controlTodayScroll(action,token,doc),
        snapshot:async()=>scanPageSongs(DATE_HEADING_PATTERN.source,doc),
        ingest:async songs=>{for(const song of songs)if(song.dateLabel==='Today')seen.add(song.url);return seen.size;},
        onProgress:({pass,count})=>{$('result').textContent=`第 ${pass} 遍 · 已收集 ${count}/8 首今天歌曲`;}
      });
      if(result.reason==='stopped'){$('result').textContent=`已停止，保留 ${seen.size} 首；滚动位置恢复：${list.scrollTop===original}`;return;}
      if(result.reason!=='boundary'||seen.size!==8||list.scrollTop!==original)throw new Error(`结果 ${result.reason}，收到 ${seen.size}/8，位置恢复 ${list.scrollTop===original}`);
      $('result').textContent='通过：8/8 首今天歌曲全部收集；昨天未混入；第二遍补收延迟歌曲；滚动位置已恢复。';
    }catch(error){$('result').textContent='失败：'+error.message;}
    finally{$('run').disabled=false;$('stop').disabled=true;}
  });
});
$('stop').addEventListener('click',()=>abort?.abort());
