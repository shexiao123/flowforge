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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 950 }
});
const page = await browser.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const log = [];
const ok = (name, cond, extra='') => log.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(500);

// 读状态栏计数
const counts = () => page.evaluate(() => {
  const t = document.querySelector('#stCount').textContent;
  const n = /节点\s*(\d+)/.exec(t);
  const e = /连线\s*(\d+)/.exec(t);
  return { nodes: +(n ? n[1] : 0), edges: +(e ? e[1] : 0) };
});
// 节点屏幕矩形
const nodeRect = i => page.evaluate(idx => {
  const els = document.querySelectorAll('[data-kind="node"]');
  const el = els[idx];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height,
           cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, i);

// ---------- T1 初始加载 ----------
const c0 = await counts();
ok('T1 首次加载带示例（5 节点 / 5 连线）', c0.nodes === 5 && c0.edges === 5, JSON.stringify(c0));

// ---------- T2 点击节点 → 属性面板 ----------
const r0 = await nodeRect(0);
await page.mouse.click(r0.cx, r0.cy);
await sleep(150);
const inspTitle = await page.evaluate(() => document.querySelector('#inspector .insp-title')?.textContent.trim() || '');
ok('T2 点击节点弹出属性面板', inspTitle.startsWith('节点'), inspTitle);

// ---------- T3 选中态锚点可见 ----------
const anchorVisible = await page.evaluate(() => {
  const a = document.querySelector('.node.sel .anchor');
  if (!a) return 'no-anchor';
  return getComputedStyle(a).opacity;
});
ok('T3 选中节点显示连线锚点', anchorVisible === '1', 'opacity=' + anchorVisible);

// ---------- T4 拖拽移动节点 ----------
const before = await page.evaluate(() => {
  const el = document.querySelectorAll('[data-kind="node"]')[0];
  return el.getBoundingClientRect().x;
});
await page.mouse.move(r0.cx, r0.cy);
await page.mouse.down();
await page.mouse.move(r0.cx + 90, r0.cy + 50, { steps: 8 });
await page.mouse.up();
await sleep(120);
const after = await page.evaluate(() => {
  const el = document.querySelectorAll('[data-kind="node"]')[0];
  return el.getBoundingClientRect().x;
});
ok('T4 拖拽节点位置变化', Math.abs(after - before) > 40, `Δx=${(after - before).toFixed(0)}px`);

// ---------- T5 撤销拖拽 ----------
await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
await sleep(150);
const back = await page.evaluate(() => {
  const el = document.querySelectorAll('[data-kind="node"]')[0];
  return el.getBoundingClientRect().x;
});
ok('T5 Ctrl+Z 撤销拖拽', Math.abs(back - before) < 3, `x=${back.toFixed(0)} vs ${before.toFixed(0)}`);

// ---------- T6 从锚点拉线 ----------
const e0 = (await counts()).edges;
await page.mouse.move(r0.cx, r0.cy);           // 触发 hover
await sleep(80);
const rA = await nodeRect(0);
const rB = await nodeRect(1);
await page.mouse.move(rA.x + rA.w - 1, rA.y + rA.h / 2);   // 右锚点
await sleep(60);
await page.mouse.down();
await page.mouse.move(rA.x + rA.w + 40, rA.y + rA.h / 2, { steps: 5 });
await page.mouse.move(rB.cx, rB.cy, { steps: 6 });
await page.mouse.up();
await sleep(180);
const e1 = (await counts()).edges;
ok('T6 拖锚点拉出连线', e1 === e0 + 1, `edges ${e0} → ${e1}`);

// ---------- T7 双击空白新建节点 ----------
const cA = await counts();
await page.mouse.click(300, 720, { clickCount: 2 });
await sleep(250);
const editingOn = await page.evaluate(() => document.querySelector('#editorOverlay').classList.contains('on'));
await page.keyboard.type('测试节点');
await page.keyboard.press('Escape');
await sleep(200);
const cB = await counts();
ok('T7 双击空白新建节点并进入编辑', cB.nodes === cA.nodes + 1 && editingOn,
   `nodes ${cA.nodes} → ${cB.nodes}, editor=${editingOn}`);

// ---------- T8 属性面板改文字 ----------
await page.evaluate(() => {
  const ta = document.querySelector('#inspector textarea[data-prop="text"]');
  if (ta) {
    ta.focus();
    ta.value = '退款审批流';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
await sleep(150);
const textOk = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-kind="node"] text'))
    .some(t => t.textContent.includes('退款审批流')));
ok('T8 属性面板改文字实时刻画布', textOk);

// ---------- T9 自动布局（从上到下） ----------
await page.click('#btnLayout');
await sleep(120);
const menuOpen = await page.evaluate(() => document.querySelector('#menuLayer').classList.contains('on'));
if (menuOpen) {
  const items = await page.$$('.menu-item');
  for (const it of items) {
    const txt = await page.evaluate(el => el.textContent, it);
    if (txt.includes('从上到下')) { await it.click(); break; }
  }
}
await sleep(400);
const layoutOk = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-kind="node"]'));
  if (els.length < 3) return false;
  const rs = els.map(e => e.getBoundingClientRect());
  // 纵向布局：y 值应分散在不同高度
  const ys = new Set(rs.map(r => Math.round(r.y / 20)));
  return ys.size >= 3;
});
ok('T9 自动布局（从上到下）重排节点', layoutOk);
await page.screenshot({ path: OUT + '_t_layout.png' });

