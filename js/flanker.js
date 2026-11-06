/**
 * flanker.js — 实验一：Flanker 侧翼干扰实验
 *
 * 设计：3 × 2 被试内
 *   因素一 侧翼类型：congruent(完全相同) / compatible(反应相容) / incompatible(反应不相容)
 *   因素二 颜色分组：same(经典·同色) / diff(改进·异色)
 * 共 6 条件 × 16 试次 = 96 正式试次。
 *
 * 字母→按键映射：H,K → F 键；S,C → J 键。
 *
 * 时间参数（网页版建议值，README 中说明非原论文精确值）：
 *   注视点 500ms；刺激最长 1000ms；总反应窗口最长 1500ms；ITI 400–600ms。
 */
(function () {
  'use strict';
  const ENG = window.ENG;
  const GAZE = window.ENG_GAZE;

  /* ---------- 常量 ---------- */
  const LETTERS = ['H', 'K', 'S', 'C'];
  const KEY_MAP = { H: 'f', K: 'f', S: 'j', C: 'j' };

  const FLANKER_TYPES = ['congruent', 'compatible', 'incompatible'];
  const COLOR_MODES = ['same', 'diff'];

  const FIX_MS = 500;
  const STIM_MAX_MS = 1000;
  const RESP_WINDOW_MS = 1500;
  const ITI_MIN_MS = 400;
  const ITI_MAX_MS = 600;

  // 每条件正式试次数由会话长度决定（标准 16 / 精简 12）。
  // 必须能被 4 个目标字母整除，否则退回 16，保证字母与按键方向完全平衡。
  const FORMAL_PER_COND = (function () {
    const n = ENG.perConditionTrials();
    return n % LETTERS.length === 0 ? n : 16;
  })();
  const PRACTICE_TRIALS = 12;

  const COLOR_TARGET = '#f1f5f9';  // 深色背景下的浅色目标
  const COLOR_FLANK = '#60a5fa';   // 蓝色侧翼（改进条件）
  const COLOR_SAME = '#f1f5f9';    // 经典条件：全部同色

  const STEP_LABELS = ['介绍', '知情同意', '匿名编号', '指导语', '练习', '正式实验', '结果'];

  /* ---------- 状态 ---------- */
  const state = {
    participant: null,
    practiceTrials: [],
    practiceIdx: 0,
    formalTrials: [],
    formalIdx: 0,
    trials: [],
    trial: null,
    onDone: null,
    awaitingResp: false,
    gazeEnabled: false,
  };

  let stepper = null;
  const $ = (id) => document.getElementById(id);

  /* ---------- 试次构建 ---------- */
  function makeCondition(target, flankType, colorMode) {
    let flankLetter;
    if (flankType === 'congruent') {
      flankLetter = target;
    } else if (flankType === 'compatible') {
      const sameKey = LETTERS.filter((l) => l !== target && KEY_MAP[l] === KEY_MAP[target]);
      flankLetter = sameKey[0];
    } else {
      const otherKey = LETTERS.filter((l) => KEY_MAP[l] !== KEY_MAP[target]);
      flankLetter = otherKey[Math.floor(Math.random() * otherKey.length)];
    }
    return { target, flankLetter, flankType, colorMode };
  }

  function buildFormalTrials() {
    const trials = [];
    // 每条件 = 4 个目标字母 × 每目标每条件 k 次（标准 k=4 → 96；精简 k=3 → 72）
    // 每目标字母共出现 6 × k 次（标准 24；精简 18），按键方向完全平衡
    const PER_TARGET_PER_COND = FORMAL_PER_COND / LETTERS.length;
    for (const target of LETTERS) {
      for (const ft of FLANKER_TYPES) {
        for (const cm of COLOR_MODES) {
          for (let i = 0; i < PER_TARGET_PER_COND; i++) {
            trials.push(makeCondition(target, ft, cm));
          }
        }
      }
    }
    return ENG.shuffle(trials);
  }

  function buildPracticeTrials() {
    const trials = [];
    for (let i = 0; i < PRACTICE_TRIALS; i++) {
      const target = LETTERS[i % LETTERS.length];
      const ft = FLANKER_TYPES[i % FLANKER_TYPES.length];
      const cm = COLOR_MODES[i % COLOR_MODES.length];
      trials.push(makeCondition(target, ft, cm));
    }
    return ENG.shuffle(trials);
  }

  /* ---------- 阶段切换 ---------- */
  const SECTION_STEP = {
    's-intro': 0,
    's-consent': 1,
    's-id': 2,
    's-instructions': 3,
    's-practice': 4,
    's-practice-done': 4,
    's-formal': 5,
    's-result': 6,
  };

  function show(secId) {
    ['s-intro', 's-consent', 's-id', 's-instructions', 's-practice',
      's-practice-done', 's-formal', 's-result'].forEach((s) => { $(s).style.display = 'none'; });
    $(secId).style.display = 'block';
    if (stepper && SECTION_STEP[secId] != null) stepper.setActive(SECTION_STEP[secId]);
    window.scrollTo(0, 0);
  }

  /* ---------- 计时器管理 ---------- */
  let timerHandles = [];
  function clearTimers() {
    timerHandles.forEach((h) => clearTimeout(h));
    timerHandles = [];
  }
  function later(fn, ms) {
    const h = setTimeout(fn, ms);
    timerHandles.push(h);
    return h;
  }

  /* ---------- 刺激渲染 ---------- */
  function renderStimulus(cond) {
    const letters = [cond.flankLetter, cond.flankLetter, cond.flankLetter,
      cond.target, cond.flankLetter, cond.flankLetter, cond.flankLetter];
    let html = '<div class="flanker-letters">';
    letters.forEach((ch, i) => {
      const isTarget = i === 3;
      let color;
      if (cond.colorMode === 'diff') {
        color = isTarget ? COLOR_TARGET : COLOR_FLANK;
      } else {
        color = COLOR_SAME;
      }
      html += `<span style="color:${color}">${ch}</span>`;
    });
    html += '</div>';
    $('formal-stage').innerHTML = html;
  }

  function renderFixation() {
    $('formal-stage').innerHTML = '<div class="fixation">+</div>';
  }

  function renderBlank() {
    $('formal-stage').innerHTML = '<div class="fixation" style="color:transparent;">+</div>';
  }

  /* ---------- 试次运行 ---------- */
  function runTrial(cond, isPractice, onDone) {
    clearTimers();
    state.trial = {
      cond, isPractice, rt: null, correct: null, resp: null,
      timedOut: false, invalid: false, stimOn: null,
    };
    state.awaitingResp = false;
    renderFixation();

    // 注视点
    later(() => {
      renderStimulus(cond);
      state.trial.stimOn = performance.now();
      state.awaitingResp = true;
      if (state.gazeEnabled) GAZE.beginWindow();

      // 刺激最长呈现 1000ms
      later(() => {
        if (state.trial.rt === null && state.awaitingResp) renderBlank();
      }, STIM_MAX_MS);

      // 总反应窗口 1500ms
      later(() => {
        if (state.awaitingResp) {
          state.awaitingResp = false;
          state.trial.timedOut = true;
          state.trial.correct = false;
          if (state.gazeEnabled) GAZE.endWindow();
          finishTrial(isPractice, onDone);
        }
      }, RESP_WINDOW_MS);
    }, FIX_MS);
  }

  function finishTrial(isPractice, onDone) {
    state.awaitingResp = false;
    clearTimers();
    if (state.gazeEnabled) GAZE.endWindow();

    if (isPractice) {
      const stage = $('formal-stage');
      if (state.trial.timedOut) {
        stage.innerHTML = '<div class="feedback-timeout">超时</div>';
      } else if (state.trial.correct) {
        stage.innerHTML = '<div class="feedback-correct">正确 ✓</div>';
      } else {
        stage.innerHTML = '<div class="feedback-wrong">错误 ✗</div>';
      }
      later(onDone, 800);
    } else {
      onDone();
    }
  }

  function onKeydown(e) {
    const key = e.key.toLowerCase();
    if (key !== 'f' && key !== 'j') return;
    if (!state.awaitingResp || !state.trial) return;
    if (state.trial.rt !== null) return;

    state.awaitingResp = false;
    const now = performance.now();
    state.trial.rt = now - state.trial.stimOn;
    state.trial.resp = key;
    state.trial.correct = (key === KEY_MAP[state.trial.cond.target]);
    finishTrial(state.trial.isPractice, state.onDone);
  }

  function onBlur() {
    // 页面失焦：若处于反应期，当前试次标记为无效
    if (state.awaitingResp && state.trial && state.trial.rt === null && !state.trial.timedOut) {
      state.awaitingResp = false;
      state.trial.timedOut = true;
      state.trial.correct = false;
      state.trial.invalid = true;
      finishTrial(state.trial.isPractice, state.onDone);
    }
  }

  /* ---------- 练习 ---------- */
  function runPractice() {
    state.practiceTrials = buildPracticeTrials();
    state.practiceIdx = 0;
    show('s-formal');
    $('formal-count').textContent = '练习 ' + 1 + ' / ' + state.practiceTrials.length;
    $('formal-pct').textContent = '';
    $('formal-progress').style.width = '0%';
    nextPracticeTrial();
  }

  function nextPracticeTrial() {
    if (state.practiceIdx >= state.practiceTrials.length) { finishPractice(); return; }
    const cond = state.practiceTrials[state.practiceIdx];
    $('formal-count').textContent = '练习 ' + (state.practiceIdx + 1) + ' / ' + state.practiceTrials.length;
    $('formal-progress').style.width = (state.practiceIdx / state.practiceTrials.length * 100) + '%';

    state.onDone = () => {
      state.practiceIdx++;
      const iti = ITI_MIN_MS + Math.random() * (ITI_MAX_MS - ITI_MIN_MS);
      later(nextPracticeTrial, iti);
    };
    runTrial(cond, true, state.onDone);
  }

  function finishPractice() {
    $('practice-summary').innerHTML =
      '您已完成 <strong>' + state.practiceTrials.length + '</strong> 个练习试次。' +
      '如已理解规则，请开始正式实验。正式实验共 <strong>96</strong> 个试次，中途不提供反馈。';
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

    const cond = state.formalTrials[state.formalIdx];
    const total = state.formalTrials.length;
    $('formal-count').textContent = '正式 ' + (state.formalIdx + 1) + ' / ' + total;
    $('formal-pct').textContent = Math.round(state.formalIdx / total * 100) + '%';
    $('formal-progress').style.width = (state.formalIdx / total * 100) + '%';

    state.onDone = () => {
      const t = state.trial;
      state.trials.push({
        cond: `${t.cond.flankType}-${t.cond.colorMode}`,
        flankType: t.cond.flankType,
        colorMode: t.cond.colorMode,
        target: t.cond.target,
        flankLetter: t.cond.flankLetter,
        rt: t.rt,
        correct: t.correct,
        resp: t.resp,
        timedOut: t.timedOut,
        invalid: t.invalid,
      });
      state.formalIdx++;
      $('formal-progress').style.width = (state.formalIdx / total * 100) + '%';
      $('formal-pct').textContent = Math.round(state.formalIdx / total * 100) + '%';
      const iti = ITI_MIN_MS + Math.random() * (ITI_MAX_MS - ITI_MIN_MS);
      later(nextFormalTrial, iti);
    };
    runTrial(cond, false, state.onDone);
  }

  function finishFormal() {
    if (state.gazeEnabled) GAZE.stop();

    const record = {
      experiment: ENG.cfg.experiments.flanker.id,
      participant: state.participant,
      completedAt: new Date().toISOString(),
      session: { mode: ENG.sessionMode(), perCondition: FORMAL_PER_COND },
      gaze: state.gazeEnabled ? GAZE.summary() : null,
      trials: state.trials,
    };
    ENG.saveLocal('flanker_' + state.participant, record);
    showResult(record);
  }

  /* ---------- 统计 ---------- */
  function splitByCond(trials, flankType, colorMode) {
    const valid = [], accAll = [];
    trials.forEach((t) => {
      if (t.flankType !== flankType || t.colorMode !== colorMode) return;
      const ok = !t.invalid && !t.timedOut && t.rt !== null && isFinite(t.rt);
      if (ok) { valid.push(t.rt); accAll.push(t.correct ? 1 : 0); }
      else { accAll.push(0); }
    });
    return { rt: valid, acc: accAll };
  }

  function computeResults(trials) {
    const summary = {};
    FLANKER_TYPES.forEach((ft) => {
      COLOR_MODES.forEach((cm) => {
        const { rt, acc } = splitByCond(trials, ft, cm);
        summary[`${ft}-${cm}`] = {
          rtMean: rt.length ? ENG.mean(rt) : null,
          rtSe: rt.length > 1 ? ENG.se(rt) : null,
          acc: acc.length ? ENG.mean(acc) * 100 : null,
          nRt: rt.length,
          rtList: rt,
        };
      });
    });

    function effect(cm) {
      const inc = summary[`incompatible-${cm}`].rtList;
      const com = summary[`compatible-${cm}`].rtList;
      if (!inc.length || !com.length) return { value: null, se: null };
      const value = ENG.mean(inc) - ENG.mean(com);
      const s1 = ENG.se(inc), s2 = ENG.se(com);
      const se = (isFinite(s1) && isFinite(s2)) ? Math.sqrt(s1 * s1 + s2 * s2) : null;
      return { value, se };
    }

    const effSame = effect('same');
    const effDiff = effect('diff');
    const diffBetween = (effSame.value != null && effDiff.value != null)
      ? effSame.value - effDiff.value : null;
    const diffSe = (effSame.se != null && effDiff.se != null)
      ? Math.sqrt(effSame.se * effSame.se + effDiff.se * effDiff.se) : null;

    return { summary, effSame, effDiff, diffBetween, diffSe };
  }

  /* ---------- 结果展示 ---------- */
  function showResult(record) {
    show('s-result');
    const res = computeResults(record.trials);
    const s = res.summary;

    const labelMap = {
      'congruent-same': '相同 · 同色', 'congruent-diff': '相同 · 异色',
      'compatible-same': '相容 · 同色', 'compatible-diff': '相容 · 异色',
      'incompatible-same': '不相容 · 同色', 'incompatible-diff': '不相容 · 异色',
    };

    const allRt = record.trials.filter((t) => t.rt != null && isFinite(t.rt) && !t.invalid).map((t) => t.rt);
    const allAcc = record.trials.map((t) => (t.correct ? 1 : 0));
    const overallRt = allRt.length ? ENG.mean(allRt) : null;
    const overallAcc = record.trials.length ? ENG.mean(allAcc) * 100 : null;
    const timeoutCount = record.trials.filter((t) => t.timedOut).length;

    const effSame = res.effSame.value;
    const effDiff = res.effDiff.value;
    const diffBet = res.diffBetween;

    const h1 = effSame != null ? effSame > 0 : null;
    const h2 = diffBet != null ? diffBet > 0 : null;

    let html = '';

    html += `<p class="small muted" style="margin-bottom:2px;">
      匿名编号 <strong style="color:var(--text)">${esc(record.participant)}</strong>
      · 正式试次 <strong style="color:var(--text)">${record.trials.length}</strong>
      · 超时 ${timeoutCount}
      · 完成于 ${new Date(record.completedAt).toLocaleString('zh-CN')}
    </p>`;

    html += `<div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">总体平均正确反应时</div>
        <div class="kpi-value">${overallRt != null ? Math.round(overallRt) : '—'}<span class="unit">ms</span></div>
        <div class="kpi-sub">有效试次 ${allRt.length}</div>
      </div>
      <div class="kpi ok">
        <div class="kpi-label">总体正确率</div>
        <div class="kpi-value">${overallAcc != null ? overallAcc.toFixed(1) : '—'}<span class="unit">%</span></div>
        <div class="kpi-sub">全部正式试次</div>
      </div>
      <div class="kpi gold">
        <div class="kpi-label">经典 Flanker 效应</div>
        <div class="kpi-value">${effSame != null ? Math.round(effSame) : '—'}<span class="unit">ms</span></div>
        <div class="kpi-sub">不相容 − 相容（同色）</div>
      </div>
      <div class="kpi ${effDiff != null && effSame != null && effDiff < effSame ? 'ok' : ''}">
        <div class="kpi-label">异色条件效应</div>
        <div class="kpi-value">${effDiff != null ? Math.round(effDiff) : '—'}<span class="unit">ms</span></div>
        <div class="kpi-sub">不相容 − 相容（异色）</div>
      </div>
    </div>`;

    html += `<h3>各条件平均正确反应时与正确率</h3>`;
    html += `<table><thead><tr>
      <th>条件</th><th>平均正确 RT</th><th>标准误</th><th>正确率</th><th>有效试次</th>
    </tr></thead><tbody>`;
    FLANKER_TYPES.forEach((ft) => {
      COLOR_MODES.forEach((cm) => {
        const k = `${ft}-${cm}`;
        const d = s[k];
        html += `<tr>
          <td>${labelMap[k]}</td>
          <td>${d.rtMean != null ? Math.round(d.rtMean) + ' ms' : '—'}</td>
          <td>${d.rtSe != null ? '±' + Math.round(d.rtSe) : '—'}</td>
          <td>${d.acc != null ? d.acc.toFixed(1) + '%' : '—'}</td>
          <td>${d.nRt}</td>
        </tr>`;
      });
    });
    html += `</tbody></table>`;

    html += `<h3>六条件平均反应时</h3><div class="chart-box" id="eff-chart"></div>`;

    html += `<h3>理论预测 vs 实测效应</h3>`;
    html += `<p class="small muted" style="margin-top:0;">
      基于侧翼冲突的相容性理论与知觉分组假说，预测：① 不相容条件比相容条件更慢（H1）；
      ② 颜色分离会降低不相容带来的额外成本，即同色效应大于异色效应（H2）。
      绿色阴影为预测方向，点落在阴影内表示实测方向与预测一致。
    </p>`;
    html += `<div class="chart-box" id="forest-chart"></div>`;

    html += `<h3>假设检验</h3>`;
    html += hypoRow('H1 不相容 RT > 相容 RT（同色）',
      h1, effSame != null ? `Δ = ${Math.round(effSame)} ms` : '');
    html += hypoRow('H1（异色条件）',
      effDiff != null ? effDiff > 0 : null, effDiff != null ? `Δ = ${Math.round(effDiff)} ms` : '');
    html += hypoRow('H2 颜色分离降低干扰成本（同色效应 > 异色效应）',
      h2, diffBet != null ? `ΔΔ = ${Math.round(diffBet)} ms` : '');

    if (record.gaze && record.gaze.enabled) {
      const g = record.gaze;
      html += `<h3>眼动记录（可选模块）</h3>`;
      html += `<div class="kv"><span class="k">刺激期有效注视样本</span><span class="v">${g.samples}</span></div>`;
      html += `<div class="kv"><span class="k">注视中央区域比例</span><span class="v">${(g.onCenterRatio * 100).toFixed(1)}%</span></div>`;
      html += `<p class="tiny muted">该指标由 WebGazer 网页眼动估计得到，未做精细九点校准，仅作探索性参考。</p>`;
    }

    html += `<p class="small muted" style="margin-top:18px;">
      注：以上为单名被试的网页端结果。小样本与网页计时存在局限，详见 README 的「研究局限」。
    </p>`;

    $('result-body').innerHTML = html;

    ENG.drawBarChart($('eff-chart'), {
      data: FLANKER_TYPES.flatMap((ft) => COLOR_MODES.map((cm) => {
        const d = s[`${ft}-${cm}`];
        return {
          label: (ft === 'congruent' ? '相同' : ft === 'compatible' ? '相容' : '不相容')
            + '\n' + (cm === 'same' ? '同色' : '异色'),
          value: d.rtMean != null ? d.rtMean : 0,
          err: d.rtSe,
        };
      })),
      color: '#16385c',
      unit: 'ms',
    });

    ENG.drawForestPlot($('forest-chart'), {
      rows: [
        {
          label: 'H1 不相容 − 相容\n（同色 · 经典）',
          effect: effSame != null ? effSame : NaN,
          ci: res.effSame.se != null ? res.effSame.se * 1.96 : NaN,
          predicted: 'positive',
        },
        {
          label: 'H1 不相容 − 相容\n（异色）',
          effect: effDiff != null ? effDiff : NaN,
          ci: res.effDiff.se != null ? res.effDiff.se * 1.96 : NaN,
          predicted: 'positive',
        },
        {
          label: 'H2 同色效应 − 异色效应',
          effect: diffBet != null ? diffBet : NaN,
          ci: res.diffSe != null ? res.diffSe * 1.96 : NaN,
          predicted: 'positive',
        },
      ],
      unit: 'ms',
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
      cond: t.cond,
      flankType: t.flankType,
      colorMode: t.colorMode,
      target: t.target,
      flankLetter: t.flankLetter,
      rt: t.rt == null ? '' : Math.round(t.rt),
      correct: t.correct ? 1 : 0,
      resp: t.resp || '',
      timedOut: t.timedOut ? 1 : 0,
      invalid: t.invalid ? 1 : 0,
    }));
    ENG.downloadCSV('flanker_' + record.participant + '.csv', rows);
  }

  function buildPayload(record) {
    return {
      project: ENG.getProjectCode(),
      experiment: record.experiment,
      participant: record.participant,
      // 被试间分组留空：本实验所有被试完成同一套被试内条件
      condition: '',
      trials: record.trials.map((t) => ({
        cond: t.cond,
        rt: t.rt == null ? null : Math.round(t.rt),
        correct: t.correct ? 1 : 0,
        flankType: t.flankType,
        colorMode: t.colorMode,
        target: t.target,
        flankLetter: t.flankLetter,
        resp: t.resp || '',
        timedOut: t.timedOut ? 1 : 0,
        invalid: t.invalid ? 1 : 0,
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
          hint.textContent = '眼动记录已开启。实验期间请保持头部位置稳定，以提高估计稳定性。';
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
    const totalFormal = FORMAL_PER_COND * FLANKER_TYPES.length * COLOR_MODES.length;
    $('intro-trials').textContent =
      '整个实验约 ' + (ENG.sessionMode() === 'short' ? '5–6' : '6–8') + ' 分钟，共 '
      + totalFormal + ' 个正式试次（另有 ' + PRACTICE_TRIALS + ' 个练习试次）。请使用电脑键盘完成。';

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

    initGazeToggle();

    document.addEventListener('keydown', onKeydown);
    window.addEventListener('blur', onBlur);

    // 阻止 F / J 的浏览器默认行为
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'j') e.preventDefault();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
