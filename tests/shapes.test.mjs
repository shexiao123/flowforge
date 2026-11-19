/* 形状库与样式扩展回归：27 种形状、分组切换、节点样式、连线走线/箭头/线宽 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PAGE_URL = pathToFileURL(path.join(ROOT, 'index.html')).href + '#editor';

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
const ok = (n, c, e = '') => log.push(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  → ' + e : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

await page.goto(PAGE_URL, { waitUntil: 'load' });
await sleep(700);

/* ---------- 1. 形状库完整性 ---------- */
const lib = await page.evaluate(() => {
  const FF = window.FF;
  const groups = {};
  FF.SHAPES.forEach(s => { groups[s.group] = (groups[s.group] || 0) + 1; });
  return { total: FF.SHAPES.length, groups, groupsDeclared: FF.SHAPES.length === 27 };
});
ok('S1 形状库共 27 种', lib.total === 27, `total=${lib.total}`);
ok('S2 三个分组齐全', lib.groups['基础'] === 12 && lib.groups['流程'] === 10 && lib.groups['数据'] === 5,
   JSON.stringify(lib.groups));

/* ---------- 2. 每种形状的几何都在自己的包围盒内 ---------- */
const geom = await page.evaluate(() => {
  const FF = window.FF;
  const bad = [];
  const empty = [];
  FF.SHAPES.forEach(s => {
    if (s.id === 'textonly') return;                // 纯文字本来就没有轮廓
    const n = FF.mkNode({ x: 100, y: 100, w: 180, h: 90, text: '', shape: s.id });
    FF.state.nodes = [n];
    FF.state.edges = [];
    FF.state.notes = [];
    FF.render();
    const g = document.querySelector('[data-kind="node"]');
    const shape = g.querySelector('rect, polygon, path, circle, ellipse');
    if (!shape) { empty.push(s.id); return; }
    const b = shape.getBBox();
    if (b.width < 4 || b.height < 4) empty.push(s.id);
    const tol = 3;
    if (b.x < 100 - tol || b.y < 100 - tol ||
        b.x + b.width > 280 + tol || b.y + b.height > 190 + tol) {
      bad.push([s.id, Math.round(b.x), Math.round(b.y),
                Math.round(b.x + b.width), Math.round(b.y + b.height)]);
    }
  });
  return { bad, empty };
});
ok('S3 所有形状都画出了有效几何', geom.empty.length === 0, `空几何: ${geom.empty.join(',') || '无'}`);
ok('S4 所有形状都不越出包围盒', geom.bad.length === 0, JSON.stringify(geom.bad));

/* ---------- 3. 面板分组切换 ---------- */
await page.evaluate(() => {
  const FF = window.FF;
  FF.state.nodes = [FF.mkNode({ x: 0, y: 0, w: 170, h: 64, text: '样式测试', shape: 'rect' })];
  FF.state.edges = [];
  FF.state.notes = [];
  FF.clearSelect();
  FF.selectOnly('node', FF.state.nodes[0].id);
  FF.render(); FF.renderInspector();
});
await sleep(250);
const baseCount = await page.evaluate(() => document.querySelectorAll('.spill').length);
ok('S5 默认显示基础组 12 个形状', baseCount === 12, `count=${baseCount}`);

/* 切到"数据"组 */
const dataTab = await page.$$('.stab');
for (const t of dataTab) {
  const txt = await page.evaluate(e => e.textContent.trim(), t);
  if (txt === '数据') { await t.click(); break; }
}
await sleep(250);
const dataCount = await page.evaluate(() => document.querySelectorAll('.spill').length);
ok('S6 切到数据组显示 5 个形状', dataCount === 5, `count=${dataCount}`);

/* ---------- 4. 点图标改形状 ---------- */
let cloudBtn = null;
for (const el of await page.$$('.spill')) {
  const txt = await page.evaluate(e => e.querySelector('em').textContent, el);
  if (txt === '云') { cloudBtn = el; break; }
}
await cloudBtn.click();
await sleep(300);
const afterShape = await page.evaluate(() => {
  const n = window.FF.state.nodes[0];
  return { shape: n.shape, last: window.FF.state.lastShape };
});
ok('S7 点击图标改变节点形状', afterShape.shape === 'cloud', `shape=${afterShape.shape}`);
ok('S8 记住上次形状供新建使用', afterShape.last === 'cloud', `lastShape=${afterShape.last}`);

