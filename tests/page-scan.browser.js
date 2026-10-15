import {scanPageSongs} from '../page-scan.js';
import {DATE_HEADING_PATTERN} from '../dates.js';

const output = [];
const song = (id,title='Test')=>`<div role="row"><a href="https://suno.com/song/${id}">${title}</a></div>`;
function check(name,html,expected) {
  const doc = new DOMParser().parseFromString(html,'text/html');
  const actual = scanPageSongs(DATE_HEADING_PATTERN.source,doc).map(s=>[s.url.split('/').pop(),s.title,s.dateLabel]);
  if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(`${name}\n实际 ${JSON.stringify(actual)}\n期望 ${JSON.stringify(expected)}`);
  output.push(`通过：${name}`);
}
try {
  check('Suno section / h3 分组，包括名为 Today 的歌曲',
    `<main><div role="table"><div role="rowgroup"><section><h3>Today</h3>${song('a','Today')}${song('b','B')}</section><section><h3>Monday</h3>${song('c','C')}</section></div></div></main>`,
    [['a','Today','Today'],['b','B','Today'],['c','C','Monday']]);
  check('同容器内的 Today / Yesterday / 未支持日期标题',
    `<main><div><h3>Today</h3>${song('a')}<h3>Yesterday</h3>${song('b')}<h3>Last week</h3>${song('c')}</div></main>`,
    [['a','Test','Today'],['b','Test','Yesterday'],['c','Test','Last week']]);
  check('中文标题、嵌套标签、重复链接去重',
    `<main><section><h3><span>今天</span></h3>${song('a')}${song('a')}<h3>昨天</h3>${song('b')}</section></main>`,
    [['a','Test','今天'],['b','Test','昨天']]);
  check('日期不泄漏到独立列表或侧栏',
    `<aside><h3>Today</h3></aside><main><section><h3>Yesterday</h3>${song('a')}</section><section>${song('b')}</section></main>`,
    [['a','Test','Yesterday'],['b','Test','']]);
  check('歌曲标题不会作为日期标题',
    `<main><section><div role="row"><h3 class="clip-title">Today</h3><a href="https://suno.com/song/a">Today</a></div>${song('b','Monday')}</section></main>`,
    [['a','Today',''],['b','Monday','']]);
  check('没有分组时保持日期未知',`<main>${song('a')}</main>`,[['a','Test','']]);
  document.getElementById('results').textContent = `${output.join('\n')}\n\n全部 ${output.length} 项通过`;
} catch (error) {
  document.getElementById('results').textContent = `${output.join('\n')}\n失败：${error.message}`;
  console.error(error);
}
