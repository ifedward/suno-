import test from 'node:test';
import assert from 'node:assert/strict';
import {dateFromHeading, localDateKey, previousDay, validDateKey, groupSongs, songDateLabel} from '../dates.js';

test('relative headings and weekdays resolve to local dates, not scan-time timestamps', () => {
  const now = new Date(2026,9,15,1,30);
  for (const label of ['Today','今天','今日']) assert.equal(dateFromHeading(label,now),'2026-10-15');
  for (const label of ['Yesterday','昨天','昨日','Wednesday','星期三']) assert.equal(dateFromHeading(label,now),'2026-10-14');
  assert.equal(dateFromHeading('Monday',now),'2026-10-12');
  assert.equal(dateFromHeading('Thursday',now),'2026-10-08');
  assert.equal(dateFromHeading('周天',now),'2026-10-11');
});
test('calendar dates validate and yearless dates handle the year boundary', () => {
  const now = new Date(2026,0,1,0,15);
  assert.equal(previousDay(now),'2025-12-31');
  for (const label of ['December 31','Dec 31','12月31日']) assert.equal(dateFromHeading(label,now),'2025-12-31');
  for (const label of ['October 15, 2025','2025年10月15日','2025/10/15','2025-10-15']) assert.equal(dateFromHeading(label,now),'2025-10-15');
  for (const label of ['2026-02-30','2026-13-01','Last week','2:54','Today remix','']) assert.equal(dateFromHeading(label,now),'');
  assert.equal(validDateKey('2024-02-29'),'2024-02-29');
  assert.equal(validDateKey('2025-02-29'),'');
});
test('stored dates roll from today to yesterday and old data stays unknown', () => {
  const day1 = new Date(2026,9,15,23,59), day2 = new Date(2026,9,16,0,1);
  const key = localDateKey(day1);
  assert.equal(songDateLabel(key,day1),'今天 · 2026-10-15');
  assert.equal(songDateLabel(key,day2),'昨天 · 2026-10-15');
  assert.equal(songDateLabel(undefined,day2),'日期未知');
  assert.deepEqual(groupSongs([{id:'a'},{id:'b',dateKey:'2026-10-15'},{id:'c',dateKey:'2026-10-14'},{id:'d',dateKey:'invalid'}]).map(([k,s])=>[k,s.map(x=>x.id)]),[
    ['2026-10-15',['b']],['2026-10-14',['c']],['',['a','d']]
  ]);
});