/* 新建节点沿用上次形状 */
await page.evaluate(() => { window.FF.state.lastShape = 'cloud'; });
await page.mouse.click(420, 800);
await sleep(120);
await page.mouse.click(420, 800);
await sleep(350);
await page.keyboard.press('Escape');
await sleep(200);
const newShape = await page.evaluate(() => {
  const ns = window.FF.state.nodes;
  return ns[ns.length - 1].shape;
});
ok('S9 新建节点沿用上次形状', newShape === 'cloud', `shape=${newShape}`);

/* ---------- 5. 节点样式 ---------- */
const stylePanelReady = await page.evaluate(() => {
  const FF = window.FF;
  FF.state.nodes = [FF.mkNode({ x: 0, y: 0, w: 190, h: 70, text: '样式', shape: 'round' })];
  FF.state.edges = [];
  FF.state.notes = [];
  FF.clearSelect();
  FF.selectOnly('node', FF.state.nodes[0].id);
  FF.render(); FF.renderInspector();
  return true;
});
await sleep(250);

/* 色板：第一个色块 */
await page.click('.tone');
await sleep(250);
const toned = await page.evaluate(() => {
  const n = window.FF.state.nodes[0];
  return { fill: n.fill, stroke: n.stroke };
});
ok('S10 色板同时套用填充与边框', !!toned.fill && !!toned.stroke && toned.fill !== toned.stroke,
   `fill=${toned.fill} stroke=${toned.stroke}`);

/* 边框虚线 */
for (const el of await page.$$('[data-lstyle]')) {
  if (await page.evaluate(e => e.dataset.lstyle, el) === 'dash') { await el.click(); break; }
}
await sleep(250);
const dashAttr = await page.evaluate(() => {
  const g = document.querySelector('[data-kind="node"]');
  const r = [...g.querySelectorAll('rect')].find(x => !x.classList.contains('ui-only'));
  return r.getAttribute('stroke-dasharray');
});
ok('S11 边框可设虚线', !!dashAttr, `dasharray=${dashAttr}`);

/* 无边框 */
for (const el of await page.$$('[data-lstyle]')) {
  if (await page.evaluate(e => e.dataset.lstyle, el) === 'none') { await el.click(); break; }
}
await sleep(250);
const noStroke = await page.evaluate(() => {
  const g = document.querySelector('[data-kind="node"]');
  const r = [...g.querySelectorAll('rect')].find(x => !x.classList.contains('ui-only'));
  return r.getAttribute('stroke');
});
ok('S12 边框可设为无', noStroke === 'none', `stroke=${noStroke}`);

