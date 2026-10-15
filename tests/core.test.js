import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseInput, cleanTitle, filename, checkedSong, mediaURL, downloadState, retryDelay, isRetryable, eligible} from '../core.js';

const ID = '12345678-1234-4abc-8def-1234567890ab';

test('validates ID and accepted Suno links, rejects arbitrary hosts and credentials', () => {
  assert.deepEqual(parseInput(ID.toUpperCase()), {kind:'song',value:ID});
  assert.deepEqual(parseInput(`https://suno.com/song/${ID}`), {kind:'song',value:ID});
  assert.deepEqual(parseInput(`https://www.suno.com/playlist/${ID}`), {kind:'playlist',value:`https://suno.com/playlist/${ID}`});
  assert.deepEqual(parseInput('https://suno.com/s/ExampleAbc123'), {kind:'song',value:'https://suno.com/s/ExampleAbc123'});
  for (const invalid of ['javascript:alert(1)', 'http://suno.com/song/'+ID, 'https://suno.com.evil.tld/song/'+ID,'https://a@www.suno.com/song/'+ID,'https://suno.com:8443/song/'+ID,'https://suno.com/other/'+ID, 'not-an-id'])
    assert.equal(parseInput(invalid),null,invalid);
});

test('uses a safe clean title only; never appends song ID', () => {
  assert.equal(filename({id:ID,title:'我的/歌曲: 第一首'}),'SunoBatch/我的-歌曲- 第一首.m4a');
  assert.equal(filename({id:ID,title:'track_10'}),'SunoBatch/track_10.m4a');
  assert.equal(cleanTitle('CON'),'歌曲');
  assert.equal(cleanTitle('bad?. '),'bad-');
  assert.equal(cleanTitle('\0\n'),'歌曲');
  assert.ok(!filename({id:ID,title:'我的歌'}).includes(ID));
});

test('rejects malformed API song info and insecure temporary media URLs', () => {
  assert.deepEqual(checkedSong({id:ID.toUpperCase(),title:'Hello'}),{id:ID,title:'Hello'});
  assert.throws(() => checkedSong({id:'unexpected',title:'Hello'}));
  assert.equal(mediaURL({media:{url:'https://cdn.example.test/song.m4a'}}),'https://cdn.example.test/song.m4a');
  for (const url of ['http://example.test/a', 'https://user:secret@example.test/a', 'broken'])
    assert.throws(() => mediaURL({media:{url}}));
});

test('only Chrome complete means success; interrupted and missing records are errors', () => {
  assert.equal(downloadState({}, {state:'complete',bytesReceived:10,totalBytes:10}).state,'complete');
  assert.equal(downloadState({}, {state:'in_progress',bytesReceived:3,totalBytes:10}).received,3);
  assert.match(downloadState({}, {state:'interrupted',error:'NETWORK_FAILED'}).error,/NETWORK_FAILED/);
  assert.equal(downloadState({}, null).state,'error');
});

test('schedules retryable failures with backoff and respects pending deadline', () => {
  assert.equal(isRetryable({status:429}),true);
  assert.equal(isRetryable({status:503}),true);
  assert.equal(isRetryable(Object.assign(new Error('timeout'),{name:'TimeoutError'})),true);
  assert.equal(isRetryable({status:404}),false);
  assert.equal(retryDelay(1),10000);
  assert.equal(retryDelay(2),20000);
  assert.equal(retryDelay(10),60000);
  assert.equal(eligible({state:'pending',nextAttempt:2000},1000),false);
  assert.equal(eligible({state:'pending',nextAttempt:2000},2000),true);
  assert.equal(eligible({state:'complete'},2000),false);
});

test('MV3 requires local scripts, sidePanel and minimal host access', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url)));
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(manifest.manifest_version,3);
  assert.equal(manifest.side_panel.default_path,'index.html');
  assert.ok(manifest.permissions.includes('sidePanel'));
  assert.deepEqual(manifest.host_permissions,['https://download.ai-suno.com/*']);
  assert.match(manifest.content_security_policy.extension_pages,/script-src 'self'/);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages,/unsafe-eval|unsafe-inline/);
  assert.match(html,/<script src="app.js" type="module"><\/script>/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)/);
  assert.doesNotMatch(html,/\sonclick\s*=/);
});

test('v0.2.2 retains local extension icons and readable sidebar typography', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url)));
  const css = readFileSync(new URL('../style.css',import.meta.url),'utf8');
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal(manifest.version,'0.2.2');
  for (const size of [16,32,48,128]) {
    const path = `icons/icon${size}.png`;
    assert.equal(manifest.icons[String(size)],path);
    const png = readFileSync(new URL(`../${path}`,import.meta.url));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',path);
    assert.equal(png.readUInt32BE(16),size,path);
    assert.equal(png.readUInt32BE(20),size,path);
  }
  assert.deepEqual(Object.keys(manifest.action.default_icon),['16','32']);
  assert.match(html,/src="icons\/icon48\.png"/);
  assert.match(css,/font:\s*15\.5px\/1\.52/);
  assert.match(css,/\.song-name\s*\{\s*font-size:\s*14\.5px/);
  assert.match(css,/\.status\s*\{[^}]*font-size:\s*12\.5px/);
  assert.doesNotMatch(css,/@import|url\(https?:/);
});

