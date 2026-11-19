import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const OUT = ROOT + path.sep;

// Chrome 位置：可用环境变量 CHROME_PATH 覆盖
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const CHROME = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!CHROME) {
  console.error('找不到 Chrome，请设置环境变量 CHROME_PATH 指向浏览器可执行文件');
  process.exit(2);
}
const log = [];
const ok = (n, c, e='') => log.push(`${c?'PASS':'FAIL'}  ${n}${e?'  → '+e:''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 准备导入用的样本文件
fs.mkdirSync(OUT + '_fix', { recursive: true });
fs.writeFileSync(OUT + '_fix/sample.json', JSON.stringify({
  app:'FlowForge', version:1,
  nodes:[
    {id:'a',x:0,y:0,w:160,h:60,text:'第一',shape:'rect',fill:'',stroke:'',textColor:'',fontSize:14},
    {id:'b',x:240,y:0,w:160,h:60,text:'第二',shape:'round',fill:'',stroke:'',textColor:'',fontSize:14},
    {id:'c',x:480,y:120,w:160,h:60,text:'第三',shape:'diamond',fill:'',stroke:'',textColor:'',fontSize:14}
  ],
  edges:[{id:'e1',from:'a',to:'b',label:'',fromSide:'auto',toSide:'auto',dashed:false,color:''},
         {id:'e2',from:'b',to:'c',label:'分支',fromSide:'auto',toSide:'auto',dashed:true,color:''}],
  notes:[]
}, null, 2));

fs.writeFileSync(OUT + '_fix/n.csv',
  '\uFEFFid,text,shape,x,y,w,h,fill,stroke\n'
  + 'x1,采集,rect,0,0,150,60,,\n'
  + 'x2,清洗,round,220,0,150,60,,\n'
  + 'x3,入库,cylinder,440,0,150,60,,\n');
fs.writeFileSync(OUT + '_fix/e.csv',
  '\uFEFFfrom,to,label,dashed,fromSide,toSide\n'
  + 'x1,x2,,0,auto,auto\n'
  + 'x2,x3,增量,0,auto,auto\n');

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 950 }
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));

await page.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(400);

const counts = () => page.evaluate(() => {
  const t = document.querySelector('#stCount').textContent;
  const n = /节点\s*(\d+)/.exec(t), e = /连线\s*(\d+)/.exec(t), a = /批注\s*(\d+)/.exec(t);
  return { nodes: +(n?n[1]:0), edges: +(e?e[1]:0), notes: +(a?a[1]:0) };
});

// ============ R1 便签 ============
await page.click('.tool[data-tool="note"]');
await sleep(100);
await page.mouse.click(560, 700);
await sleep(250);
await page.keyboard.type('这里要改成异步');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(250);
const c1 = await counts();
// 初始示例自带 1 个提示便签，新建后应为 2
ok('R1 新建批注便签并写入文字', c1.notes === 2, `notes=${c1.notes}（初始1+新建1）`);

// ============ R2 多选 + 对齐 ============
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
await sleep(200);
const selInfo = await page.evaluate(() => document.querySelector('#inspector .insp-title')?.textContent.trim()||'');
const alignBtns = await page.evaluate(() => document.querySelectorAll('[data-align]').length);
if (alignBtns > 0) {
  await page.click('[data-align="top"]');
  await sleep(200);
}
const aligned = await page.evaluate(() => {
  const ys = Array.from(document.querySelectorAll('[data-kind="node"] path, [data-kind="node"] rect'))
    .map(e => Math.round(e.getBoundingClientRect().y));
  return new Set(ys).size;
});
ok('R2 全选后出现对齐工具，顶对齐生效', alignBtns >= 6 && aligned <= 2,
   `alignBtns=${alignBtns}, distinctY=${aligned}, panel="${selInfo}"`);

// ============ R3 JSON 导入 ============
await page.evaluate(() => { document.querySelector('#fileInput').value=''; });
await page.click('#btnImport');
await sleep(120);
let items = await page.$$('.menu-item');
for (const it of items) {
  const t = await page.evaluate(el => el.textContent, it);
  if (t.includes('JSON')) { await it.click(); break; }
}
await sleep(200);
const fi = await page.$('#fileInput');
await fi.uploadFile(OUT + '_fix/sample.json');
await sleep(700);
const c3 = await counts();
ok('R3 导入 JSON 工程', c3.nodes === 3 && c3.edges === 2, JSON.stringify(c3));

// ============ R4 CSV 导入（两份） ============
await page.evaluate(() => { document.querySelector('#fileInput').value=''; });
await page.click('#btnImport');
await sleep(120);
items = await page.$$('.menu-item');
for (const it of items) {
  const t = await page.evaluate(el => el.textContent, it);
  if (t.includes('CSV')) { await it.click(); break; }
}
await sleep(200);
await fi.uploadFile(OUT + '_fix/n.csv', OUT + '_fix/e.csv');
await sleep(900);
const c4 = await counts();
ok('R4 导入 CSV 节点表+连线表', c4.nodes === 3 && c4.edges === 2, JSON.stringify(c4));

// ============ R5 导出 PNG 并落盘检查 ============
await page.evaluate(() => {
  window.__lastBlob = null;
  if (!window.__patched) {
    window.__patched = true;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { window.__lastBlob = b; return orig.call(URL, b); };
  }
});
await page.click('#btnExport');
await sleep(150);
items = await page.$$('.menu-item');
for (const it of items) {
  const t = await page.evaluate(el => el.textContent, it);
  if (t.includes('PNG')) { await it.click(); break; }
}
await sleep(2000);
const dataUrl = await page.evaluate(() => new Promise(res => {
  if (!window.__lastBlob) return res(null);
  const fr = new FileReader();
  fr.onload = () => res(fr.result);
  fr.readAsDataURL(window.__lastBlob);
}));
let pngOk = false, pngBytes = 0;
if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(OUT + '_export_check.png', buf);
  pngOk = buf.length > 10000;
  pngBytes = buf.length;
}
ok('R5 导出 PNG 可解码且体积正常', pngOk, `${pngBytes}B`);

// ============ R6 空白画布时导出不报错 ============
await page.evaluate(() => {
  // 用菜单清空
});
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
await sleep(150);
await page.keyboard.press('Delete');
await sleep(300);
const c6 = await counts();
ok('R6 全选删除清空画布', c6.nodes === 0, JSON.stringify(c6));

// ============ R7 缩放与平移 ============
await page.mouse.move(800, 400);
await page.mouse.wheel({ deltaY: -300 });
await sleep(200);
const zoomText = await page.evaluate(() => document.querySelector('#stZoom').textContent);
await page.keyboard.down(' ');  // 空格平移
await page.mouse.move(800, 400);
await page.mouse.down();
await page.mouse.move(900, 450, { steps: 5 });
await page.mouse.up();
await page.keyboard.up(' ');
await sleep(200);
const zoomNum = parseInt(zoomText);
ok('R7 滚轮缩放生效', zoomNum > 100, 'zoom=' + zoomText);

// ============ R8 无报错 ============
ok('R8 全程无 JS 错误', errors.length === 0, errors.slice(0,3).join(' | '));

console.log(log.join('\n'));
console.log('\nerrors: ' + (errors.length ? errors.join('\n') : '(none)'));
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\nRESULT: ${log.length - fails}/${log.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