/* 字号 + 加粗 + 对齐 */
await page.evaluate(() => {
  const FF = window.FF;
  const ta = document.querySelector('[data-prop="fontSize"]');
  ta.value = '20';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(250);
await page.click('[data-bold]');
await sleep(250);
for (const el of await page.$$('[data-talign]')) {
  if (await page.evaluate(e => e.dataset.talign, el) === 'left') { await el.click(); break; }
}
await sleep(250);
const textStyle = await page.evaluate(() => {
  const t = document.querySelector('[data-kind="node"] text');
  return { size: t.getAttribute('font-size'), weight: t.getAttribute('font-weight'),
           anchor: t.getAttribute('text-anchor'), nodeFs: window.FF.state.nodes[0].fontSize };
});
ok('S13 字号可调', textStyle.size === '20' && textStyle.nodeFs === 20, `font-size=${textStyle.size}`);
ok('S14 文字可加粗', textStyle.weight === '600', `weight=${textStyle.weight}`);
ok('S15 文字可左对齐', textStyle.anchor === 'start', `anchor=${textStyle.anchor}`);

/* ---------- 6. 连线走线 / 箭头 / 线宽 ---------- */
await page.evaluate(() => {
  const FF = window.FF;
  const a = FF.mkNode({ x: 0, y: 0, w: 150, h: 64, text: 'A', shape: 'round' });
  const b = FF.mkNode({ x: 420, y: 220, w: 150, h: 64, text: 'B', shape: 'round' });
  FF.state.nodes = [a, b];
  FF.state.edges = [FF.mkEdge(a.id, b.id, '', { route: 'curve', head: 'end' })];
  FF.state.notes = [];
  FF.clearSelect();
  FF.selectOnly('edge', FF.state.edges[0].id);
  FF.render(); FF.renderInspector();
});
await sleep(300);

const routePaths = {};
for (const k of ['curve', 'ortho', 'straight']) {
  for (const el of await page.$$('[data-route]')) {
    if (await page.evaluate(e => e.dataset.route, el) === k) { await el.click(); break; }
  }
  await sleep(220);
  routePaths[k] = await page.evaluate(() => {
    const p = document.querySelectorAll('[data-kind="edge"] path')[1];
    return p.getAttribute('d');
  });
}
ok('S16 三种走线产生不同路径',
   routePaths.curve !== routePaths.ortho && routePaths.ortho !== routePaths.straight,
   `ortho 含圆角=${routePaths.ortho.includes('Q')}`);
ok('S17 直角走线使用圆角折点', routePaths.ortho.includes('Q'), routePaths.ortho.slice(0, 42) + '…');

/* 双向箭头 */
for (const el of await page.$$('[data-head]')) {
  if (await page.evaluate(e => e.dataset.head, el) === 'both') { await el.click(); break; }
}
await sleep(250);
const both = await page.evaluate(() => {
  const p = document.querySelectorAll('[data-kind="edge"] path')[1];
  return { start: p.getAttribute('marker-start'), end: p.getAttribute('marker-end') };
});
ok('S18 可切换双向箭头', !!both.start && !!both.end,
   `start=${(both.start || '').slice(0, 12)} end=${(both.end || '').slice(0, 12)}`);

/* 线宽 */
await page.evaluate(() => {
  const inp = document.querySelector('[data-prop="width"]');
  inp.value = '4';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(250);
const wide = await page.evaluate(() => {
  const p = document.querySelectorAll('[data-kind="edge"] path')[1];
  return { attr: p.getAttribute('stroke-width'), model: window.FF.state.edges[0].width };
});
ok('S19 线宽可调', +wide.attr >= 4 && wide.model === 4, `stroke-width=${wide.attr}`);

/* ---------- 7. 圆形锚点落在圆周上 ---------- */
const circleAnchor = await page.evaluate(() => {
  const FF = window.FF;
  const n = FF.mkNode({ x: 100, y: 100, w: 200, h: 100, text: '圆', shape: 'circle' });
  FF.state.nodes = [n];
  FF.state.edges = [];
  FF.state.notes = [];
  FF.render();
  const g = document.querySelector('[data-kind="node"]');
  const r = +g.querySelector('circle').getAttribute('r');
  const cx = +g.querySelector('circle').getAttribute('cx');
  const anchors = [...g.querySelectorAll('[data-kind="anchor"]')].map(a => +a.getAttribute('cx'));
  const left = Math.min(...anchors), right = Math.max(...anchors);
  return { r, expectLeft: cx - r, expectRight: cx + r, left, right };
});
ok('S20 圆形锚点贴合圆周', Math.abs(circleAnchor.left - circleAnchor.expectLeft) < 0.6 &&
   Math.abs(circleAnchor.right - circleAnchor.expectRight) < 0.6,
   `left=${circleAnchor.left.toFixed(1)}/${circleAnchor.expectLeft.toFixed(1)}`);

/* ---------- 8. 导出 SVG 包含新形状 ---------- */
await page.evaluate(() => {
  window.__blob = null;
  if (!window.__origCOU) {
    window.__origCOU = URL.createObjectURL;
    URL.createObjectURL = function (x) { window.__blob = x; return window.__origCOU.call(URL, x); };
  }
  const FF = window.FF;
  FF.state.nodes = [
    FF.mkNode({ x: 0, y: 0, w: 170, h: 90, text: '云端服务', shape: 'cloud' }),
    FF.mkNode({ x: 240, y: 0, w: 170, h: 90, text: '文档记录', shape: 'document' })
  ];
  FF.state.edges = [FF.mkEdge(FF.state.nodes[0].id, FF.state.nodes[1].id, '同步', { route: 'ortho' })];
  FF.state.notes = [];
  FF.clearSelect(); FF.render(); FF.fitView();
});
await sleep(300);
await page.click('#btnExport');
await sleep(200);
for (const it of await page.$$('.menu-item')) {
  const t = await page.evaluate(e => e.textContent, it);
  if (t.includes('SVG')) { await it.click(); break; }
}
await sleep(900);
const svgOut = await page.evaluate(async () => {
  if (!window.__blob) return null;
  const txt = await window.__blob.text();
  return {
    size: window.__blob.size,
    type: window.__blob.type,
    hasCloud: txt.includes('云端服务'),
    hasDoc: txt.includes('文档记录'),
    hasMarker: txt.includes('marker-end'),
    bg: txt.includes('rect')
  };
});
ok('S21 导出 SVG 含新形状与文字',
   !!svgOut && svgOut.type.includes('svg') && svgOut.hasCloud && svgOut.hasDoc && svgOut.hasMarker,
   svgOut ? `${svgOut.size}B cloud=${svgOut.hasCloud} doc=${svgOut.hasDoc} arrow=${svgOut.hasMarker}` : 'null');

ok('S22 无 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(log.join('\n'));
const failed = log.filter(l => l.startsWith('FAIL'));
console.log(`\n${log.length - failed.length}/${log.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
