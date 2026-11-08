/**
 * test/e2e.js — 端到端 DOM 测试（仅用于开发验证，不参与页面运行）
 *
 * 通过 jsdom 真实执行页面脚本，跑完两个实验的完整流程：
 *   阶段切换 → 练习 → 96/48 个正式试次（自动按键/输入）→ 结果渲染
 * 并断言关键数据与 DOM 结果。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;

function ok(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.log('  ✗ ' + msg);
    failures++;
  }
}

/** 把 HTML 中的外部脚本替换为内联，便于 jsdom 同步执行 */
function inlineScripts(html) {
  return html.replace(
    /<script src="([^"]+)"><\/script>/g,
    (m, src) => {
      const file = path.join(ROOT, src);
      if (!fs.existsSync(file)) return '';
      const code = fs.readFileSync(file, 'utf8');
      return '<script>\n' + code + '\n</script>';
    }
  );
}

/** 等待 jsdom 触发 DOMContentLoaded 并完成 init() */
function waitReady(dom) {
  const { window } = dom;
  return new Promise((resolve) => {
    if (window.document.readyState === 'complete') { resolve(); return; }
    window.document.addEventListener('DOMContentLoaded', () => resolve());
    // 兜底：jsdom 某些情况下 readyState 已为 interactive
    global.setTimeout(() => resolve(), 100);
  });
}

/**
 * 构建 DOM 环境
 * @param {string} page 页面文件名
 * @param {function(string):string} [patch] 对内联后的 HTML 做文本替换（用于改配置）
 */
function createDom(page, patch, opts) {
  let html = inlineScripts(fs.readFileSync(path.join(ROOT, page), 'utf8'));
  if (patch) html = patch(html);

  const customFetch = (opts && opts.fetch) || null;

  const dom = new JSDOM(html, {
    url: 'https://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      // ---- mock 计时器：改为手动队列 ----
      let timerId = 1;
      const queue = new Map();
      window.__timerQueue = queue;

      window.setTimeout = (fn, ms) => {
        const id = timerId++;
        queue.set(id, { fn, ms });
        return id;
      };
      window.clearTimeout = (id) => { queue.delete(id); };

      // ---- mock performance.now：每次调用递增，制造可区分的 RT ----
      let t = 1000;
      Object.defineProperty(window.performance, 'now', {
        value: () => (t += 1.7),
        configurable: true,
      });

      // ---- mock 浏览器 API ----
      window.alert = (msg) => { window.__lastAlert = msg; };
      window.scrollTo = () => {};
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.fetch = customFetch || (() => Promise.reject(new Error('network disabled in test')));
    },
  });

  return dom;
}

/**
 * 执行队列中的定时器回调；每执行一个后调用 onTick 允许注入交互。
 */
function flush(dom, onTick, maxSteps = 200000) {
  const queue = dom.window.__timerQueue;
  let steps = 0;
  while (queue.size > 0 && steps < maxSteps) {
    steps++;
    // 取最小 ms 的先执行（近似真实时序）
    let firstId = null, firstMs = Infinity;
    for (const [id, item] of queue) {
      if (item.ms < firstMs) { firstMs = item.ms; firstId = id; }
    }
    const item = queue.get(firstId);
    queue.delete(firstId);
    item.fn();

    if (onTick) onTick();
  }
  return steps;
}

/* ============================================================
   测试一：Flanker 完整流程
   ============================================================ */
