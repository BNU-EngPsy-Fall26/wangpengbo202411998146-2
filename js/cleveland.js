/**
 * cleveland.js — 实验二：Cleveland–McGill 图形知觉实验
 *
 * 单因素三水平（被试内）：
 *   A: 共同尺度柱状图 (bar)
 *   B: 普通饼图 (pie)
 *   C: 带 .25/.5/.75 角度参考刻度的饼图 (pie_scale) —— 新增条件
 * 每条件 16 试次 = 48 正式试次。
 *
 * 因变量：绝对误差 = |估计% − 真实%|；对数绝对误差 = log2(绝对误差 + 1/8)；判断反应时。
 *
 * 改进依据：Hollands & Dyre (2000) 发现给饼图增加刻度参考线可改善比例判断。
 */
(function () {
  'use strict';
  const ENG = window.ENG;
  const GAZE = window.ENG_GAZE;

  const CONDITIONS = ['bar', 'pie', 'pie_scale'];
  const COND_LABEL = { bar: '柱状图', pie: '普通饼图', pie_scale: '带刻度饼图' };
  // 每条件正式试次数由会话长度决定（标准 16 / 精简 12）
  const FORMAL_PER_COND = (function () {
    const n = ENG.perConditionTrials();
    return n > 0 ? n : 16;
  })();
  const PRACTICE_TRIALS = 6;

  const STEP_LABELS = ['介绍', '知情同意', '匿名编号', '指导语', '练习', '正式实验', '结果'];

  const state = {
    participant: null,
    practiceTrials: [],
    practiceIdx: 0,
    formalTrials: [],
    formalIdx: 0,
    trials: [],
    current: null,
    isPractice: false,
    stimOn: null,
    awaitingSubmit: false,
    onDone: null,
    gazeEnabled: false,
  };

  let stepper = null;
  const $ = (id) => document.getElementById(id);

  /* ---------- 试次构建 ---------- */

  // 比例池：较小值占最大值的比例，控制难度可比
  const RATIO_POOL = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * 生成一个试次：5 个数值，其中 1 个为最大值(100)，
   * 1 个为指定比例的"较小值"，其余 3 个介于两者之间。位置随机打乱。
   */
  function makeTrial(condition) {
    const ratio = pick(RATIO_POOL);
    const maxVal = 100;
    const smallVal = Math.round(maxVal * ratio);

    // 生成 3 个介于 smallVal 与 maxVal 之间且互不相同的值
    const used = new Set([maxVal, smallVal]);
    const others = [];
    let guard = 0;
    while (others.length < 3 && guard < 500) {
      guard++;
      const lo = smallVal + Math.ceil((maxVal - smallVal) * 0.12);
      const hi = maxVal - Math.ceil((maxVal - smallVal) * 0.08);
      if (hi <= lo) break;
      const v = Math.round(lo + Math.random() * (hi - lo));
      if (used.has(v)) continue;
      used.add(v);
      others.push(v);
    }
    // 兜底：若空间不足，允许接近值
    while (others.length < 3) {
      const v = smallVal + 3 + others.length * 4;
      if (used.has(v)) { others.push(v + 1); used.add(v + 1); }
      else { others.push(v); used.add(v); }
    }

    const vals = ENG.shuffle([maxVal, smallVal, ...others]);
    const maxIdx = vals.indexOf(maxVal);
    const smallIdx = vals.indexOf(smallVal);
    const truePct = Math.round((smallVal / maxVal) * 100);

    return { condition, vals, maxVal, smallVal, maxIdx, smallIdx, truePct };
  }

  function buildFormalTrials() {
    const trials = [];
    for (const c of CONDITIONS) {
      for (let i = 0; i < FORMAL_PER_COND; i++) trials.push(makeTrial(c));
    }
    return ENG.shuffle(trials);
  }

  function buildPracticeTrials() {
    const trials = [];
    for (let i = 0; i < PRACTICE_TRIALS; i++) {
      trials.push(makeTrial(CONDITIONS[i % CONDITIONS.length]));
    }
    return ENG.shuffle(trials);
  }

  /* ---------- SVG 图表绘制 ---------- */

  const PALETTE = ['#bfdbfe', '#c7d2fe', '#ddd6fe', '#bbf7d0', '#fde68a'];
  const COLOR_MAX = '#dc2626';   // 最大：红
  const COLOR_SMALL = '#2563eb'; // 较小：蓝

  function drawChart(trial) {
    const area = $('chart-area');
    if (trial.condition === 'bar') {
      area.innerHTML = svgBar(trial);
    } else {
      area.innerHTML = svgPie(trial, trial.condition === 'pie_scale');
    }
  }

  function svgBar(trial) {
    const W = 520, H = 340;
    const padL = 34, padR = 26, padT = 34, padB = 46;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const vals = trial.vals;
    const n = vals.length;
    const slot = plotW / n;
    const barW = slot * 0.5;

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="max-width:520px;width:100%;height:auto;font-family:system-ui,sans-serif;">`;

    // 基线
    s += `<line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}"
      stroke="#94a3b8" stroke-width="1.6"/>`;

    vals.forEach((v, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = (v / trial.maxVal) * plotH;
      const y = padT + plotH - h;
      const isMax = i === trial.maxIdx;
      const isSmall = i === trial.smallIdx;

      let fill = PALETTE[i % PALETTE.length];
      let stroke = 'none';
      let strokeW = 0;
      if (isMax) { fill = COLOR_MAX; }
      else if (isSmall) { fill = COLOR_SMALL; }
      if (isMax || isSmall) { stroke = '#0f172a'; strokeW = 1.6; }

      s += `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${h}"
        rx="3" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"/>`;

      // 标记文字（不显示数值）
      if (isMax) {
        s += `<text x="${cx}" y="${y - 9}" text-anchor="middle"
          font-size="12.5" font-weight="700" fill="${COLOR_MAX}">最大</text>`;
      }
      if (isSmall) {
        s += `<text x="${cx}" y="${H - padB + 20}" text-anchor="middle"
          font-size="12.5" font-weight="700" fill="${COLOR_SMALL}">较小</text>`;
      }
    });

    s += '</svg>';
    return s;
  }

  function svgPie(trial, withScale) {
    const W = 520, H = 340;
    const cx = W / 2, cy = H / 2 - 6, R = 118;
    const vals = trial.vals;
    const total = vals.reduce((a, b) => a + b, 0);

    let s = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
      style="max-width:520px;width:100%;height:auto;font-family:system-ui,sans-serif;">`;

    // 外圈刻度环（仅改进条件）
    if (withScale) {
      const rOut = R + 18, rIn = R + 9;
      for (let deg = 0; deg < 360; deg += 15) {
        const a = (deg - 90) * Math.PI / 180;
        const major = deg % 90 === 0;
        const x1 = cx + Math.cos(a) * rIn, y1 = cy + Math.sin(a) * rIn;
        const x2 = cx + Math.cos(a) * rOut, y2 = cy + Math.sin(a) * rOut;
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
          stroke="${major ? '#475569' : '#cbd5e1'}" stroke-width="${major ? 2 : 1}"/>`;
      }
      // 四分之一参考短标签（用比例符号，不显示具体百分比）
      const labels = [
        { deg: 0, txt: '0' },
        { deg: 90, txt: '.25' },
        { deg: 180, txt: '.5' },
        { deg: 270, txt: '.75' },
      ];
      labels.forEach(({ deg, txt }) => {
        const a = (deg - 90) * Math.PI / 180;
        const r = R + 32;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        s += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle"
          font-size="10.5" fill="#64748b" font-weight="600">${txt}</text>`;
      });
    }

    // 扇区（从 12 点方向顺时针）
    let start = -90;
    vals.forEach((v, i) => {
      const angle = (v / total) * 360;
      const end = start + angle;
      const largeArc = angle > 180 ? 1 : 0;
      const x1 = cx + Math.cos(start * Math.PI / 180) * R;
      const y1 = cy + Math.sin(start * Math.PI / 180) * R;
      const x2 = cx + Math.cos(end * Math.PI / 180) * R;
      const y2 = cy + Math.sin(end * Math.PI / 180) * R;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`;

      let fill = PALETTE[i % PALETTE.length];
      if (i === trial.maxIdx) fill = COLOR_MAX;
      else if (i === trial.smallIdx) fill = COLOR_SMALL;

      s += `<path d="${d}" fill="${fill}" stroke="#fff" stroke-width="1.6"/>`;

      // 扇区标签
      const mid = (start + end) / 2;
      const lr = R * 0.66;
      const lx = cx + Math.cos(mid * Math.PI / 180) * lr;
      const ly = cy + Math.sin(mid * Math.PI / 180) * lr;
      if (i === trial.maxIdx) {
        s += `<text x="${lx}" y="${ly + 4}" text-anchor="middle"
          font-size="12" font-weight="700" fill="#fff">最大</text>`;
      } else if (i === trial.smallIdx) {
        s += `<text x="${lx}" y="${ly + 4}" text-anchor="middle"
          font-size="12" font-weight="700" fill="#fff">较小</text>`;
      }

      start = end;
    });

    // 改进条件：从圆心向外的 .25 / .5 / .75 参考射线
    if (withScale) {
      [90, 180, 270].forEach((deg) => {
        const a = (deg - 90) * Math.PI / 180;
        const x2 = cx + Math.cos(a) * (R + 9);
        const y2 = cy + Math.sin(a) * (R + 9);
        // 先画一条浅色底衬，再叠深色虚线，保证在深色扇区上也能看清
        s += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"
          stroke="rgba(255,255,255,.75)" stroke-width="3.2" stroke-linecap="round"/>`;
        s += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}"
          stroke="rgba(15,23,42,.62)" stroke-width="1.3" stroke-dasharray="4 3"/>`;
      });
    }

    // 圆心点
    s += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="#0f172a" opacity="0.5"/>`;

    // 图例
    s += `<g transform="translate(16,${H - 20})">
      <rect x="0" y="-9" width="11" height="11" rx="2" fill="${COLOR_MAX}"/>
      <text x="16" y="1" font-size="11.5" fill="#475569">最大</text>
      <rect x="68" y="-9" width="11" height="11" rx="2" fill="${COLOR_SMALL}"/>
      <text x="84" y="1" font-size="11.5" fill="#475569">较小</text>
    </g>`;

    // 条件提示（不带答案信息）
    if (withScale) {
      s += `<text x="${W - 16}" y="${H - 12}" text-anchor="end"
        font-size="10.5" fill="#94a3b8">含 .25 / .5 / .75 角度参考</text>`;
    }

    s += '</svg>';
    return s;
  }

  /* ---------- 试次执行 ---------- */
  function presentTrial(trial, isPractice) {
    state.current = trial;
    state.isPractice = isPractice;
    state.awaitingSubmit = true;
    state.stimOn = performance.now();
    $('estimate-input').value = '';
    $('estimate-input').disabled = false;
    $('submit-estimate').disabled = false;
    $('feedback').textContent = '';
    drawChart(trial);
    if (state.gazeEnabled) GAZE.beginWindow();
    setTimeout(() => $('estimate-input').focus(), 30);
  }

  function submitEstimate() {
    if (!state.awaitingSubmit || !state.current) return;

    const input = $('estimate-input');
    const val = parseFloat(input.value);

    if (isNaN(val) || val < 0 || val > 100) {
      $('feedback').textContent = '请输入 0–100 之间的数字。';
      $('feedback').style.color = 'var(--danger)';
      return;
    }

    state.awaitingSubmit = false;
    input.disabled = true;
    $('submit-estimate').disabled = true;
    if (state.gazeEnabled) GAZE.endWindow();

    const rt = performance.now() - state.stimOn;
    const trial = state.current;
    const absErr = Math.abs(val - trial.truePct);
    const logAbsErr = Math.log2(absErr + 0.125);

    const data = {
      condition: trial.condition,
      truePct: trial.truePct,
      estimate: val,
      absErr,
      logAbsErr,
      rt,
      vals: trial.vals.slice(),
      maxVal: trial.maxVal,
      smallVal: trial.smallVal,
      maxIdx: trial.maxIdx,
      smallIdx: trial.smallIdx,
    };

    if (state.isPractice) {
      $('feedback').style.color = 'var(--text-2)';
      $('feedback').innerHTML =
        `正确答案约 <strong>${trial.truePct}%</strong>，你的估计 <strong>${val}%</strong>，` +
        `绝对误差 <strong>${Math.round(absErr)}</strong> 个百分点。`;
      setTimeout(() => { if (state.onDone) state.onDone(); }, 1300);
    } else {
      state.trials.push(data);
      if (state.onDone) state.onDone();
    }
  }

  /* ---------- 阶段切换 ---------- */
  const SECTION_STEP = {
    's-intro': 0, 's-consent': 1, 's-id': 2, 's-instructions': 3,
    's-practice': 4, 's-practice-done': 4, 's-formal': 5, 's-result': 6,
  };

  function show(secId) {
    ['s-intro', 's-consent', 's-id', 's-instructions', 's-practice',
      's-practice-done', 's-formal', 's-result'].forEach((s) => { $(s).style.display = 'none'; });
    $(secId).style.display = 'block';
    if (stepper && SECTION_STEP[secId] != null) stepper.setActive(SECTION_STEP[secId]);
    window.scrollTo(0, 0);
  }

  /* ---------- 练习 ---------- */
  function runPractice() {
    state.practiceTrials = buildPracticeTrials();
    state.practiceIdx = 0;
    show('s-formal');
    $('formal-progress').style.width = '0%';
    $('formal-pct').textContent = '';
    nextPracticeTrial();
  }

  function nextPracticeTrial() {
    if (state.practiceIdx >= state.practiceTrials.length) { finishPractice(); return; }
    const trial = state.practiceTrials[state.practiceIdx];
    $('formal-count').textContent = '练习 ' + (state.practiceIdx + 1) + ' / ' + state.practiceTrials.length;
    $('formal-progress').style.width = (state.practiceIdx / state.practiceTrials.length * 100) + '%';

    state.onDone = () => {
      state.practiceIdx++;
      setTimeout(nextPracticeTrial, 250);
    };
    presentTrial(trial, true);
  }

  function finishPractice() {
    $('practice-summary').innerHTML =
      '您已完成 <strong>' + state.practiceTrials.length + '</strong> 个练习试次。' +
      '正式实验共 <strong>48</strong> 个试次，不提供答案反馈。';
    show('s-practice-done');
  }

  /* ---------- 正式实验 ---------- */
  function runFormal() {
    state.formalTrials = buildFormalTrials();
    state.formalIdx = 0;
    state.trials = [];
    show('s-formal');
    nextFormalTrial();
  }

  function nextFormalTrial() {
    if (state.formalIdx >= state.formalTrials.length) { finishFormal(); return; }

    const trial = state.formalTrials[state.formalIdx];
    const total = state.formalTrials.length;
    $('formal-count').textContent = '正式 ' + (state.formalIdx + 1) + ' / ' + total;
    $('formal-pct').textContent = Math.round(state.formalIdx / total * 100) + '%';
    $('formal-progress').style.width = (state.formalIdx / total * 100) + '%';

    state.onDone = () => {
      state.formalIdx++;
      $('formal-progress').style.width = (state.formalIdx / total * 100) + '%';
      $('formal-pct').textContent = Math.round(state.formalIdx / total * 100) + '%';
      setTimeout(nextFormalTrial, 250);
    };
    presentTrial(trial, false);
  }

  function finishFormal() {
    if (state.gazeEnabled) GAZE.stop();

    const record = {
      experiment: ENG.cfg.experiments.cleveland.id,
      participant: state.participant,
      completedAt: new Date().toISOString(),
      session: { mode: ENG.sessionMode(), perCondition: FORMAL_PER_COND },
      gaze: state.gazeEnabled ? GAZE.summary() : null,
      trials: state.trials,
    };
    ENG.saveLocal('cleveland_' + state.participant, record);
    showResult(record);
  }

  /* ---------- 统计 ---------- */
  function condStats(trials, cond) {
    const sub = trials.filter((t) => t.condition === cond);
    const abs = sub.map((t) => t.absErr);
    const log = sub.map((t) => t.logAbsErr);
    const rt = sub.map((t) => t.rt);
    return {
      n: sub.length,
      meanAbs: abs.length ? ENG.mean(abs) : null,
      seAbs: abs.length > 1 ? ENG.se(abs) : null,
      meanLog: log.length ? ENG.mean(log) : null,
      meanRt: rt.length ? ENG.mean(rt) : null,
      absList: abs,
    };
  }

  /* ---------- 结果展示 ---------- */
  function showResult(record) {
    show('s-result');

    const stats = {};
    CONDITIONS.forEach((c) => { stats[c] = condStats(record.trials, c); });

    const bar = stats.bar, pie = stats.pie, scale = stats.pie_scale;

    // 经典效应：饼图 − 柱状图（正值 = 饼图误差更大，支持 H3）
    const classicEffect = (pie.meanAbs != null && bar.meanAbs != null) ? pie.meanAbs - bar.meanAbs : null;
    const classicSe = (pie.seAbs != null && bar.seAbs != null)
      ? Math.sqrt(pie.seAbs ** 2 + bar.seAbs ** 2) : null;

    // 改进效应：普通饼图 − 带刻度饼图（正值 = 刻度降低误差，支持 H4）
    const improvedEffect = (pie.meanAbs != null && scale.meanAbs != null) ? pie.meanAbs - scale.meanAbs : null;
    const improvedSe = (pie.seAbs != null && scale.seAbs != null)
      ? Math.sqrt(pie.seAbs ** 2 + scale.seAbs ** 2) : null;

    const h3 = classicEffect != null ? classicEffect > 0 : null;
    const h4 = improvedEffect != null ? improvedEffect > 0 : null;

    const allRt = record.trials.map((t) => t.rt).filter((v) => isFinite(v));
    const overallRt = allRt.length ? ENG.mean(allRt) : null;

    let html = '';

    html += `<p class="small muted" style="margin-bottom:2px;">
      匿名编号 <strong style="color:var(--text)">${esc(record.participant)}</strong>
      · 正式试次 <strong style="color:var(--text)">${record.trials.length}</strong>
      · 完成于 ${new Date(record.completedAt).toLocaleString('zh-CN')}
    </p>`;

    html += `<div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">柱状图平均绝对误差</div>
        <div class="kpi-value">${bar.meanAbs != null ? bar.meanAbs.toFixed(1) : '—'}<span class="unit">pp</span></div>
        <div class="kpi-sub">越小越准确</div>
      </div>
      <div class="kpi bad">
        <div class="kpi-label">普通饼图平均绝对误差</div>
        <div class="kpi-value">${pie.meanAbs != null ? pie.meanAbs.toFixed(1) : '—'}<span class="unit">pp</span></div>
        <div class="kpi-sub">经典条件</div>
      </div>
      <div class="kpi ${h4 ? 'ok' : 'gold'}">
        <div class="kpi-label">带刻度饼图平均绝对误差</div>
        <div class="kpi-value">${scale.meanAbs != null ? scale.meanAbs.toFixed(1) : '—'}<span class="unit">pp</span></div>
        <div class="kpi-sub">带刻度条件</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">平均判断时间</div>
        <div class="kpi-value">${overallRt != null ? (overallRt / 1000).toFixed(1) : '—'}<span class="unit">s</span></div>
        <div class="kpi-sub">全部正式试次</div>
      </div>
    </div>`;

    html += `<h3>三种条件的平均误差与判断时间</h3>`;
    html += `<table><thead><tr>
      <th>条件</th><th>平均绝对误差 (pp)</th><th>标准误</th>
      <th>对数绝对误差</th><th>平均判断时间</th><th>试次</th>
    </tr></thead><tbody>`;
    CONDITIONS.forEach((c) => {
      const d = stats[c];
      html += `<tr>
        <td>${COND_LABEL[c]}（${c === 'bar' ? 'A' : c === 'pie' ? 'B' : 'C'}）</td>
        <td>${d.meanAbs != null ? d.meanAbs.toFixed(2) : '—'}</td>
        <td>${d.seAbs != null ? '±' + d.seAbs.toFixed(2) : '—'}</td>
        <td>${d.meanLog != null ? d.meanLog.toFixed(2) : '—'}</td>
        <td>${d.meanRt != null ? (d.meanRt / 1000).toFixed(2) + ' s' : '—'}</td>
        <td>${d.n}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    html += `<p class="tiny muted">pp = 百分点（percentage points）。对数绝对误差按原论文形式 log₂(|误差| + 1/8) 计算。</p>`;

    html += `<h3>三条件平均绝对误差</h3><div class="chart-box" id="err-chart"></div>`;

    html += `<h3>理论预测 vs 实测效应</h3>`;
    html += `<p class="small muted" style="margin-top:0;">
      依据 Cleveland &amp; McGill (1984) 的图形编码精度理论，位置编码（柱状图）优于角度/面积编码（饼图），
      故预测饼图误差大于柱状图（H3）；依据 Hollands &amp; Dyre (2000)，
      增加 .25/.5/.75 角度参考刻度应降低饼图误差（H4）。绿色阴影为预测方向。
    </p>`;
    html += `<div class="chart-box" id="forest-chart"></div>`;

    html += `<h3>假设检验</h3>`;
    html += hypoRow('H3 柱状图误差 < 普通饼图（饼 − 柱 > 0）',
      h3, classicEffect != null ? `Δ = ${classicEffect.toFixed(1)} pp` : '');
    html += hypoRow('H4 带刻度饼图误差 < 普通饼图（饼 − 刻度 > 0）',
      h4, improvedEffect != null ? `Δ = ${improvedEffect.toFixed(1)} pp` : '');

    // 速度—准确性权衡
    const rtBar = bar.meanRt, rtPie = pie.meanRt, rtScale = scale.meanRt;
    if (rtBar != null && rtPie != null && rtScale != null) {
      html += `<h3>速度—准确性权衡</h3>`;
      html += `<p class="small muted" style="margin-top:0;">
        若某条件误差更低但用时明显更长，其准确性提升可能来自更长的判断时间，而非图形编码本身的优势。
      </p>`;
      html += `<div class="kv"><span class="k">柱状图</span><span class="v">${(rtBar / 1000).toFixed(2)} s · 误差 ${bar.meanAbs.toFixed(1)} pp</span></div>`;
      html += `<div class="kv"><span class="k">普通饼图</span><span class="v">${(rtPie / 1000).toFixed(2)} s · 误差 ${pie.meanAbs.toFixed(1)} pp</span></div>`;
      html += `<div class="kv"><span class="k">带刻度饼图</span><span class="v">${(rtScale / 1000).toFixed(2)} s · 误差 ${scale.meanAbs.toFixed(1)} pp</span></div>`;
    }

    if (record.gaze && record.gaze.enabled) {
      const g = record.gaze;
      html += `<h3>眼动记录（可选模块）</h3>`;
      html += `<div class="kv"><span class="k">图表呈现期有效注视样本</span><span class="v">${g.samples}</span></div>`;
      html += `<div class="kv"><span class="k">注视中央区域比例</span><span class="v">${(g.onCenterRatio * 100).toFixed(1)}%</span></div>`;
      html += `<p class="tiny muted">该指标由 WebGazer 网页眼动估计得到，未做精细九点校准，仅作探索性参考。</p>`;
    }

    html += `<p class="small muted" style="margin-top:18px;">
      注：以上为单名被试的网页端结果，小样本与网页环境存在局限，详见 README。
    </p>`;

    $('result-body').innerHTML = html;

    // 图表
    ENG.drawBarChart($('err-chart'), {
      data: CONDITIONS.map((c) => ({
        label: COND_LABEL[c],
        value: stats[c].meanAbs != null ? stats[c].meanAbs : 0,
        err: stats[c].seAbs,
      })),
      color: '#0f766e',
      unit: '绝对误差 (pp)',
    });

    ENG.drawForestPlot($('forest-chart'), {
      rows: [
        {
          label: 'H3 饼图 − 柱状图\n（经典编码效应）',
          effect: classicEffect != null ? classicEffect : NaN,
          ci: classicSe != null ? classicSe * 1.96 : NaN,
          predicted: 'positive',
        },
        {
          label: 'H4 普通饼图 − 带刻度饼图\n（刻度效应）',
          effect: improvedEffect != null ? improvedEffect : NaN,
          ci: improvedSe != null ? improvedSe * 1.96 : NaN,
          predicted: 'positive',
        },
      ],
      unit: 'pp',
    });

    $('export-csv').onclick = () => exportCSV(record);
    // 未设置项目码时不显示提交按钮：数据仍在本地保存，可随时导出 CSV
    const upBtn = $('upload-now');
    if (ENG.getProjectCode()) {
      upBtn.onclick = () => uploadData(record, true);
      tryAutoUpload(record);
    } else {
      upBtn.style.display = 'none';
    }
  }

  function hypoRow(label, supported, statText) {
    const cls = supported === true ? 'yes' : supported === false ? 'no' : 'na';
    const txt = supported === true ? '支持 ✓' : supported === false ? '未支持 ✗' : '数据不足';
    return `<div class="hypo">
      <div class="hypo-text"><strong>${label}</strong></div>
      <div style="display:flex;align-items:center;gap:14px;">
        <span class="hypo-stat">${statText || ''}</span>
        <span class="verdict ${cls}">${txt}</span>
      </div>
    </div>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- 导出与上传 ---------- */
  function exportCSV(record) {
    const rows = record.trials.map((t) => ({
      experiment: record.experiment,
      participant: record.participant,
      sessionMode: record.session ? record.session.mode : '',
      condition: t.condition,
      truePct: t.truePct,
      estimate: t.estimate,
      absErr: +t.absErr.toFixed(3),
      logAbsErr: +t.logAbsErr.toFixed(3),
      rt: Math.round(t.rt),
      maxVal: t.maxVal,
      smallVal: t.smallVal,
    }));
    ENG.downloadCSV('cleveland_' + record.participant + '.csv', rows);
  }

  function buildPayload(record) {
    return {
      project: ENG.getProjectCode(),
      experiment: record.experiment,
      participant: record.participant,
      // 被试间分组留空：本实验所有被试完成同一套被试内条件
      condition: '',
      trials: record.trials.map((t) => ({
        cond: t.condition,
        rt: Math.round(t.rt),
        // 接口要求 correct 字段；此处约定绝对误差 ≤ 10 个百分点记为正确
        correct: t.absErr <= 10 ? 1 : 0,
        truePct: t.truePct,
        estimate: t.estimate,
        absErr: +t.absErr.toFixed(3),
        logAbsErr: +t.logAbsErr.toFixed(3),
      })),
      meta: {
        ua: (navigator.userAgent || '').slice(0, 80),
        w: window.innerWidth,
        h: window.innerHeight,
        sessionMode: ENG.sessionMode(),
        perCondition: FORMAL_PER_COND,
      },
    };
  }

  function setUploadStatus(msg, kind) {
    const el = $('upload-status');
    el.className = 'upload-status' + (kind ? ' ' + kind : '');
    el.textContent = msg;
  }

  function uploadData(record, manual) {
    const code = ENG.getProjectCode();
    if (!code) {
      setUploadStatus('数据已保存在本地，可点击「导出 CSV」备份。', '');
      return;
    }
    if (ENG.loadLocal('uploaded_' + record.experiment + '_' + record.participant)) {
      setUploadStatus('该被试数据此前已成功上传，为避免重复提交已跳过。', 'ok');
      return;
    }

    setUploadStatus('正在提交数据…', 'busy');
    ENG.submitToPlatform(buildPayload(record))
      .then((res) => {
        ENG.saveLocal('uploaded_' + record.experiment + '_' + record.participant, true);
        let msg = ENG.submitResultText(res);
        if (res && res.warnings) {
          msg += ' 但后台提示有字段被调整：' + res.warnings;
          setUploadStatus(msg, 'warn');
        } else {
          setUploadStatus(msg, 'ok');
        }
      })
      .catch((err) => {
        setUploadStatus('提交失败：' + err.message + ' 数据已保存在本地，可导出 CSV 备份。', 'err');
        if (manual) console.warn(err);
      });
  }

  function tryAutoUpload(record) {
    if (!ENG.getProjectCode()) return;
    if (ENG.loadLocal('uploaded_' + record.experiment + '_' + record.participant)) {
      setUploadStatus('该被试数据此前已成功上传，未重复提交。', 'ok');
      return;
    }
    uploadData(record, false);
  }

  /* ---------- 眼动开关 ---------- */
  function initGazeToggle() {
    const toggle = $('gaze-toggle');
    const pill = $('gaze-status');
    const pillText = $('gaze-status-text');
    const hint = $('gaze-hint');

    if (!GAZE || !GAZE.isSupported()) {
      toggle.disabled = true;
      hint.textContent = GAZE ? GAZE.supportReason() : '当前环境不支持眼动记录。';
      pillText.textContent = '不可用';
      return;
    }

    hint.textContent = '提示：开启后会请求摄像头权限，需要几秒初始化。若初始化失败会自动降级，实验照常进行。';

    toggle.onchange = async () => {
      if (toggle.checked) {
        pillText.textContent = '正在启动…';
        try {
          await GAZE.start();
          state.gazeEnabled = true;
          pill.classList.add('on');
          pillText.textContent = '记录中';
          hint.textContent = '眼动记录已开启。判断期间请保持头部位置稳定。';
        } catch (err) {
          state.gazeEnabled = false;
          toggle.checked = false;
          pill.classList.remove('on');
          pillText.textContent = '启动失败';
          hint.textContent = '启动失败：' + err.message + '（不影响实验，可直接继续）';
        }
      } else {
        GAZE.stop();
        state.gazeEnabled = false;
        pill.classList.remove('on');
        pillText.textContent = '已关闭';
        hint.textContent = '眼动记录已关闭，实验将照常进行。';
      }
    };
  }

  /* ---------- 初始化 ---------- */
  function init() {
    stepper = window.ENG_UI.createStepper('stepper', STEP_LABELS);
    show('s-intro');

    $('intro-next').onclick = () => show('s-consent');

    // 按当前会话长度刷新试次与时长说明
    const totalFormal = FORMAL_PER_COND * CONDITIONS.length;
    $('intro-trials').textContent =
      '整个实验约 ' + (ENG.sessionMode() === 'short' ? '3–4' : '4–6') + ' 分钟，共 '
      + totalFormal + ' 个正式试次（另有 ' + PRACTICE_TRIALS + ' 个练习试次）。';

    const consentCheck = $('consent-check');
    consentCheck.onchange = () => { $('consent-next').disabled = !consentCheck.checked; };
    $('consent-next').onclick = () => {
      $('pid-input').value = ENG.randomParticipantId();
      show('s-id');
    };

    $('pid-random').onclick = () => { $('pid-input').value = ENG.randomParticipantId(); };
    $('id-next').onclick = () => {
      const pid = $('pid-input').value.trim();
      if (!pid) { alert('请输入或生成一个匿名编号。'); return; }
      state.participant = pid;
      show('s-instructions');
    };

    $('inst-next').onclick = () => show('s-practice');
    $('practice-start').onclick = runPractice;
    $('formal-start').onclick = runFormal;

    $('submit-estimate').onclick = submitEstimate;
    $('estimate-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submitEstimate(); }
    });

    initGazeToggle();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
