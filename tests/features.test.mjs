/* 新增能力回归：对齐吸附、小地图、SVG 导出、复制粘贴、图层、右键菜单、双击编辑、文字撑高 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 950 }
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));

const log = [];
const ok = (n, c, e='') => log.push(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  → ' + e : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(700);

const geo = () => page.evaluate(() => [...document.querySelectorAll('[data-kind="node"]')].map(e => {
  const r = e.getBoundingClientRect();
  return {
    x:+e.dataset.x, y:+e.dataset.y, w:+e.dataset.w, h:+e.dataset.h,
    cx:+e.dataset.x + +e.dataset.w/2, cy:+e.dataset.y + +e.dataset.h/2,
    scrX:r.x, scrY:r.y, scrW:r.width, scrH:r.height,
    id:e.dataset.id
  };
}));
const nodeCount = () => page.evaluate(() => document.querySelectorAll('[data-kind="node"]').length);
const clickNode = async i => {
  const r = await page.evaluate(idx => {
    const b = document.querySelectorAll('[data-kind="node"]')[idx].getBoundingClientRect();
    return { x:b.x + b.width/2, y:b.y + b.height/2 };
  }, i);
  await page.mouse.click(r.x, r.y);
  await sleep(150);
};

/* ============ F1 文字撑高 ============ */
await page.mouse.click(330, 690);
await sleep(60);
await page.mouse.click(330, 690);
await sleep(350);
await page.keyboard.type('这是一段很长的节点文字用来验证换行之后会不会跑出方框外面去');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(350);
const hInfo = await page.evaluate(() => {
  const g = document.querySelector('.node.sel');
  if(!g) return null;
  const rect = g.querySelector('rect[fill]') || g.querySelector('rect');
  const shapeH = +rect.getAttribute('height');
  const ys = [...g.querySelectorAll('text')].map(t => +t.getAttribute('y'));
  const y0 = +rect.getAttribute('y');
  return { shapeH, nLines: ys.length, lastY: Math.max(...ys), bottom: y0 + shapeH };
});
ok('F1 长文字自动撑高节点', !!hInfo && hInfo.shapeH > 80 && hInfo.lastY < hInfo.bottom,
   `h=${hInfo && hInfo.shapeH} 行数=${hInfo && hInfo.nLines}`);

/* ============ F2 输入框内快捷键隔离 ============ */
const cntBefore = await nodeCount();
await page.evaluate(() => {
  const ta = document.querySelector('#inspector textarea[data-prop="text"]');
  if(ta){ ta.focus(); ta.setSelectionRange(0,2); }
});
await sleep(120);
await page.keyboard.press('Backspace');
await sleep(200);
ok('F2 面板内 Backspace 不删节点', await nodeCount() === cntBefore, `${cntBefore} 保持不变`);

const cntB2 = await nodeCount();
await page.evaluate(() => {
  const ta = document.querySelector('#inspector textarea[data-prop="text"]');
  if(ta) ta.focus();
});
await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
await sleep(250);
ok('F3 面板内 Ctrl+Z 不撤销画布', await nodeCount() === cntB2, `${cntB2} 保持不变`);

/* ============ F4 对齐吸附 + 参考线 ============ */
await page.mouse.click(300, 900);
await sleep(200);
let g = await geo();
const A = g[0], B = g[3];
const aScr = { cx: A.scrX + A.scrW/2, cy: A.scrY + A.scrH/2 };
const bScrCy = B.scrY + B.scrH/2;
const moveDy = (bScrCy + 3) - aScr.cy;

await page.mouse.move(aScr.cx, aScr.cy);
await page.mouse.down();
await page.mouse.move(aScr.cx + 120, aScr.cy + moveDy*0.5, { steps: 6 });
await page.mouse.move(aScr.cx + 240, aScr.cy + moveDy, { steps: 6 });
await sleep(200);
const guideLines = await page.evaluate(() => document.querySelectorAll('#vp line.ui-only').length);
await page.mouse.up();
await sleep(250);
g = await geo();
const dcy = Math.abs(g[0].cy - g[3].cy);
ok('F4 拖拽吸附到中线', dcy < 0.6, `Δcy=${dcy.toFixed(2)}`);
ok('F5 拖拽时出现对齐参考线', guideLines > 0, `lines=${guideLines}`);
ok('F6 松手后参考线消失',
   await page.evaluate(() => document.querySelectorAll('#vp line.ui-only').length) === 0);

/* ============ F7 小地图 ============ */
const mm = await page.evaluate(() => {
  const r = document.querySelector('#minimap').getBoundingClientRect();
  const rects = document.querySelector('#mmSvg').querySelectorAll('rect').length;
  return { w: Math.round(r.width), h: Math.round(r.height), rects };
});
ok('F7 小地图渲染', mm.w > 100 && mm.rects >= 6, JSON.stringify(mm));

