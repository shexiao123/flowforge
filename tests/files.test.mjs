/* 文件储存：多文件工作区、内容隔离、自动存盘、迁移、抽屉交互 */
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

await page.goto(PAGE_URL);
await sleep(700);

// ---------- 1. 首次打开自动建文件 ----------
const first = await page.evaluate(() => ({
  docs: FF.docs.length,
  name: FF.docs[0]?.name,
  active: !!FF.activeDocId,
  idx: !!localStorage.getItem('flowforge_docs_v1'),
  title: document.title,
  badge: document.querySelector('#tabBar .tab.on .tab-name')?.textContent
}));
ok('K1 首次打开自动建立一份文件并存索引',
  first.docs === 1 && first.active && first.idx && first.name === '示例 · 审批流程',
  JSON.stringify(first));
ok('K2 顶栏与标题显示当前文件名',
  first.badge === '示例 · 审批流程' && first.title.includes('示例 · 审批流程'),
  first.title);

// ---------- 2. 新建文件并切换 ----------
const docA = await page.evaluate(() => FF.activeDocId);
const newDoc = await page.evaluate(() => {
  const id = FF.createDoc('第二份图');
  return { id, docs: FF.docs.map(d => d.name), nodes: FF.state.nodes.length, active: FF.activeDocId };
});
ok('K3 新建文件后画布清空并切到新文件',
  newDoc.docs.length === 2 && newDoc.nodes === 0 && newDoc.active === newDoc.id,
  JSON.stringify(newDoc));

// ---------- 3. 内容互相隔离 ----------
await page.evaluate(() => {
  const n = FF.mkNode({ x: 0, y: 0, text: '只在第二份里' });
  FF.state.nodes.push(n);
  FF.render(); FF.flushSave();
});
await page.evaluate(id => FF.openDoc(id), docA);
const inA = await page.evaluate(() => FF.state.nodes.some(n => n.text === '只在第二份里'));
await page.evaluate(id => FF.openDoc(id), newDoc.id);
const inB = await page.evaluate(() => FF.state.nodes.some(n => n.text === '只在第二份里'));
ok('K4 两份文件的内容互不串台', inA === false && inB === true, `A=${inA} B=${inB}`);

// ---------- 4. 自动存盘（防抖后落到 localStorage） ----------
await page.evaluate(() => {
  FF.state.nodes[0].text = '自动存盘验证';
  FF.render();
  FF.saveLocal();
});
await sleep(400);
const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('flowforge_doc_v1_' + FF.activeDocId);
  return raw ? raw.includes('自动存盘验证') : false;
});
ok('K5 改动 400ms 内自动落到本地存档', persisted);

// ---------- 5. 重命名 ----------
const renamed = await page.evaluate(() => {
  const id = FF.docs.find(d => d.name === '第二份图').id;
  FF.renameDoc(id, '季度复盘');
  return { names: FF.docs.map(d => d.name), badge: document.querySelector('#tabBar .tab.on .tab-name').textContent };
});
ok('K6 重命名同步到索引与顶栏',
  renamed.names.includes('季度复盘') && renamed.badge === '季度复盘',
  JSON.stringify(renamed));

// 重名自动加序号：把另一份改成一模一样的名字
const dupName = await page.evaluate(() => {
  const other = FF.docs.find(d => d.name !== '季度复盘');
  FF.renameDoc(other.id, '季度复盘');
  return FF.docs.map(d => d.name);
});
ok('K7 重名自动加 (2) 后缀', dupName.filter(n => n.startsWith('季度复盘')).length === 2 && dupName.includes('季度复盘 (2)'),
  JSON.stringify(dupName));