async function testFlanker() {
  console.log('\n[实验一] Flanker 端到端');
  const dom = createDom('flanker.html');
  await waitReady(dom);
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  // 初始化
  ok(!!$('stepper') && $('stepper').children.length === 7, '步骤条渲染 7 步');
  ok($('s-intro').style.display === 'block', '初始显示介绍页');

  // 介绍 → 同意
  $('intro-next').click();
  ok($('s-consent').style.display === 'block', '进入知情同意');

  // 未勾选时按钮禁用
  ok($('consent-next').disabled === true, '未同意时「继续」禁用');
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  ok($('consent-next').disabled === false, '勾选后「继续」可用');

  $('consent-next').click();
  ok($('s-id').style.display === 'block', '进入匿名编号');
  ok(/^P[A-Z0-9]+$/.test($('pid-input').value), '自动生成匿名编号：' + $('pid-input').value);

  $('id-next').click();
  ok($('s-instructions').style.display === 'block', '进入指导语');

  // 眼动开关在 jsdom 中应降级为不可用
  ok($('gaze-toggle').disabled === true, '无摄像头环境下眼动开关自动禁用（优雅降级）');

  $('inst-next').click();
  ok($('s-practice').style.display === 'block', '进入练习引导');

  // 练习
  $('practice-start').click();
  ok($('s-formal').style.display === 'block', '进入试次呈现');

  // 自动作答：读到中间字母就按对应键；练习结束后自动进入正式实验
  const KEY_MAP = { H: 'f', K: 'f', S: 'j', C: 'j' };
  function answerIfStimulus() {
    // 练习完成 → 点击进入正式实验
    if ($('s-practice-done').style.display === 'block') {
      $('formal-start').click();
      return;
    }
    const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      const target = spans[3].textContent;
      const key = KEY_MAP[target];
      doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
    }
  }

  flush(dom, answerIfStimulus);

  ok($('s-result').style.display === 'block', '练习与正式试次跑完后进入结果页');

  // 校验数据：从 localStorage 读取保存的记录
  const raw = window.localStorage.getItem('engpsy_hw2_flanker_' + $('pid-input').value);
  ok(!!raw, '结果已保存到 localStorage');
  if (raw) {
    const rec = JSON.parse(raw);
    ok(rec.trials.length === 96, '正式试次为 96（实际 ' + rec.trials.length + '）');
    ok(rec.experiment === 'flanker_improved', '实验标识正确：' + rec.experiment);

    // 条件平衡
    const cnt = {};
    rec.trials.forEach((t) => { cnt[t.cond] = (cnt[t.cond] || 0) + 1; });
    const all16 = Object.values(cnt).every((v) => v === 16) && Object.keys(cnt).length === 6;
    ok(all16, '六个条件各 16 试次');

    // 每目标字母 24 次
    const tc = {};
    rec.trials.forEach((t) => { tc[t.target] = (tc[t.target] || 0) + 1; });
    ok(Object.values(tc).every((v) => v === 24), '四个目标字母各 24 次');

    // 按键正确性：应全部正确（测试按正确键作答）
    const correctRate = rec.trials.filter((t) => t.correct).length / rec.trials.length;
    ok(correctRate > 0.95, '按键与目标映射一致（正确率 ' + (correctRate * 100).toFixed(0) + '%）');

    // 侧翼类型合法性
    const badFlank = rec.trials.filter((t) => {
      const sameKey = KEY_MAP[t.flankLetter] === KEY_MAP[t.target];
      if (t.flankType === 'compatible') return !sameKey || t.flankLetter === t.target;
      if (t.flankType === 'incompatible') return sameKey;
      if (t.flankType === 'congruent') return t.flankLetter !== t.target;
      return true;
    });
    ok(badFlank.length === 0, '侧翼类型与按键关系全部正确');
  }

  // 结果页关键元素
  ok($('result-body').querySelectorAll('.kpi').length === 4, '结果页渲染 4 个 KPI 卡片');
  ok(!!$('eff-chart') && $('eff-chart').querySelector('svg') !== null, '条件均值图已渲染 SVG');
  ok(!!$('forest-chart') && $('forest-chart').querySelector('svg') !== null, '森林图（预测 vs 实测）已渲染');
  ok($('result-body').querySelectorAll('.hypo').length === 3, '渲染 3 条假设检验');

  // 已配置项目码时显示提交按钮；网络不可用时如实报错，数据仍在本地
  await new Promise((r) => global.setTimeout(r, 80));
  ok($('upload-now').style.display !== 'none', '已配置项目码时显示提交按钮');
  ok(/提交失败/.test($('upload-status').textContent), '网络不可用时如实提示提交失败');

  dom.window.close();
}

/* ============================================================
   测试二：Cleveland–McGill 完整流程
   ============================================================ */
