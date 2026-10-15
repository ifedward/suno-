import test from 'node:test';
import assert from 'node:assert/strict';
import {runTodayScan,scanWait} from '../auto-scan.js';

test('captures recycled rows before scrolling and revisits delayed rows on a second pass',async()=>{
  const seen = new Set(),actions=[],events=[];
  let position=0,pass=1,boundaryWaits=0;
  const result=await runTodayScan({
    wait:async()=>{},
    scroll:async action=>{
      actions.push(action);
      if(action==='start') position=0;
      if(action==='rewind'){position=0;pass=2;}
      if(action==='advance') position++;
      if(action==='status')return {phase:position>=2?'boundary':'moving',position,height:800};
    },
    snapshot:async()=>{
      events.push(`snapshot:${pass}:${position}`);
      if(position===2)boundaryWaits++;
      // Only the current virtual row is present; another row loads on revisit.
      return [position===0?(pass===2?'delayed':'first'):position===1?'middle':'last'];
    },
    ingest:async rows=>{for(const row of rows)seen.add(row);return seen.size;}
  });
  assert.equal(result.reason,'boundary');
  assert.deepEqual([...seen],['first','middle','last','delayed']);
  assert.equal(actions.at(-1),'restore');
  assert.equal(actions.filter(a=>a==='rewind').length,1);
  assert.ok(boundaryWaits>=10,'Wait repeatedly for delayed rendering at each boundary');
  assert.ok(events.indexOf('snapshot:1:0')<events.indexOf('snapshot:1:1'));
});

test('stop preserves captured rows and restores scroll without advancing further',async()=>{
  const controller=new AbortController(),actions=[],seen=[];
  const result=await runTodayScan({signal:controller.signal,wait:async()=>{},
    scroll:async action=>{actions.push(action);return {phase:'moving',position:0,height:1000};},
    snapshot:async()=>['saved'],
    ingest:async rows=>{seen.push(...rows);controller.abort();return seen.length;}
  });
  assert.equal(result.reason,'stopped');assert.deepEqual(seen,['saved']);
  assert.equal(actions.at(-1),'restore');
  assert.equal(actions.includes('advance'),false);
});

test('navigation failure and bounded scans retain recovery information',async()=>{
  const actions=[];
  await assert.rejects(runTodayScan({wait:async()=>{},scroll:async action=>{actions.push(action);if(action==='status')throw new Error('page changed');},snapshot:async()=>[],ingest:async()=>0}),/page changed/);
  assert.equal(actions.at(-1),'restore');
  const result=await runTodayScan({maxSteps:3,wait:async()=>{},scroll:async()=>({phase:'waiting',position:0,height:1000}),snapshot:async()=>[],ingest:async()=>0});
  assert.equal(result.reason,'limit');
});

test('start failure is not masked by restoration and missing headings do not imply completion',async()=>{
  const actions=[];
  await assert.rejects(runTodayScan({scroll:async action=>{actions.push(action);throw new Error('no list');}}),/no list/);
  assert.deepEqual(actions,['start']);
  const result=await runTodayScan({wait:async()=>{},scroll:async()=>({phase:'missing',position:0,height:1000}),snapshot:async()=>[],ingest:async()=>0});
  assert.equal(result.reason,'no-today');
});

test('stopping interrupts the loading wait immediately',async()=>{
  const controller=new AbortController();
  const pending=scanWait(60000,controller.signal);controller.abort();
  await pending;
});
