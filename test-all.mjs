// Node.js | 24+ | Repository regression entry (built-ins only).
// Run: node test-all.mjs
// No application account, actual sign-in or online media operation is performed by these tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.dirname(fileURLToPath(import.meta.url));
const folders = ['amap','apple-weather','cainiao','cainiao-widget','camscanner','egern','hongguo','jd','jyjt','pinduoduo','weilai','xianyu'];
function testFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item => {
    const file=path.join(dir,item.name);
    return item.isDirectory() ? testFiles(file) : item.isFile() && item.name.endsWith('.test.cjs') ? [file] : [];
  });
}
const files=folders.flatMap(folder=>testFiles(path.join(root,folder,'tests'))).sort();
const result=spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',...files],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
if(result.status!==0){process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=result.status||1;}
else {
  for(const line of (result.stdout||'').split('\n').filter(line=>/^# (tests|pass|fail|cancelled|skipped|todo) /.test(line))) console.log(line);
  const fail=Number(result.stdout.match(/^# fail (\d+)$/m)?.[1]);
  const skip=Number(result.stdout.match(/^# skipped (\d+)$/m)?.[1]);
  if(fail!==0||skip!==0)process.exitCode=1;
}
const youtube=spawnSync(process.execPath,['--require',path.join(root,'youtube/tests/offline-guard.cjs'),path.join(root,'youtube/tests/youtube.test.mjs')],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
if(youtube.status!==0){process.stdout.write(youtube.stdout||'');process.stderr.write(youtube.stderr||'');process.exitCode=youtube.status||1;}
else {
  const match=youtube.stdout.match(/^MOCK_SUMMARY (\{[^\r\n]+\})$/m);
  if(!match){console.error('YouTube mock summary missing');process.exitCode=1;}
  else{const summary=JSON.parse(match[1]);console.log(`YouTube: ${summary.passed}/${summary.total}; failed=${summary.failed}; liveNetworkCalls=${summary.liveNetworkCalls}`);if(summary.failed!==0||summary.passed!==summary.total||summary.liveNetworkCalls!==0)process.exitCode=1;}
}