async function testCleveland() {
  console.log('\n[实验二] Cleveland–McGill 端到端');
  const dom = createDom('cleveland.html');
  await waitReady(dom);
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  ok(!!$('stepper') && $('stepper').children.length === 7, '步骤条渲染 7 步');
  $('intro-next').click();
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  $('consent-next').click();
  ok($('s-id').style.display === 'block', '进入匿名编号');
  $('id-next').click();
  ok($('s-instructions').style.display === 'block', '进入指导语');
  $('inst-next').click();
  $('practice-start').click();
  ok($('s-formal').style.display === 'block', '进入试次呈现');

  // 自动作答：图表出现后填入估计值；练习结束后自动进入正式实验
  let sawScaleCondition = false;
  function answerIfChart() {
    if ($('s-practice-done').style.display === 'block') {
      $('formal-start').click();
      return;
    }
    const area = $('chart-area');
    const input = $('estimate-input');
    if (area.querySelector('svg') && input && !input.disabled && input.value === '') {
      // 检查是否为带刻度条件（含 .25 / .5 / .75 标签）
      if (/.25/.test(area.innerHTML)) sawScaleCondition = true;
      input.value = String(30 + Math.floor(Math.random() * 40));
      $('submit-estimate').click();
    }
  }

  flush(dom, answerIfChart);

  ok($('s-result').style.display === 'block', '全部试次完成后进入结果页');
  ok(sawScaleCondition, '正式/练习中出现了带 .25/.5/.75 刻度的饼图条件');

  const pid = $('pid-input').value;
  const raw = window.localStorage.getItem('engpsy_hw2_cleveland_' + pid);
  ok(!!raw, '结果已保存到 localStorage');
  if (raw) {
    const rec = JSON.parse(raw);
    ok(rec.trials.length === 48, '正式试次为 48（实际 ' + rec.trials.length + '）');
    ok(rec.experiment === 'cleveland_improved', '实验标识正确：' + rec.experiment);

    const cnt = {};
    rec.trials.forEach((t) => { cnt[t.condition] = (cnt[t.condition] || 0) + 1; });
    ok(Object.keys(cnt).length === 3 && Object.values(cnt).every((v) => v === 16),
      '三个条件各 16 试次');

    // 误差计算校验
    const bad = rec.trials.filter((t) => {
      const expectAbs = Math.abs(t.estimate - t.truePct);
      const expectLog = Math.log2(expectAbs + 0.125);
      return Math.abs(t.absErr - expectAbs) > 1e-6 || Math.abs(t.logAbsErr - expectLog) > 1e-6;
    });
    ok(bad.length === 0, '绝对误差与 log₂(误差+1/8) 计算全部正确');

    // 真实百分比合理
    const badPct = rec.trials.filter((t) => t.truePct <= 0 || t.truePct >= 100);
    ok(badPct.length === 0, '真实百分比均在 (0,100) 内');

    // 较小值索引与最大索引不同
    const sameIdx = rec.trials.filter((t) => t.maxIdx === t.smallIdx);
    ok(sameIdx.length === 0, '「最大」与「较小」指向不同元素');

    // 数值唯一性
    const dup = rec.trials.filter((t) => new Set(t.vals).size !== 5);
    ok(dup.length === 0, '每试次五个数值互不相同');
  }

  ok($('result-body').querySelectorAll('.kpi').length === 4, '结果页渲染 4 个 KPI 卡片');
  ok(!!$('err-chart') && $('err-chart').querySelector('svg') !== null, '误差柱状图已渲染');
  ok(!!$('forest-chart') && $('forest-chart').querySelector('svg') !== null, '森林图已渲染');

  dom.window.close();
}

/* ============================================================
   测试三：精简会话长度（每条件 12 次）
   ============================================================ */