const vpBefore = await page.evaluate(() => document.querySelector('#vp').getAttribute('transform'));
const mmr = await page.evaluate(() => {
  const r = document.querySelector('#mmSvg').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.click(mmr.x + mmr.w*0.8, mmr.y + mmr.h*0.3);
await sleep(300);
ok('F8 点小地图平移视口',
   await page.evaluate(() => document.querySelector('#vp').getAttribute('transform')) !== vpBefore);

/* ============ F9 复制粘贴 ============ */
await clickNode(0);
const c0 = await nodeCount();
await page.keyboard.down('Control'); await page.keyboard.press('KeyC'); await page.keyboard.up('Control');
await sleep(180);
await page.keyboard.down('Control'); await page.keyboard.press('KeyV'); await page.keyboard.up('Control');
await sleep(350);
ok('F9 Ctrl+C/V 粘贴节点', await nodeCount() === c0 + 1, `${c0} → ${await nodeCount()}`);

/* ============ F10 图层顺序 ============ */
await clickNode(0);
const idsBefore = await page.evaluate(() => [...document.querySelectorAll('[data-kind="node"]')].map(e => e.dataset.id));
const target = idsBefore[0];
await page.evaluate(() => document.querySelector('[data-act="front"]').click());
await sleep(250);
const idsAfter = await page.evaluate(() => [...document.querySelectorAll('[data-kind="node"]')].map(e => e.dataset.id));
ok('F10 置顶改变绘制顺序', idsAfter[idsAfter.length-1] === target, `${target.slice(0,6)} → 末位`);

/* ============ F11 双击连线编辑标签 ============ */
const mid = await page.evaluate(() => {
  const p = document.querySelector('[data-kind="edge"] path:nth-of-type(2)');
  const pt = p.getPointAtLength(p.getTotalLength()/2);
  const sp = pt.matrixTransform(p.getScreenCTM());
  return { x: sp.x, y: sp.y };
});
await page.mouse.click(mid.x, mid.y);
await sleep(70);
await page.mouse.click(mid.x, mid.y);
await sleep(400);
const editorOn = await page.evaluate(() => document.querySelector('#editorOverlay').classList.contains('on'));
await page.keyboard.type('同意');
await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
await sleep(350);
const labelOk = await page.evaluate(() =>
  [...document.querySelectorAll('[data-kind="edge"] text')].some(t => t.textContent === '同意'));
ok('F11 双击连线改标签', editorOn && labelOk, `editor=${editorOn} label=${labelOk}`);

/* ============ F12 右键菜单 ============ */
await page.mouse.click(300, 880, { button: 'right' });
await sleep(300);
const blankMenu = await page.evaluate(() =>
  [...document.querySelectorAll('#menu .menu-item')].map(e => e.textContent.trim()));
ok('F12 右键空白弹出上下文菜单',
   blankMenu.some(t => t.includes('粘贴')) && blankMenu.some(t => t.includes('全选')),
   blankMenu.join(' / '));
await page.keyboard.press('Escape');
await sleep(200);

/* ============ F13 导出 SVG ============ */
await page.evaluate(() => {
  window.__blob = null;
  if(!window.__patched){
    window.__patched = true;
    const o = URL.createObjectURL;
    URL.createObjectURL = function(x){ window.__blob = x; return o.call(URL, x); };
  }
});
await page.click('#btnExport');
await sleep(150);
for(const it of await page.$$('.menu-item')){
  const t = await page.evaluate(e => e.textContent, it);
  if(t.includes('SVG')){ await it.click(); break; }
}
await sleep(900);
const svgInfo = await page.evaluate(async () => {
  if(!window.__blob) return null;
  const txt = await window.__blob.text();
  return {
    type: window.__blob.type, size: window.__blob.size,
    isSvg: txt.includes('<svg'), hasText: /<text/.test(txt), hasMarker: txt.includes('marker-end')
  };
});
ok('F13 导出 SVG 且含文字与箭头',
   !!svgInfo && svgInfo.type.includes('svg') && svgInfo.isSvg && svgInfo.hasText && svgInfo.hasMarker,
   svgInfo ? `${svgInfo.size}B` : 'null');

ok('F14 全程无 JS 错误', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(log.join('\n'));
console.log('\nerrors: ' + (errors.length ? errors.join('\n') : '(none)'));
const fails = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\nRESULT: ${log.length - fails}/${log.length} passed`);
await browser.close();
process.exit(fails ? 1 : 0);
