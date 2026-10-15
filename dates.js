// Dates use the browser's local calendar; stored keys do not change after midnight.
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
export const DATE_HEADING_PATTERN = /^(?:today|yesterday|今天|今日|昨天|昨日|(?:last\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:星期|周)[日天一二三四五六]|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日?|\d{1,2}月\d{1,2}日?|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:,?\s+\d{4})?)$/i;

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(year,month-1,day,12);
  return localDateKey(date) === value ? value : '';
}
export function previousDay(now = new Date()) {
  const date = new Date(now); date.setDate(date.getDate()-1);
  return localDateKey(date);
}
export function dateFromHeading(value, now = new Date()) {
  const label = String(value || '').replace(/\s+/g,' ').trim().toLowerCase();
  if (!DATE_HEADING_PATTERN.test(label)) return '';
  const date = new Date(now); date.setHours(12,0,0,0);
  if (/^(today|今天|今日)$/.test(label)) return localDateKey(date);
  if (/^(yesterday|昨天|昨日)$/.test(label)) return previousDay(date);
  const weekday = WEEKDAYS.indexOf(label.replace(/^last\s+/,''));
  const chinese = /^(?:星期|周)([日天一二三四五六])$/.exec(label);
  if (weekday >= 0 || chinese) {
    const day = weekday >= 0 ? weekday : '日一二三四五六'.indexOf(chinese[1].replace('天','日'));
    // Suno uses Today for today, so a weekday refers to the preceding occurrence.
    date.setDate(date.getDate() - ((date.getDay()-day+7)%7 || 7));
    return localDateKey(date);
  }
  let year,month,day;
  const numeric = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(label);
  const chineseDate = /^(\d{1,2})月(\d{1,2})日?$/.exec(label);
  const english = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(label);
  if (numeric) [,year,month,day] = numeric.map(Number);
  else if (chineseDate) {month = Number(chineseDate[1]); day = Number(chineseDate[2]);}
  else if (english) {
    month = MONTHS.findIndex(m=>m.startsWith(english[1].slice(0,3)))+1;
    day = Number(english[2]); year = english[3] ? Number(english[3]) : undefined;
  } else return '';
  const hasYear = year !== undefined;
  year ??= date.getFullYear();
  if (!hasYear && (month > date.getMonth()+1 || (month === date.getMonth()+1 && day > date.getDate()))) year--;
  const result = new Date(year,month-1,day,12);
  if (result.getFullYear() !== year || result.getMonth() !== month-1 || result.getDate() !== day) return '';
  return validDateKey(localDateKey(result));
}
export function songDateLabel(key, now = new Date()) {
  key = validDateKey(key);
  if (!key) return '日期未知';
  if (key === localDateKey(now)) return `今天 · ${key}`;
  if (key === previousDay(now)) return `昨天 · ${key}`;
  return key;
}
export function groupSongs(songs) {
  const groups = new Map();
  for (const song of songs) {
    const key = validDateKey(song.dateKey);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(song);
  }
  return [...groups].sort(([a],[b])=>b.localeCompare(a));
}