// ---------- 6. 复制文件 ----------
const dup = await page.evaluate(() => {
  const src = FF.docs.find(d => d.name === '季度复盘');
  FF.duplicateDoc(src.id);
  const copy = FF.docs.find(d => d.name.includes('副本'));
  return {
    count: FF.docs.length,
    copyName: copy?.name,
    copyNodes: FF.state.nodes.length,
    isNewId: copy ? copy.id !== src.id : false,
    activeIsCopy: FF.activeDocId === copy?.id
  };
});
ok('K8 复制文件：内容带过去但 id 独立',
  dup.count === 3 && dup.copyNodes === 1 && dup.isNewId && dup.activeIsCopy,
  JSON.stringify(dup));

// ---------- 7. 抽屉交互 ----------
await page.click('#btnFiles');
await sleep(260);
const drawer = await page.evaluate(() => ({
  on: document.querySelector('#fileDrawer').classList.contains('on'),
  mask: document.querySelector('#drawerMask').classList.contains('on'),
  items: document.querySelectorAll('.fl-item').length,
  count: document.querySelector('#fdCount').textContent
}));
ok('K9 点「文件」打开抽屉并列出全部文件',
  drawer.on && drawer.mask && drawer.items === 3 && drawer.count === '3 份',
  JSON.stringify(drawer));

await page.type('#fdSearch', '季度');
await sleep(150);
const searched = await page.evaluate(() => document.querySelectorAll('.fl-item').length);
ok('K10 搜索框按关键词过滤', searched === 3, `「季度」匹配 ${searched} 条（共 3 份）`);

await page.evaluate(() => {
  const s = document.querySelector('#fdSearch');
  s.value = '不存在的名字';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(150);
const emptyHit = await page.evaluate(() => ({
  items: document.querySelectorAll('.fl-item').length,
  empty: !!document.querySelector('.fd-empty')
}));
ok('K11 无匹配时显示空状态', emptyHit.items === 0 && emptyHit.empty, JSON.stringify(emptyHit));

await page.evaluate(() => {
  const s = document.querySelector('#fdSearch');
  s.value = '';
  s.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(120);

// 点列表项切文件
await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('.fl-item'))
    .find(el => el.textContent.includes('季度复盘') && !el.textContent.includes('副本'));
  item.click();
});
await sleep(300);
const switched = await page.evaluate(() => ({
  active: FF.docs.find(d => d.id === FF.activeDocId)?.name,
  nodes: FF.state.nodes.length
}));
ok('K12 点列表项切换文件', switched.active === '季度复盘' && switched.nodes === 1, JSON.stringify(switched));

// Esc 关抽屉
await page.keyboard.press('Escape');
await sleep(200);
const closed = await page.evaluate(() => document.querySelector('#fileDrawer').classList.contains('on'));
ok('K13 Esc 关闭抽屉', closed === false);

// ---------- 8. 删除 ----------
const del = await page.evaluate(() => {
  window.confirm = () => true;   // 跳过确认框
  const target = FF.docs.find(d => d.name.includes('副本'));
  const before = FF.docs.length;
  FF.deleteDoc(target.id);
  return {
    before, after: FF.docs.length,
    stillThere: FF.docs.some(d => d.id === target.id),
    keyGone: localStorage.getItem('flowforge_doc_v1_' + target.id) === null,
    activeValid: FF.docs.some(d => d.id === FF.activeDocId)
  };
});
ok('K14 删除文件：索引、存档、活动指针一并收拾干净',
  del.after === del.before - 1 && !del.stillThere && del.keyGone && del.activeValid,
  JSON.stringify(del));

// 最后一个不许删
const lastOne = await page.evaluate(() => {
  window.confirm = () => true;
  while (FF.docs.length > 1) FF.deleteDoc(FF.docs[FF.docs.length - 1].id);
  FF.deleteDoc(FF.docs[0].id);
  return FF.docs.length;
});
ok('K15 至少保留一份文件', lastOne === 1, `剩余 ${lastOne}`);

// ---------- 9. 刷新恢复 ----------
const beforeReload = await page.evaluate(() => ({
  id: FF.activeDocId,
  name: FF.docs[0].name,
  nodes: FF.state.nodes.length
}));
await page.reload();
await sleep(600);
const afterReload = await page.evaluate(() => ({
  id: FF.activeDocId,
  name: FF.docs[0].name,
  nodes: FF.state.nodes.length,
  badge: document.querySelector('#tabBar .tab.on .tab-name').textContent
}));
ok('K16 刷新后回到上次的文件与内容',
  afterReload.id === beforeReload.id && afterReload.nodes === beforeReload.nodes && afterReload.badge === afterReload.name,
  JSON.stringify(afterReload));

// ---------- 10. 旧版单文档迁移 ----------
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('flowforge_v1', JSON.stringify({
    nodes: [{ id: 'old1', x: 0, y: 0, w: 160, h: 60, text: '旧版存档节点', shape: 'rect', fill: '', stroke: '', textColor: '', fontSize: 14 }],
    edges: [], notes: [], theme: 'dark', view: { tx: 0, ty: 0, k: 1 }
  }));
});
await page.reload();
await sleep(600);
const migrated = await page.evaluate(() => ({
  docs: FF.docs.length,
  name: FF.docs[0]?.name,
  text: FF.state.nodes[0]?.text,
  theme: document.documentElement.getAttribute('data-theme'),
  legacyGone: localStorage.getItem('flowforge_v1') === null
}));
ok('K17 旧版单文档自动迁移为一份文件（含主题）',
  migrated.docs === 1 && migrated.name === '我的流程图' && migrated.text === '旧版存档节点'
  && migrated.theme === 'dark' && migrated.legacyGone,
  JSON.stringify(migrated));