// ---------- T10 深色主题 ----------
await page.click('#btnTheme');
await sleep(300);
const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
ok('T10 切换深色主题', themeAttr === 'dark', 'theme=' + themeAttr);
await page.screenshot({ path: OUT + '_t_dark.png' });

// ---------- T11 模板：转化漏斗 ----------
await page.click('#btnTemplates');
await sleep(120);
let items = await page.$$('.menu-item');
for (const it of items) {
  const txt = await page.evaluate(el => el.textContent, it);
  if (txt.includes('转化漏斗')) { await it.click(); break; }
}
await sleep(500);
const cTpl = await counts();
ok('T11 载入漏斗模板', cTpl.nodes === 5 && cTpl.edges === 4, JSON.stringify(cTpl));
await page.screenshot({ path: OUT + '_t_funnel.png' });

// ---------- T12 导出 PNG ----------
const dlDir = OUT + '_dl/';
fs.mkdirSync(dlDir, { recursive: true });
const client = await page.createCDPSession();
await client.send('Page.enable');
try { await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir }); }
catch(e) { log.push('WARN 下载行为设置失败: ' + e.message); }
// 同时挂钩 createObjectURL，验证导出的 Blob 本身是否正确
await page.evaluate(() => {
  window.__blobs = [];
  if (!window.__origCOU) {
    window.__origCOU = URL.createObjectURL;
    URL.createObjectURL = function (b) {
      window.__blobs.push({ type: b.type || '', size: b.size || 0 });
      return window.__origCOU.call(URL, b);
    };
  }
});
await page.click('#btnExport');
await sleep(150);
items = await page.$$('.menu-item');
for (const it of items) {
  const txt = await page.evaluate(el => el.textContent, it);
  if (txt.includes('PNG')) { await it.click(); break; }
}
await sleep(1800);
const files = fs.readdirSync(dlDir).filter(f => f.endsWith('.png'));
const pngSize = files.length ? fs.statSync(dlDir + files[0]).size : 0;
const blobs1 = await page.evaluate(() => window.__blobs || []);
const pngBlob = blobs1.filter(b => b.type.includes('png')).pop();
ok('T12 导出 PNG 文件', (files.length > 0 && pngSize > 8000) || (pngBlob && pngBlob.size > 8000),
   files[0] ? `${files[0]} ${pngSize}B` : `blob=${pngBlob ? pngBlob.size + 'B' : 'none'}`);

// ---------- T13 导出 JSON ----------
await page.click('#btnExport');
await sleep(150);
items = await page.$$('.menu-item');
for (const it of items) {
  const txt = await page.evaluate(el => el.textContent, it);
  if (txt.includes('JSON')) { await it.click(); break; }
}
await sleep(900);
const jsons = fs.readdirSync(dlDir).filter(f => f.endsWith('.json'));
let jsonOk = false;
if (jsons.length) {
  const raw = fs.readFileSync(dlDir + jsons[0], 'utf8');
  const o = JSON.parse(raw);
  jsonOk = Array.isArray(o.nodes) && o.nodes.length === 5;
}
const blobs2 = await page.evaluate(() => window.__blobs || []);
const jsonBlob = blobs2.filter(b => b.type.includes('json')).pop();
ok('T13 导出 JSON 工程文件', jsonOk || (jsonBlob && jsonBlob.size > 200),
   jsons[0] ? `${jsons[0]}` : `blob=${jsonBlob ? jsonBlob.size + 'B' : 'none'}`);

// ---------- T14 导出 CSV ----------
await page.click('#btnExport');
await sleep(150);
items = await page.$$('.menu-item');
for (const it of items) {
  const txt = await page.evaluate(el => el.textContent, it);
  if (txt.includes('CSV')) { await it.click(); break; }
}
await sleep(1400);
const csvs = fs.readdirSync(dlDir).filter(f => f.endsWith('.csv'));
const blobs3 = await page.evaluate(() => window.__blobs || []);
const csvBlobs = blobs3.filter(b => b.type.includes('csv'));
ok('T14 导出 CSV 两份', csvs.length >= 2 || csvBlobs.length >= 2,
   csvs.length ? csvs.join(' , ') : `blobs=${csvBlobs.map(b=>b.size).join('/')}`);

// ---------- T15 刷新后持久化 ----------
const beforeReload = await counts();
await page.reload({ waitUntil: 'load' });
await sleep(600);
const afterReload = await counts();
ok('T15 刷新后数据保留', afterReload.nodes === beforeReload.nodes, `${beforeReload.nodes} → ${afterReload.nodes}`);

// ---------- T16 无 JS 报错 ----------
ok('T16 无 JS 运行时错误', errors.length === 0, errors.slice(0, 4).join(' | '));

console.log(log.join('\n'));
console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');
const failCount = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\nRESULT: ${log.length - failCount}/${log.length} passed`);

await browser.close();
process.exit(failCount ? 1 : 0);
