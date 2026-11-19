/* 工作台：总览、缩略图、搜索排序、卡片跳转、标签栏、模板入口 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = pathToFileURL(path.join(ROOT, 'index.html')).href;

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
  console.error('找不到 Chrome，请设置环境变量 CHROME_PATH');
  process.exit(2);
}

const log = [];
const ok = (n, c, e = '') => log.push(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  → ' + e : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--allow-file-access-from-files', '--no-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', e => errors.push(e.message));
page.on('dialog', d => d.dismiss());

// 不带 hash 打开 → 应该落在工作台
await page.goto(BASE);
await sleep(700);

// ---------- 1. 默认视图 ----------
const boot = await page.evaluate(() => ({
  view: FF.view,
  body: document.body.dataset.view,
  wsVisible: getComputedStyle(document.querySelector('#workspace')).display !== 'none',
  editorHidden: getComputedStyle(document.querySelector('#editorApp')).display === 'none',
  cards: document.querySelectorAll('.doc-card').length,
  docs: FF.docs.length,
  stats: document.querySelector('#wsStats').textContent.replace(/\s+/g, ' ').trim()
}));
ok('W1 直接打开落在工作台，编辑器隐藏',
  boot.view === 'workspace' && boot.body === 'workspace' && boot.wsVisible && boot.editorHidden,
  JSON.stringify({ view: boot.view, editorHidden: boot.editorHidden }));
ok('W2 工作台卡片数量与存档一致',
  boot.cards === boot.docs && boot.docs === 1, `cards=${boot.cards} docs=${boot.docs}`);
ok('W3 统计行给出文件数与节点数',
  /1\s*份文件/.test(boot.stats) && /个节点/.test(boot.stats), boot.stats);

// ---------- 2. 缩略图 ----------
const thumb = await page.evaluate(() => {
  const box = document.querySelector('.doc-card .dc-thumb');
  const svg = box.querySelector('svg');
  return {
    hasSvg: !!svg,
    shapes: svg ? svg.querySelectorAll('path,rect,polygon,circle,ellipse').length : 0,
    lines: svg ? svg.querySelectorAll('line').length : 0,
    vb: svg ? svg.getAttribute('viewBox') : ''
  };
});
ok('W4 卡片缩略图渲染出节点形状与连线',
  thumb.hasSvg && thumb.shapes >= 5 && thumb.lines >= 4, JSON.stringify(thumb));

// ---------- 3. 多文件 + 搜索 + 排序 ----------
await page.evaluate(() => {
  FF.createDoc('渠道分析');
  FF.state.nodes = [
    FF.mkNode({ x: 0, y: 0, text: '自然流量' }),
    FF.mkNode({ x: 220, y: 0, text: '付费流量' }),
    FF.mkNode({ x: 440, y: 0, text: '转化' })
  ];
  FF.render(); FF.flushSave();
  FF.createDoc('留存曲线');
  FF.state.nodes = [FF.mkNode({ x: 0, y: 0, text: '次日' }), FF.mkNode({ x: 220, y: 0, text: '7日' })];
  FF.render(); FF.flushSave();
  FF.setView('workspace');
});
await sleep(400);

const three = await page.evaluate(() => ({
  cards: document.querySelectorAll('.doc-card').length,
  docs: FF.docs.length,
  nodes: Array.from(document.querySelectorAll('.doc-meta')).length
}));
ok('W5 新建文件后工作台立即多出卡片', three.cards === 3 && three.docs === 3, JSON.stringify(three));

await page.type('#wsSearch', '渠道');
await sleep(200);
const filtered = await page.evaluate(() => ({
  n: document.querySelectorAll('.doc-card').length,
  name: document.querySelector('.doc-card .dc-name')?.textContent
}));
ok('W6 搜索实时过滤', filtered.n === 1 && filtered.name === '渠道分析', JSON.stringify(filtered));

await page.evaluate(() => {
  const s = document.querySelector('#wsSearch');
  s.value = '';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(160);

await page.select('#wsSort', 'name');
await sleep(200);
const sorted = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.doc-card .dc-name')).map(e => e.textContent));
const expectSorted = sorted.slice().sort((a, b) => a.localeCompare(b, 'zh'));
ok('W7 按名称排序', JSON.stringify(sorted) === JSON.stringify(expectSorted), sorted.join(' / '));

await page.select('#wsSort', 'size');
await sleep(200);
const bySize = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.doc-card')).map(c => ({
    name: c.querySelector('.dc-name').textContent,
    n: parseInt(c.querySelector('.dc-meta').textContent, 10) || 0
  })));
ok('W8 按节点数排序', bySize.every((x, i) => i === 0 || bySize[i - 1].n >= x.n),
  bySize.map(x => x.name + ':' + x.n).join(' '));

await page.select('#wsSort', 'recent');
await sleep(150);

// ---------- 4. 卡片进编辑器 ----------
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.doc-card'))
    .find(c => c.querySelector('.dc-name').textContent === '渠道分析');
  card.click();
});
await sleep(500);
const entered = await page.evaluate(() => ({
  view: FF.view,
  body: document.body.dataset.view,
  active: FF.docs.find(d => d.id === FF.activeDocId)?.name,
  nodes: FF.state.nodes.length,
  tabs: document.querySelectorAll('#tabBar .tab').length,
  tabName: document.querySelector('#tabBar .tab.on .tab-name')?.textContent,
  canvasW: document.querySelector('#stage').getBoundingClientRect().width
}));
ok('W9 点卡片进入编辑器并载入对应文件',
  entered.view === 'editor' && entered.active === '渠道分析' && entered.nodes === 3 && entered.canvasW > 400,
  JSON.stringify(entered));
ok('W10 标签栏显示当前文件并高亮',
  entered.tabs >= 1 && entered.tabName === '渠道分析', JSON.stringify({ tabs: entered.tabs, tabName: entered.tabName }));

// ---------- 5. 多标签 ----------
await page.evaluate(() => {
  FF.openDoc(FF.docs.find(d => d.name === '留存曲线').id);
});
await sleep(350);
const twoTabs = await page.evaluate(() => ({
  tabs: Array.from(document.querySelectorAll('#tabBar .tab')).map(t => t.querySelector('.tab-name').textContent),
  on: document.querySelector('#tabBar .tab.on .tab-name')?.textContent,
  nodes: FF.state.nodes.length
}));
ok('W11 打开第二个文件形成两个标签',
  twoTabs.tabs.length === 2 && twoTabs.on === '留存曲线' && twoTabs.nodes === 2,
  JSON.stringify(twoTabs));

// 点标签切换
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('#tabBar .tab'))
    .find(x => x.querySelector('.tab-name').textContent === '渠道分析');
  t.click();
});
await sleep(300);
const switched = await page.evaluate(() => ({
  active: FF.docs.find(d => d.id === FF.activeDocId)?.name,
  nodes: FF.state.nodes.length
}));
ok('W12 点标签切回另一份文件', switched.active === '渠道分析' && switched.nodes === 3, JSON.stringify(switched));

// 关闭标签不删文件
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('#tabBar .tab'))
    .find(x => x.querySelector('.tab-name').textContent === '渠道分析');
  t.querySelector('[data-close]').click();
});
await sleep(300);
const closedOne = await page.evaluate(() => ({
  tabs: document.querySelectorAll('#tabBar .tab').length,
  docs: FF.docs.length,
  active: FF.docs.find(d => d.id === FF.activeDocId)?.name
}));
ok('W13 关闭标签只收标签，不删文件',
  closedOne.tabs === 1 && closedOne.docs === 3 && closedOne.active === '留存曲线',
  JSON.stringify(closedOne));

// 关掉最后一个 → 回工作台
await page.evaluate(() => document.querySelector('#tabBar .tab [data-close]').click());
await sleep(400);
const backHome = await page.evaluate(() => ({
  view: FF.view,
  cards: document.querySelectorAll('.doc-card').length,
  tabs: document.querySelectorAll('#tabBar .tab').length
}));
ok('W14 关掉最后一个标签回到工作台',
  backHome.view === 'workspace' && backHome.cards === 3 && backHome.tabs === 0, JSON.stringify(backHome));

// ---------- 6. 品牌区返回 ----------
await page.evaluate(() => document.querySelector('.doc-card').click());
await sleep(400);
await page.click('#btnHome');
await sleep(350);
ok('W15 编辑器点品牌区回到工作台', await page.evaluate(() => FF.view) === 'workspace');

// ---------- 7. 模板入口 ----------
const beforeTpl = await page.evaluate(() => FF.docs.length);
await page.evaluate(() => document.querySelector('[data-tpl="pipeline"]').click());
await sleep(500);
const fromTpl = await page.evaluate(() => ({
  view: FF.view,
  docs: FF.docs.length,
  active: FF.docs.find(d => d.id === FF.activeDocId)?.name,
  nodes: FF.state.nodes.length,
  edges: FF.state.edges.length
}));
ok('W16 从模板创建新文件并进入编辑器',
  fromTpl.view === 'editor' && fromTpl.docs === beforeTpl + 1
  && fromTpl.active === '数据管道' && fromTpl.nodes === 6 && fromTpl.edges > 0,
  JSON.stringify(fromTpl));

// ---------- 8. 卡片菜单重命名 ----------
await page.evaluate(() => FF.setView('workspace'));
await sleep(300);
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.doc-card'))
    .find(c => c.querySelector('.dc-name').textContent === '数据管道');
  card.querySelector('.dc-more').click();
});
await sleep(250);
const menuOpen = await page.evaluate(() => ({
  on: document.querySelector('#menuLayer').classList.contains('on'),
  items: Array.from(document.querySelectorAll('#menu .menu-item')).map(e => e.textContent)
}));
ok('W17 卡片「⋯」弹出操作菜单',
  menuOpen.on && menuOpen.items.some(t => t.includes('重命名')) && menuOpen.items.some(t => t.includes('删除')),
  menuOpen.items.join(' / '));

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('#menu .menu-item'))
    .find(e => e.textContent.includes('重命名'));
  btn.click();
});
await sleep(300);
await page.evaluate(() => {
  const inp = document.querySelector('.doc-card .dc-name input');
  inp.value = '数据管道 · 2026Q4';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});
await sleep(350);
const renamed = await page.evaluate(() => ({
  names: Array.from(document.querySelectorAll('.doc-card .dc-name')).map(e => e.textContent),
  docs: FF.docs.map(d => d.name)
}));
ok('W18 卡片内联改名生效',
  renamed.docs.includes('数据管道 · 2026Q4') && renamed.names.includes('数据管道 · 2026Q4'),
  renamed.docs.join(' / '));

// ---------- 9. 直达编辑器 ----------
await page.goto(BASE + '#editor');
await page.reload();     // 同一地址换 hash 不会重载，手动刷一次验证启动路径
await sleep(700);
const direct = await page.evaluate(() => ({
  view: FF.view,
  canvas: document.querySelector('#stage').getBoundingClientRect().width
}));
ok('W19 带 #editor 直接进画布', direct.view === 'editor' && direct.canvas > 400, JSON.stringify(direct));

// 回到工作台后刷新，仍落在工作台
await page.evaluate(() => FF.setView('workspace'));
await sleep(200);
await page.reload();
await sleep(600);
ok('W20 刷新后回到工作台', await page.evaluate(() => FF.view) === 'workspace');

ok('W21 全程无 JS 运行时错误', errors.length === 0, errors.join(' | '));

await browser.close();

console.log(log.join('\n'));
console.log('\n--- errors ---\n' + (errors.length ? errors.join('\n') : '(none)'));
const failed = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\nRESULT: ${log.length - failed}/${log.length} passed`);
process.exit(failed ? 1 : 0);