async function testShortSession() {
  console.log('\n[会话长度] 精简模式（每条件 12 次）');

  // ---- Flanker：96 → 72，每目标 24 → 18 ----
  const patch = (html) => html.replace("mode: 'standard'", "mode: 'short'");
  let dom = createDom('flanker.html', patch);
  await waitReady(dom);
  let { window } = dom;
  let doc = window.document;
  let $ = (id) => doc.getElementById(id);

  ok(/72 个正式试次/.test($('intro-trials').textContent), '介绍页显示 72 个正式试次');

  $('intro-next').click();
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  $('consent-next').click();
  $('id-next').click();
  $('inst-next').click();
  $('practice-start').click();

  const KEY_MAP = { H: 'f', K: 'f', S: 'j', C: 'j' };
  flush(dom, () => {
    if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); return; }
    const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      doc.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });

  let raw = window.localStorage.getItem('engpsy_hw2_flanker_' + $('pid-input').value);
  ok(!!raw, '精简模式数据已保存');
  if (raw) {
    const rec = JSON.parse(raw);
    ok(rec.trials.length === 72, '正式试次为 72（实际 ' + rec.trials.length + '）');
    ok(rec.session.mode === 'short' && rec.session.perCondition === 12, '记录含 session 字段');
    const cnt = {};
    rec.trials.forEach((t) => { cnt[t.cond] = (cnt[t.cond] || 0) + 1; });
    ok(Object.keys(cnt).length === 6 && Object.values(cnt).every((v) => v === 12), '六个条件各 12 试次');
    const tc = {};
    rec.trials.forEach((t) => { tc[t.target] = (tc[t.target] || 0) + 1; });
    ok(Object.values(tc).every((v) => v === 18), '四个目标字母各 18 次（仍完全平衡）');
  }
  dom.window.close();

  // ---- Cleveland：48 → 36 ----
  dom = createDom('cleveland.html', patch);
  await waitReady(dom);
  window = dom.window;
  doc = window.document;
  $ = (id) => doc.getElementById(id);

  ok(/36 个正式试次/.test($('intro-trials').textContent), '介绍页显示 36 个正式试次');

  $('intro-next').click();
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  $('consent-next').click();
  $('id-next').click();
  $('inst-next').click();
  $('practice-start').click();

  flush(dom, () => {
    if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); return; }
    const area = $('chart-area');
    const input = $('estimate-input');
    if (area.querySelector('svg') && input && !input.disabled && input.value === '') {
      input.value = '40';
      $('submit-estimate').click();
    }
  });

  raw = window.localStorage.getItem('engpsy_hw2_cleveland_' + $('pid-input').value);
  ok(!!raw, '精简模式数据已保存');
  if (raw) {
    const rec = JSON.parse(raw);
    ok(rec.trials.length === 36, '正式试次为 36（实际 ' + rec.trials.length + '）');
    const cnt = {};
    rec.trials.forEach((t) => { cnt[t.condition] = (cnt[t.condition] || 0) + 1; });
    ok(Object.keys(cnt).length === 3 && Object.values(cnt).every((v) => v === 12), '三个条件各 12 试次');
  }
  dom.window.close();
}

/* ============================================================
   测试四：提交载荷与接口返回处理
   ============================================================ */
