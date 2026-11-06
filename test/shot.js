/**
 * test/shot.js — 用 CDP 驱动真实浏览器跑完实验并截图（开发验证用）
 * 用法：node test/shot.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = 'C:\\Users\\lenovo\\WorkBuddy\\2026-11-04-10-31-23';
const OUT = path.join(ROOT, '.shots');
const PORT = 9333;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${path.join(ROOT, '.shots', 'profile')}`,
    '--window-size=1280,1100',
    'about:blank',
  ], { stdio: 'ignore' });

  await sleep(2500);

  // 获取 target
  const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到页面 target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  await new Promise((r) => ws.addEventListener('open', r));

  function send(method, params = {}) {
    const id = msgId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evalJS(expression, awaitPromise = false) {
    const res = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (res.result && res.result.exceptionDetails) {
      throw new Error('JS 异常：' + JSON.stringify(res.result.exceptionDetails));
    }
    return res.result && res.result.result ? res.result.result.value : undefined;
  }

  async function goto(url) {
    await send('Page.navigate', { url });
    await sleep(1200);
  }

  async function shot(name, fullPage = false) {
    const params = { format: 'png' };
    if (fullPage) params.captureBeyondViewport = true;
    const res = await send('Page.captureScreenshot', params);
    const buf = Buffer.from(res.result.data, 'base64');
    fs.writeFileSync(path.join(OUT, name), buf);
    console.log('  截图 →', name, '(' + Math.round(buf.length / 1024) + ' KB)');
  }

  await send('Page.enable');
  await send('Runtime.enable');
  // 一开始就固定视口，否则截图会是默认 500x320
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(200);

  /* ---------- 1. Flanker 介绍页 ---------- */
  console.log('[1] Flanker 介绍页');
  await goto('file:///' + ROOT.replace(/\\/g, '/') + '/flanker.html');
  await shot('flanker-intro.png');

  /* ---------- 2. Flanker 指导语（含眼动开关） ---------- */
  console.log('[2] Flanker 指导语');
  await evalJS(`
    document.getElementById('intro-next').click();
    document.getElementById('consent-check').checked = true;
    document.getElementById('consent-check').dispatchEvent(new Event('change'));
    document.getElementById('consent-next').click();
    document.getElementById('id-next').click();
    'ok'
  `);
  await sleep(300);
  await shot('flanker-instructions.png');

  /* ---------- 3. Flanker 正式刺激（深色 stage） ---------- */
  console.log('[3] Flanker 刺激呈现');
  await evalJS(`
    document.getElementById('inst-next').click();
    document.getElementById('practice-start').click();
    // 冻结在一个刺激上：清掉所有定时器后手动渲染
    setTimeout(() => {
      const stage = document.getElementById('formal-stage');
      stage.innerHTML = '<div class="flanker-letters">' +
        '<span style="color:#60a5fa">S</span>' +
        '<span style="color:#60a5fa">S</span>' +
        '<span style="color:#60a5fa">S</span>' +
        '<span style="color:#f1f5f9">H</span>' +
        '<span style="color:#60a5fa">S</span>' +
        '<span style="color:#60a5fa">S</span>' +
        '<span style="color:#60a5fa">S</span>' +
        '</div>';
    }, 100);
    'ok'
  `);
  await sleep(900);
  await shot('flanker-stimulus.png');

  /* ---------- 4. 跑完全部试次，截结果页 ---------- */
  console.log('[4] 自动跑完 96 试次 → 结果页');
  await goto('file:///' + ROOT.replace(/\\/g, '/') + '/flanker.html');

  await evalJS(`
    (async () => {
      // 加速所有定时器
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

      // 自动作答循环
      window.__done = false;
      const tick = () => {
        if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); }
        const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
        if (spans.length === 7) {
          const t = spans[3].textContent;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: KEY[t], bubbles: true }));
        }
        if ($('s-result').style.display === 'block') { window.__done = true; return; }
        origST(tick, 3);
      };
      origST(tick, 10);
      return 'kicked';
    })()
  `);

  // 等待完成
  for (let i = 0; i < 120; i++) {
    const done = await evalJS('!!window.__done');
    if (done) break;
    await sleep(500);
  }
  const finished = await evalJS('!!window.__done');
  console.log('  完成状态:', finished);

  await sleep(600);
  await shot('flanker-result.png');
  // 结果页完整长图
  const height = await evalJS('document.documentElement.scrollHeight');
  console.log('  页面高度:', height);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: Math.min(height, 4000), deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);
  await shot('flanker-result-full.png');
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false,
  });

  /* ---------- 5. Cleveland 图表三条件 ---------- */
  console.log('[5] Cleveland 三种图表条件');
  await goto('file:///' + ROOT.replace(/\\/g, '/') + '/cleveland.html');
  await evalJS(`
    const $ = (id) => document.getElementById(id);
    $('intro-next').click();
    $('consent-check').checked = true;
    $('consent-check').dispatchEvent(new Event('change'));
    $('consent-next').click();
    $('id-next').click();
    $('inst-next').click();
    $('practice-start').click();
    'ok'
  `);
  await sleep(800);
  await shot('cleveland-chart-random.png');

  /* ---------- 6. Cleveland 跑完 → 结果页 ---------- */
  console.log('[6] 自动跑完 48 试次 → 结果页');
  await goto('file:///' + ROOT.replace(/\\/g, '/') + '/cleveland.html');
  await evalJS(`
    (async () => {
      const origST = window.setTimeout;
      window.setTimeout = (fn, ms) => origST(fn, Math.min(ms || 0, 2));
      const $ = (id) => document.getElementById(id);
      $('intro-next').click();
      $('consent-check').checked = true;
      $('consent-check').dispatchEvent(new Event('change'));
      $('consent-next').click();
      $('id-next').click();
      $('inst-next').click();
      $('practice-start').click();

      window.__done = false;
      const tick = () => {
        if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); }
        const area = $('chart-area');
        const input = $('estimate-input');
        if (area.querySelector('svg') && input && !input.disabled && input.value === '') {
          // 模拟带有系统性偏差的估计：柱状图更准，饼图偏大
          input.value = String(20 + Math.floor(Math.random() * 45));
          $('submit-estimate').click();
        }
        if ($('s-result').style.display === 'block') { window.__done = true; return; }
        origST(tick, 3);
      };
      origST(tick, 10);
      return 'kicked';
    })()
  `);

  for (let i = 0; i < 120; i++) {
    const done = await evalJS('!!window.__done');
    if (done) break;
    await sleep(500);
  }
  console.log('  完成状态:', await evalJS('!!window.__done'));
  await sleep(600);
  await shot('cleveland-result.png');

  const h2 = await evalJS('document.documentElement.scrollHeight');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: Math.min(h2, 4000), deviceScaleFactor: 1, mobile: false,
  });
  await sleep(400);
  await shot('cleveland-result-full.png');

  ws.close();
  proc.kill();
  await sleep(400);
  console.log('\n全部截图完成 →', OUT);
}

main().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
