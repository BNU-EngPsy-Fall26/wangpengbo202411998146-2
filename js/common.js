/**
 * common.js — 共享工具库
 * 随机化、精确计时、数据存储、上传、CSV 导出、基础统计、图表绘制
 */
(function (global) {
  'use strict';

  const CFG = global.APP_CONFIG;

  /* ===================== 随机化 ===================== */

  // Fisher–Yates 洗牌（返回新数组）
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ===================== 数据存储 ===================== */

  function storageKey(suffix) {
    return CFG.storagePrefix + suffix;
  }

  function saveLocal(key, value) {
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('本地保存失败：', e);
      return false;
    }
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(storageKey(key));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function removeLocal(key) {
    try {
      localStorage.removeItem(storageKey(key));
    } catch (e) { /* ignore */ }
  }

  /* ===================== 项目码 ===================== */

  // 项目码只在配置文件中提供；页面不提供任何可视化配置入口。
  function getProjectCode() {
    return CFG.submit.DEFAULT_PROJECT || '';
  }

  /* ===================== 会话长度 ===================== */

  // 当前会话长度模式：'standard' | 'short'（由 config.js 统一设定）
  function sessionMode() {
    const conf = CFG.session || {};
    const table = conf.perCondition || {};

    // 临时覆盖：URL 带 ?session=short 时按精简版运行（仅用于预测试/演示，
    // 正常被试访问不带该参数，仍按 config.js 的设定执行）
    let override = '';
    try {
      override = new URLSearchParams(location.search).get('session') || '';
    } catch (e) {
      override = '';
    }
    if (override && table[override]) return override;

    const mode = conf.mode || 'standard';
    return table[mode] ? mode : 'standard';
  }

  // 每条件正式试次数（16 或 12）
  function perConditionTrials() {
    const conf = CFG.session || {};
    const table = conf.perCondition || {};
    const n = table[sessionMode()];
    return typeof n === 'number' && n > 0 ? n : 16;
  }

  /* ===================== 统计 ===================== */

  function mean(arr) {
    if (!arr || arr.length === 0) return NaN;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function sd(arr) {
    if (!arr || arr.length < 2) return NaN;
    const m = mean(arr);
    const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  function se(arr) {
    const s = sd(arr);
    if (Number.isNaN(s)) return NaN;
    return s / Math.sqrt(arr.length);
  }

  // 95% 置信区间（基于 t 分布临界值的近似）
  function ci95(arr) {
    const n = arr ? arr.length : 0;
    if (n < 2) return NaN;
    const s = se(arr);
    if (!isFinite(s)) return NaN;
    const tCrit = tCritical95(n - 1);
    return tCrit * s;
  }

  // t 分布 95% 双侧临界值（小样本近似查表 + 大样本正态）
  const T_TABLE_95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447,
    7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179,
    13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101,
    19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064,
    25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
  };
  function tCritical95(df) {
    if (df <= 0) return NaN;
    if (T_TABLE_95[df]) return T_TABLE_95[df];
    if (df <= 30) return 2.042;
    if (df <= 40) return 2.021;
    if (df <= 60) return 2.000;
    if (df <= 120) return 1.980;
    return 1.960;
  }

  function median(arr) {
    if (!arr || arr.length === 0) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // 配对样本 t 统计量
  function pairedT(a, b) {
    if (!a || !b || a.length !== b.length || a.length < 2) return null;
    const d = a.map((v, i) => v - b[i]);
    const m = mean(d);
    const s = sd(d);
    if (s === 0) return { t: m === 0 ? 0 : Infinity, df: d.length - 1, p: m === 0 ? 1 : 0 };
    const t = m / (s / Math.sqrt(d.length));
    const df = d.length - 1;
    const p = 2 * (1 - normalCDF(Math.abs(t)));
    return { t, df, p };
  }

  function normalCDF(z) {
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z);
    const t = 1 / (1 + 0.2316419 * x);
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    let p = 1 - d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return sign < 0 ? 1 - p : p;
  }

  // 效应量 Cohen's dz（配对样本）
  function cohensDz(a, b) {
    if (!a || !b || a.length !== b.length || a.length < 2) return NaN;
    const d = a.map((v, i) => v - b[i]);
    const s = sd(d);
    if (!s) return NaN;
    return mean(d) / s;
  }

  function fmtP(p) {
    if (p == null || Number.isNaN(p)) return '—';
    if (p < 0.001) return 'p < .001';
    return 'p = ' + p.toFixed(3).replace(/^0/, '');
  }

  /* ===================== CSV 导出 ===================== */

  function toCSV(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const lines = [headers.join(',')];
    rows.forEach((r) => lines.push(headers.map((h) => escape(r[h])).join(',')));
    return lines.join('\r\n');
  }

  function downloadCSV(filename, rows) {
    const csv = toCSV(rows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ===================== 数据上传 ===================== */

  /**
   * 提交到一个接收 JSON 的收数接口。
   * payload: { project, experiment, participant, condition, trials:[{cond, rt, correct, ...}] }
   */
  /**
   * 提交到收数接口。
   * payload: { project, experiment, participant, condition, trials:[...], meta }
   * 成功返回 { ok:true, record_id, participants, records, warnings?, warning_details? }
   * 失败：HTTP 非 2xx，或返回体 ok:false（如项目码不存在），都会抛出错误并带上后台给的原因。
   */
  function submitToPlatform(payload) {
    if (!payload.project) {
      return Promise.reject(new Error('未设置项目码，已跳过提交。'));
    }
    return fetch(CFG.submit.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((res) => res.text().then((raw) => {
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }

      if (!res.ok) {
        const msg = (data && (data.msg || data.message)) || ('HTTP ' + res.status);
        throw new Error(msg);
      }
      if (!data) throw new Error('接口返回了无法识别的内容。');
      if (data.ok === false) throw new Error(data.msg || '接口未接受本次数据。');
      return data;
    }));
  }

  /** 把接口成功返回转成一句给人看的提示 */
  function submitResultText(res) {
    let msg = '✓ 数据已提交';
    if (res && res.record_id != null) msg += '（记录号 ' + res.record_id + '）';
    msg += '。';
    if (res && typeof res.participants === 'number') {
      msg += ' 本项目已累计 ' + res.participants + ' 名被试。';
    }
    return msg;
  }

  /* ===================== 匿名编号 ===================== */

  function randomParticipantId(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'P';
    for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  /* ===================== 绘图：柱状图 ===================== */

  /**
   * 简洁柱状图（带误差线）
   * config: { data: [{label, value, err}], color, unit, title }
   */
  function drawBarChart(container, config) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    const data = (config.data || []).filter((d) => d && isFinite(d.value));
    if (data.length === 0) {
      el.innerHTML = '<p class="small muted" style="text-align:center;margin:20px 0;">暂无数据</p>';
      return;
    }

    const width = 600, height = 320;
    const padL = 62, padR = 22, padT = 26, padB = 58;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxErr = Math.max(...data.map((d) => (isFinite(d.err) ? d.err : 0)), 0);
    let maxVal = Math.max(...data.map((d) => d.value + (isFinite(d.err) ? d.err : 0)), 0);
    if (maxVal <= 0) maxVal = 1;
    maxVal = maxVal * 1.12;

    const unit = config.unit || '';
    const color = config.color || '#16385c';

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;font-family:system-ui,-apple-system,sans-serif;" role="img">`;

    // y 网格与刻度
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const y = padT + plotH - (plotH * i / ticks);
      const val = maxVal * i / ticks;
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}"
        stroke="${i === 0 ? '#cbd5e1' : '#eef2f7'}" stroke-width="1"/>`;
      svg += `<text x="${padL - 9}" y="${y + 4}" text-anchor="end"
        font-size="10.5" fill="#94a3b8">${formatTick(val)}</text>`;
    }
    svg += `<text x="14" y="${padT + plotH / 2}" transform="rotate(-90 14 ${padT + plotH / 2})"
      text-anchor="middle" font-size="10.5" fill="#94a3b8">${unit}</text>`;

    const n = data.length;
    const slot = plotW / n;
    const barW = Math.min(62, slot * 0.52);

    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = Math.max((d.value / maxVal) * plotH, 0);
      const y = padT + plotH - h;

      // 柱体渐变
      const gid = 'barGrad' + i;
      svg += `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.68"/>
      </linearGradient></defs>`;
      svg += `<rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${h}"
        rx="4" fill="url(#${gid})"/>`;

      // 误差线
      if (isFinite(d.err) && d.err > 0) {
        const eh = (d.err / maxVal) * plotH;
        svg += `<line x1="${cx}" y1="${y - eh}" x2="${cx}" y2="${y + eh}"
          stroke="#0f172a" stroke-width="1.4" stroke-linecap="round"/>`;
        svg += `<line x1="${cx - 7}" y1="${y - eh}" x2="${cx + 7}" y2="${y - eh}"
          stroke="#0f172a" stroke-width="1.4" stroke-linecap="round"/>`;
        svg += `<line x1="${cx - 7}" y1="${y + eh}" x2="${cx + 7}" y2="${y + eh}"
          stroke="#0f172a" stroke-width="1.4" stroke-linecap="round"/>`;
      }

      // 数值标签
      svg += `<text x="${cx}" y="${y - (isFinite(d.err) && d.err > 0 ? (d.err / maxVal) * plotH + 9 : 8)}"
        text-anchor="middle" font-size="11.5" font-weight="700" fill="#0e2a47">${formatTick(d.value)}</text>`;

      // x 标签（支持换行）
      const lines = String(d.label).split('\n');
      lines.forEach((line, li) => {
        svg += `<text x="${cx}" y="${padT + plotH + 20 + li * 13}" text-anchor="middle"
          font-size="10.5" fill="#64748b">${escapeXml(line)}</text>`;
      });
    });

    svg += '</svg>';

    let html = svg;
    if (config.title) {
      html = `<div class="tiny" style="text-align:center;color:var(--muted);margin-bottom:6px;">${escapeXml(config.title)}</div>` + html;
    }
    el.innerHTML = html;
  }

  /* ===================== 绘图：森林图（预测 vs 实测） ===================== */

  /**
   * 森林图：展示各对比的实测效应 + 95%CI，并与理论预测方向对照。
   * 这是「模型预测 vs 实测」的可视化。
   *
   * config: {
   *   rows: [{
   *     label: 对比名称,
   *     effect: 实测效应量（数值）,
   *     ci: 95%CI 半宽（数值，可为 NaN）,
   *     predicted: 'positive' | 'negative' | null   // 理论预测方向
   *   }],
   *   unit: 'ms' | '百分点',
   *   title
   * }
   */
  function drawForestPlot(container, config) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return;

    const rows = (config.rows || []).filter((r) => r && isFinite(r.effect));
    if (rows.length === 0) {
      el.innerHTML = '<p class="small muted" style="text-align:center;margin:20px 0;">暂无可比较的效应</p>';
      return;
    }

    const labelW = 210;      // 左侧标签宽
    const plotW = 250;       // 绘图区宽
    const rightW = 118;      // 右侧数值宽
    const width = labelW + plotW + rightW;
    const rowH = 46;
    const padT = 42;
    const padB = 30;
    const height = padT + rows.length * rowH + padB;

    // 计算 x 轴范围（含 0 与所有 CI）
    let minV = 0, maxV = 0;
    rows.forEach((r) => {
      const c = isFinite(r.ci) ? Math.abs(r.ci) : 0;
      minV = Math.min(minV, r.effect - c);
      maxV = Math.max(maxV, r.effect + c);
    });
    const span = Math.max(maxV - minV, 1);
    const padSpan = span * 0.14;
    minV -= padSpan; maxV += padSpan;
    const x0 = labelW;
    const xScale = (v) => x0 + ((v - minV) / (maxV - minV)) * plotW;
    const zeroX = xScale(0);

    const unit = config.unit || '';

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;height:auto;font-family:system-ui,-apple-system,sans-serif;" role="img">`;

    // 预测方向阴影区
    rows.forEach((r, i) => {
      const y = padT + i * rowH;
      if (r.predicted === 'positive') {
        svg += `<rect x="${zeroX}" y="${y + 6}" width="${x0 + plotW - zeroX}" height="${rowH - 12}"
          fill="#0f766e" opacity="0.06"/>`;
      } else if (r.predicted === 'negative') {
        svg += `<rect x="${x0}" y="${y + 6}" width="${zeroX - x0}" height="${rowH - 12}"
          fill="#0f766e" opacity="0.06"/>`;
      }
    });

    // 0 基准线
    svg += `<line x1="${zeroX}" y1="${padT - 8}" x2="${zeroX}" y2="${padT + rows.length * rowH + 4}"
      stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    svg += `<text x="${zeroX}" y="${padT - 16}" text-anchor="middle"
      font-size="10" fill="#94a3b8">0</text>`;

    // 行
    rows.forEach((r, i) => {
      const y = padT + i * rowH + rowH / 2;
      const c = isFinite(r.ci) ? Math.abs(r.ci) : 0;

      // 左侧标签
      const labelLines = String(r.label).split('\n');
      labelLines.forEach((line, li) => {
        svg += `<text x="2" y="${y - (labelLines.length - 1) * 6 + li * 13 + 4}"
          font-size="10.5" fill="#475569">${escapeXml(line)}</text>`;
      });

      // CI 线
      if (c > 0) {
        const lo = xScale(r.effect - c);
        const hi = xScale(r.effect + c);
        svg += `<line x1="${lo}" y1="${y}" x2="${hi}" y2="${y}"
          stroke="#0e2a47" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`;
        // 端帽
        svg += `<line x1="${lo}" y1="${y - 5}" x2="${lo}" y2="${y + 5}" stroke="#0e2a47" stroke-width="1.6" opacity="0.55"/>`;
        svg += `<line x1="${hi}" y1="${y - 5}" x2="${hi}" y2="${y + 5}" stroke="#0e2a47" stroke-width="1.6" opacity="0.55"/>`;
      }

      // 点估计
      const px = xScale(r.effect);
      const supports = r.predicted === 'positive' ? r.effect > 0
        : r.predicted === 'negative' ? r.effect < 0
        : null;
      const dotColor = supports === false ? '#b42318' : (supports === true ? '#0f766e' : '#0e2a47');
      svg += `<circle cx="${px}" cy="${y}" r="6" fill="${dotColor}" stroke="#fff" stroke-width="1.8"/>`;

      // 右侧数值
      const valTxt = (r.effect >= 0 ? '+' : '') + formatTick(r.effect) + (unit ? ' ' + unit : '');
      svg += `<text x="${x0 + plotW + 10}" y="${y + 4}" font-size="11" font-weight="700"
        fill="${dotColor}" font-family="ui-monospace,Consolas,monospace">${escapeXml(valTxt)}</text>`;

      // 预测符合性对勾
      if (supports !== null) {
        svg += `<text x="${x0 + plotW + 10 + 78}" y="${y + 4}" font-size="12"
          fill="${dotColor}" font-weight="700">${supports ? '✓' : '✗'}</text>`;
      }
    });

    // 底部说明
    svg += `<text x="${x0}" y="${height - 10}" font-size="9.5" fill="#94a3b8">
      效应量 ${escapeXml(unit)}（点 = 实测，横线 = 95% CI）</text>`;
    svg += `<text x="${x0 + plotW + 10}" y="${height - 10}" font-size="9.5" fill="#94a3b8">实测 / 预测</text>`;

    svg += '</svg>';

    let html = '';
    if (config.title) {
      html += `<div class="tiny" style="text-align:center;color:var(--muted);margin-bottom:4px;">${escapeXml(config.title)}</div>`;
    }
    html += svg;
    html += `<div class="chart-caption">绿色阴影 = 理论预测的效应方向；点落在阴影内表示实测与预测方向一致，红色点表示与预测相反。</div>`;
    el.innerHTML = html;
  }

  /* ===================== 绘图辅助 ===================== */

  function formatTick(v) {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toString();
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMs(ms) {
    return ms == null || !isFinite(ms) ? '—' : Math.round(ms) + ' ms';
  }

  global.ENG = {
    shuffle,
    saveLocal,
    loadLocal,
    removeLocal,
    getProjectCode,
    sessionMode,
    perConditionTrials,
    mean,
    sd,
    se,
    ci95,
    median,
    pairedT,
    cohensDz,
    fmtP,
    toCSV,
    downloadCSV,
    submitToPlatform,
    submitResultText,
    randomParticipantId,
    drawBarChart,
    drawForestPlot,
    fmtMs,
    cfg: CFG,
  };
})(window);