async function testUpload() {
  console.log('\n[接口] 提交载荷结构与返回处理');

  const captured = [];
  const dom = createDom('flanker.html', null, {
    fetch: (url, init) => {
      // 结果页会读取全体记录（GET）；本用例只关心 POST 载荷
      if (!init || !init.body) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ ok: true, records: [] })),
        });
      }
      captured.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true, record_id: 7, participants: 3 })),
      });
    },
  });
  await waitReady(dom);
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  $('intro-next').click();
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  $('consent-next').click();
  $('id-next').click();
  $('inst-next').click();
  $('practice-start').click();

  const KEY_MAP = { H: 'f', K: 'f', S: 'j', C: 'j' };
  flush(dom, () => {
    if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); return; }
    const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      doc.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });

  await new Promise((r) => global.setTimeout(r, 80));

  ok(captured.length === 1, '每名被试只提交一次（实际 ' + captured.length + ' 次）');
  const req = captured[0] || { body: {} };
  const p = req.body;

  ok(/\/api\/hw2\/submit$/.test(req.url || ''), '提交到 /api/hw2/submit');
  ok(p.project === 'U9VNVY', 'project 为六位项目码（' + p.project + '）');
  ok(/^[a-z0-9_-]+$/.test(p.experiment || ''), 'experiment 仅含小写字母/数字/_（' + p.experiment + '）');
  ok(typeof p.participant === 'string' && p.participant.length > 0, 'participant 为匿名编号');
  ok(Array.isArray(p.trials) && p.trials.length === 96, 'trials 为 96 个试次');
  ok(p.meta && typeof p.meta.ua === 'string', '含 meta（ua / 视口 / 会话长度）');

  // 逐字段校验类型约束：数字、字符串(≤2000)、布尔、数字数组(≤500)，每试次 ≤40 字段
  const bad = [];
  p.trials.forEach((t, i) => {
    const keys = Object.keys(t);
    if (keys.length > 40) bad.push('试次 ' + i + ' 字段数 ' + keys.length + ' > 40');
    keys.forEach((k) => {
      const v = t[k];
      const okType = v === null || typeof v === 'number' || typeof v === 'string'
        || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => typeof x === 'number'));
      if (!okType) bad.push(k + ' 类型 ' + (Array.isArray(v) ? 'array' : typeof v));
      if (typeof v === 'string' && v.length > 2000) bad.push(k + ' 字符串超长');
      if (Array.isArray(v) && v.length > 500) bad.push(k + ' 数组超长');
    });
  });
  ok(bad.length === 0, '试次字段全部符合接口类型约束' + (bad.length ? '：' + bad.slice(0, 3).join('; ') : ''));

  const size = Buffer.byteLength(JSON.stringify(p), 'utf8');
  ok(size < 256 * 1024, '请求体 ' + (size / 1024).toFixed(1) + ' KB，未超 256 KB');

  await new Promise((r) => global.setTimeout(r, 40));
  const status = $('upload-status').textContent;
  ok(/已提交/.test(status), '成功后提示已提交');
  ok(/3 名被试/.test(status), '显示后台累计被试数');
  dom.window.close();

  // ---- 后台返回 ok:false（如项目码写错）时不能误报成功 ----
  const dom2 = createDom('flanker.html', null, {
    fetch: () => Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ ok: false, msg: '项目码不存在' })),
    }),
  });
  await waitReady(dom2);
  const w2 = dom2.window;
  const d2 = w2.document;
  const $2 = (id) => d2.getElementById(id);

  $2('intro-next').click();
  $2('consent-check').checked = true;
  $2('consent-check').dispatchEvent(new w2.Event('change'));
  $2('consent-next').click();
  $2('id-next').click();
  $2('inst-next').click();
  $2('practice-start').click();

  flush(dom2, () => {
    if ($2('s-practice-done').style.display === 'block') { $2('formal-start').click(); return; }
    const spans = $2('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      d2.dispatchEvent(new w2.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });
  await new Promise((r) => global.setTimeout(r, 120));

  const st2 = $2('upload-status').textContent;
  ok(/提交失败/.test(st2) && /项目码不存在/.test(st2), '后台 ok:false 时如实报错并带上原因');
  ok(!!w2.localStorage.getItem('engpsy_hw2_flanker_' + $2('pid-input').value), '失败时数据仍保存在本地');
  dom2.window.close();

  // ---- warnings 为对象时，不能显示成 [object Object] ----
  const dom3 = createDom('flanker.html', null, {
    fetch: () => Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        ok: true, record_id: 9, participants: 4,
        warnings: { meta: '对象已转为 JSON 字符串' },
      })),
    }),
  });
  await waitReady(dom3);
  const w3 = dom3.window;
  const d3 = w3.document;
  const $3 = (id) => d3.getElementById(id);

  $3('intro-next').click();
  $3('consent-check').checked = true;
  $3('consent-check').dispatchEvent(new w3.Event('change'));
  $3('consent-next').click();
  $3('id-next').click();
  $3('inst-next').click();
  $3('practice-start').click();

  flush(dom3, () => {
    if ($3('s-practice-done').style.display === 'block') { $3('formal-start').click(); return; }
    const spans = $3('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      d3.dispatchEvent(new w3.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });
  await new Promise((r) => global.setTimeout(r, 120));

  const st3 = $3('upload-status').textContent;
  ok(/meta：对象已转为 JSON 字符串/.test(st3), 'warnings 为对象时转为可读文本');
  ok(!/\[object Object\]/.test(st3), '不出现 [object Object]');
  dom3.window.close();
}

/* ============================================================
   测试五：全体结果（读取已提交的匿名记录）
   ============================================================ */
function fakeFlankerRecords(n, perCond) {
  // 构造 n 名被试的记录：不相容 640ms、相容 510ms、相同 500ms；异色时干扰更小
  const recs = [];
  for (let i = 1; i <= n; i++) {
    const trials = [];
    ['congruent', 'compatible', 'incompatible'].forEach((ft) => {
      ['same', 'diff'].forEach((cm) => {
        let base = ft === 'incompatible' ? 640 : ft === 'compatible' ? 510 : 500;
        if (cm === 'diff' && ft === 'incompatible') base = 580; // 颜色分离降低干扰
        for (let k = 0; k < perCond; k++) {
          trials.push({
            cond: ft + '-' + cm, flankType: ft, colorMode: cm,
            rt: base + (i * 3) + k, correct: 1, invalid: 0, timedOut: 0,
            target: 'H', flankLetter: 'H', resp: 'f',
          });
        }
      });
    });
    recs.push({ participant: 'PX' + i, experiment: 'flanker_improved', trials });
  }
  return recs;
}

function fakeClevelandRecords(n, perCond) {
  const recs = [];
  for (let i = 1; i <= n; i++) {
    const trials = [];
    [['bar', 8], ['pie', 18], ['pie_scale', 12]].forEach(([cond, err]) => {
      for (let k = 0; k < perCond; k++) {
        const abs = err + (i * 0.3) + (k % 3);
        trials.push({
          condition: cond, truePct: 40, estimate: 40 + abs, absErr: abs,
          logAbsErr: Math.log2(abs + 0.125), rt: 4000 + i * 20 + k, correct: abs <= 10 ? 1 : 0,
        });
      }
    });
    recs.push({ participant: 'PX' + i, experiment: 'cleveland_improved', trials });
  }
  return recs;
}

async function testGroup() {
  console.log('\n[全体结果] 读取后台记录与跨被试统计');

  // ---- Flanker ----
  const recs = fakeFlankerRecords(6, 16);
  let dataHits = 0;
  const dom = createDom('flanker.html', null, {
    fetch: (url) => {
      if (/\/api\/hw2\/data/.test(url)) {
        dataHits++;
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ ok: true, project: 'U9VNVY', records: recs })),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true, record_id: 1, participants: 6 })),
      });
    },
  });
  await waitReady(dom);
  const { window } = dom;
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);

  $('intro-next').click();
  $('consent-check').checked = true;
  $('consent-check').dispatchEvent(new window.Event('change'));
  $('consent-next').click();
  $('id-next').click();
  $('inst-next').click();
  $('practice-start').click();

  const KEY_MAP = { H: 'f', K: 'f', S: 'j', C: 'j' };
  flush(dom, () => {
    if ($('s-practice-done').style.display === 'block') { $('formal-start').click(); return; }
    const spans = $('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      doc.dispatchEvent(new window.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });
  await new Promise((r) => global.setTimeout(r, 200));

  const box = $('group-result');
  ok(!!box, '结果页含全体结果容器');
  ok(dataHits === 1, '读取一次数据接口（实际 ' + dataHits + ' 次）');

  const gHtml = box.innerHTML;
  ok(/已读取\s*<strong[^>]*>6<\/strong>\s*名被试/.test(gHtml), '显示被试数 6');
  ok(/共\s*<strong[^>]*>6<\/strong>\s*条记录/.test(gHtml), '显示记录数 6');
  ok(box.querySelectorAll('table').length === 2, '渲染两张表（条件表 + 效应表）');
  ok(/不相容 · 同色/.test(gHtml) && /相同 · 异色/.test(gHtml), '条件表含六个条件名');

  const effTable = box.querySelectorAll('table')[1];
  const effRows = effTable.querySelectorAll('tbody tr');
  ok(effRows.length === 3, '效应表 3 行（H1 同色 / H1 异色 / H2）');
  // 不相容 640 - 相容 510 = 130ms，跨被试均值应接近 130
  const h1Text = effRows[0].textContent;
  const h1Val = parseInt(h1Text.replace(/[^0-9]/g, '').slice(0, 3), 10);
  ok(/13[0-9]\s*ms|130/.test(h1Text), 'H1 同色效应约 130ms（实际行：' + h1Text.trim().slice(0, 40) + '）');
  ok(/<\.001|\.0/.test(h1Text), '含 p 值');
  ok(!!box.querySelector('svg'), '全体结果含森林图');
  ok(!/object Object/.test(gHtml), '无 [object Object]');
  dom.window.close();

  // ---- Cleveland ----
  const cRecs = fakeClevelandRecords(6, 16);
  const dom2 = createDom('cleveland.html', null, {
    fetch: (url) => {
      if (/\/api\/hw2\/data/.test(url)) {
        return Promise.resolve({
          ok: true, status: 200,
          text: () => Promise.resolve(JSON.stringify({ ok: true, records: cRecs })),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true, record_id: 2, participants: 6 })),
      });
    },
  });
  await waitReady(dom2);
  const w2 = dom2.window;
  const d2 = w2.document;
  const $2 = (id) => d2.getElementById(id);

  $2('intro-next').click();
  $2('consent-check').checked = true;
  $2('consent-check').dispatchEvent(new w2.Event('change'));
  $2('consent-next').click();
  $2('id-next').click();
  $2('inst-next').click();
  $2('practice-start').click();

  flush(dom2, () => {
    if ($2('s-practice-done').style.display === 'block') { $2('formal-start').click(); return; }
    const area = $2('chart-area');
    const input = $2('estimate-input');
    if (area.querySelector('svg') && input && !input.disabled && input.value === '') {
      input.value = '40';
      $2('submit-estimate').click();
    }
  });
  await new Promise((r) => global.setTimeout(r, 200));

  const box2 = $2('group-result');
  ok(!!box2 && /柱状图（A）/.test(box2.innerHTML), '实验二全体结果含三条件表');
  ok(/H3 饼图 − 柱状图/.test(box2.innerHTML), '含 H3 效应行');
  ok(/H4 普通饼图 − 带刻度饼图/.test(box2.innerHTML), '含 H4 效应行');
  ok(!!box2.querySelector('svg'), '实验二全体结果含森林图');
  dom2.window.close();

  // ---- 接口不可用时不能崩，也不能影响单被试结果 ----
  const dom3 = createDom('flanker.html', null, {
    fetch: (url) => {
      if (/\/api\/hw2\/data/.test(url)) return Promise.reject(new Error('offline'));
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ ok: true, record_id: 3, participants: 1 })),
      });
    },
  });
  await waitReady(dom3);
  const w3 = dom3.window;
  const d3 = w3.document;
  const $3 = (id) => d3.getElementById(id);

  $3('intro-next').click();
  $3('consent-check').checked = true;
  $3('consent-check').dispatchEvent(new w3.Event('change'));
  $3('consent-next').click();
  $3('id-next').click();
  $3('inst-next').click();
  $3('practice-start').click();

  flush(dom3, () => {
    if ($3('s-practice-done').style.display === 'block') { $3('formal-start').click(); return; }
    const spans = $3('formal-stage').querySelectorAll('.flanker-letters span');
    if (spans.length === 7) {
      d3.dispatchEvent(new w3.KeyboardEvent('keydown', {
        key: KEY_MAP[spans[3].textContent], bubbles: true,
      }));
    }
  });
  await new Promise((r) => global.setTimeout(r, 200));

  ok(/暂时无法读取全体结果/.test($3('group-result').textContent), '接口失败时给出提示而非报错中断');
  ok(!!$3('result-body').querySelector('.kpi-grid'), '单被试结果仍然正常渲染');
  dom3.window.close();
}

/* ============================================================
   运行
   ============================================================ */
(async function run() {
  console.log('=== 工程心理学作业二 · 端到端测试 ===');
  try {
    await testFlanker();
    await testCleveland();
    await testShortSession();
    await testUpload();
    await testGroup();
  } catch (e) {
    console.error('\n测试执行异常：', e);
    failures++;
  }
  console.log('\n=== 结果：' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗') + ' ===');
  process.exit(failures === 0 ? 0 : 1);
})();