// ---------- 11. 导出带文件名 ----------
const payload = await page.evaluate(() => {
  const p = FF.exportPayload();
  return { app: p.app, name: p.name, hasNodes: Array.isArray(p.nodes), version: p.version };
});
ok('K18 导出载荷带文件名与版本号',
  payload.app === 'FlowForge' && payload.name === '我的流程图' && payload.hasNodes && payload.version === 2,
  JSON.stringify(payload));

// ---------- 12. 绑定磁盘句柄后真正写盘 ----------
const disk = await page.evaluate(async () => {
  window.__written = '';
  window.showSaveFilePicker = async () => ({
    name: '我的流程图.json',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async t => { window.__written = t; },
      close: async () => { window.__closed = true; }
    })
  });
  await FF.saveToDisk(false);
  if (!window.__written) return { wrote: false };
  const o = JSON.parse(window.__written);
  return {
    wrote: true, closed: !!window.__closed, name: o.name,
    nodes: o.nodes.length, version: o.version,
    badge: document.querySelector('#stSave').textContent,
    diskHint: document.querySelector('#fdDiskText').textContent
  };
});
ok('K19 保存到磁盘写出完整工程 JSON 并标记已绑定',
  disk.wrote && disk.closed && disk.name === '我的流程图' && disk.nodes === 1 && disk.version === 2
  && disk.badge === '已自动保存' && disk.diskHint.includes('已绑定'),
  JSON.stringify(disk));

// 不支持 API 的浏览器要退化成下载，且不抛错
const fallback = await page.evaluate(async () => {
  const saved = window.showSaveFilePicker;
  window.showSaveFilePicker = undefined;
  const fs = FF.fsSupported();
  let threw = null;
  try { await FF.saveToDisk(true); } catch (e) { threw = e.message; }
  window.showSaveFilePicker = saved;
  return { fs, threw, docs: FF.docs.length };
});
ok('K20 无 API 时降级下载、不报错', fallback.fs === false && fallback.threw === null && fallback.docs === 1,
  JSON.stringify(fallback));

ok('K21 全程无 JS 运行时错误', errors.length === 0, errors.join(' | '));

await browser.close();

const txt = log.join('\n');
console.log(txt);
console.log('\n--- errors ---\n' + (errors.length ? errors.join('\n') : '(none)'));
const failed = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\nRESULT: ${log.length - failed}/${log.length} passed`);
process.exit(failed ? 1 : 0);
