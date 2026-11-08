/**
 * test/shot-el.js — 截取指定元素的高清截图（开发验证用）
 * 用法：node test/shot-el.js <页面> <元素选择器> <输出名> [是否跑完实验]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = 'C:\\Users\\lenovo\\WorkBuddy\\2026-11-04-10-31-23';
const OUT = path.join(ROOT, '.shots');
const PORT = 9334;

const [page, selector, outName, runFlag] = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(OUT, 'profile-el')}`,
    '--window-size=1280,1200', 'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2200);

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));

  const send = (method, params = {}) => new Promise((resolve) => {
    const id = msgId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 1200, deviceScaleFactor: 2, mobile: false,
  });

  await send('Page.navigate', { url: 'file:///' + ROOT.replace(/\\/g, '/') + '/' + page });
  await sleep(1400);

  if (runFlag === 'formal') {
    // 进入试次界面，并循环提交直到遇到「带刻度饼图」条件
    await evalJS(`
      (function(){
        const $ = (id) => document.getElementById(id);
        $('intro-next').click();
        $('consent-check').checked = true;
        $('consent-check').dispatchEvent(new Event('change'));
        $('consent-next').click();
        $('id-next').click();
        $('inst-next').click();
        $('practice-start').click();
        window.__tryFind = function(){
          const $ = (id) => document.getElementById(id);
          if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); return false; }
          const area = $('chart-area'), input = $('estimate-input');
          if (area.querySelector('svg')) {
            if (/\\.25/.test(area.innerHTML)) return true;
            input.value = '50';
            $('submit-estimate').click();
          }
          return false;
        };
        return 'ok';
      })()
    `);
    let found = false;
    for (let i = 0; i < 80; i++) {
      found = await evalJS('window.__tryFind()');
      if (found) break;
      await sleep(350);
    }
    console.log('  找到带刻度条件:', found);
    await sleep(400);
  }

  if (runFlag === 'run') {
    // 自动跑完实验
    await evalJS(`
      (async () => {
        const origST = window.setTimeout;
        window.setTimeout = (fn, ms) => origST(fn, Math.min(ms || 0, 2));
        const $ = (id) => document.getElementById(id);
        const KEY = { H:'f', K:'f', S:'j', C:'j' };
        $('intro-next').click();
        $('consent-check').checked = true;
        $('consent-check').dispatchEvent(new Event('change'));
        $('consent-next').click();
        $('id-next').click();
        $('inst-next').click();
        $('practice-start').click();
        window.__done = false;
        const isC = ${page.includes('cleveland') ? 'true' : 'false'};
        const tick = () => {
          if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); }
          if (isC) {
            const area = $('chart-area'); const input = $('estimate-input');
            if (area.querySelector('svg') && input && !input.disabled && input.value === '') {
              input.value = String(20 + Math.floor(Math.random() * 45));
              $('submit-estimate').click();
            }
          } else {
            const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
            if (spans.length === 7) {
              const t = spans[3].textContent;
              document.dispatchEvent(new KeyboardEvent('keydown', { key: KEY[t], bubbles: true }));
            }
          }
          if ($('s-result').style.display === 'block') { window.__done = true; return; }
          origST(tick, 3);
        };
        origST(tick, 10);
      })()
    `);
    for (let i = 0; i < 120; i++) {
      if (await evalJS('!!window.__done')) break;
      await sleep(400);
    }
    await sleep(500);
  }

  // 取元素位置
  const box = await evalJS(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
    })()
  `);

  if (!box) { console.log('元素未找到：' + selector); ws.close(); proc.kill(); return; }

  await sleep(300);
  const res = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 2 },
  });

  fs.writeFileSync(path.join(OUT, outName), Buffer.from(res.result.data, 'base64'));
  console.log('截图 →', outName, Math.round(box.w) + 'x' + Math.round(box.h));

  ws.close();
  proc.kill();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
