/**
 * gaze.js — 可选的眼动记录模块
 *
 * 使用自托管的 WebGazer（js/vendor/webgazer.js）记录被试注视位置，
 * 计算「刺激呈现期间注视中央区域的时间比例」，作为一个粗略的注意分配指标。
 *
 * 设计原则（重要）：
 *   1. 默认关闭，必须由被试/研究者主动开启。
 *   2. 懒加载，不开启时不加载 1.6MB 的 WebGazer 库，不影响实验性能。
 *   3. 任何失败都静默降级，绝不阻塞或中断实验主流程。
 *   4. 只记录「是否注视中央区域」的汇总比例，不上传原始坐标，保护隐私。
 *   5. 未做精细九点校准，指标仅作探索性参考（README 中已说明局限）。
 */
(function (global) {
  'use strict';

  const state = {
    loaded: false,
    running: false,
    recording: false,   // 是否处于"应记录"的刺激窗口内
    samples: 0,         // 刺激窗口内的有效样本数
    onCenter: 0,        // 其中注视中央区域的样本数
    sumDist: 0,         // 距中心的归一化距离之和
    error: null,
    startTime: null,
  };

  // 中央区域半径（占视口短边的比例）
  const CENTER_RADIUS_RATIO = 0.18;

  function isSecureContext() {
    return location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      location.protocol === 'file:';
  }

  function isSupported() {
    // file:// 下现代浏览器会拒绝 getUserMedia，因此明确提示
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const notFile = location.protocol !== 'file:';
    return hasMedia && notFile && isSecureContext();
  }

  function supportReason() {
    if (location.protocol === 'file:') {
      return '当前以 file:// 方式打开，浏览器禁止摄像头访问。请用本地服务器运行（python -m http.server）后通过 http://localhost 打开。';
    }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      return '当前浏览器不支持摄像头访问（getUserMedia）。';
    }
    return '当前环境不支持眼动记录。';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-webgazer]')) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.webgazer = '1';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('WebGazer 脚本加载失败：' + src));
      document.head.appendChild(s);
    });
  }

  /**
   * 启动眼动记录
   * @returns {Promise<void>}
   */
  async function start() {
    if (state.running) return;
    if (!isSupported()) throw new Error(supportReason());

    if (!state.loaded) {
      await loadScript('js/vendor/webgazer.js');
      state.loaded = true;
    }

    const wg = global.webgazer;
    if (!wg) throw new Error('WebGazer 未正确加载。');

    // 隐藏所有可视化元素，避免干扰实验刺激
    try {
      if (typeof wg.showVideoPreview === 'function') wg.showVideoPreview(false);
      if (typeof wg.showPredictionPoints === 'function') wg.showPredictionPoints(false);
      if (typeof wg.applyKalmanFilter === 'function') wg.applyKalmanFilter(true);
    } catch (e) { /* 忽略版本差异 */ }

    await wg.begin();

    // 清理 WebGazer 可能插入页面的 video / canvas，避免遮挡实验
    setTimeout(hideWebgazerArtifacts, 600);

    wg.setGazeListener((data) => {
      if (!data || !state.recording) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = vw / 2;
      const cy = vh / 2;
      const dx = data.x - cx;
      const dy = data.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = Math.min(vw, vh) * CENTER_RADIUS_RATIO;

      state.samples++;
      state.sumDist += dist / Math.min(vw, vh);
      if (dist <= radius) state.onCenter++;
    });

    state.running = true;
    state.startTime = performance.now();
  }

  function hideWebgazerArtifacts() {
    // WebGazer 会把 video/canvas 以固定定位插入 body，这里统一隐藏
    document.querySelectorAll('body > video, body > canvas').forEach((el) => {
      // 只隐藏 WebGazer 生成的元素（避免误伤页面自身元素）
      if (el.id && /webgazer/i.test(el.id)) { el.style.display = 'none'; return; }
      if (!el.closest('#app') && !el.closest('.wrap')) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }

  /**
   * 停止记录并释放摄像头
   */
  function stop() {
    const wg = global.webgazer;
    if (wg && typeof wg.end === 'function') {
      try { wg.end(); } catch (e) { /* ignore */ }
    }
    state.running = false;
    state.recording = false;
    hideWebgazerArtifacts();
  }

  /** 进入刺激窗口（开始计入样本） */
  function beginWindow() {
    if (state.running) state.recording = true;
  }

  /** 离开刺激窗口 */
  function endWindow() {
    state.recording = false;
  }

  /**
   * 汇总指标
   * @returns {{enabled:boolean, samples:number, onCenterRatio:number|null, meanDistRatio:number|null}}
   */
  function summary() {
    const enabled = state.running && state.samples > 0;
    return {
      enabled,
      samples: state.samples,
      onCenterRatio: state.samples > 0 ? state.onCenter / state.samples : null,
      meanDistRatio: state.samples > 0 ? state.sumDist / state.samples : null,
      error: state.error,
    };
  }

  function reset() {
    state.samples = 0;
    state.onCenter = 0;
    state.sumDist = 0;
    state.error = null;
  }

  function isRunning() {
    return state.running;
  }

  global.ENG_GAZE = {
    isSupported,
    supportReason,
    start,
    stop,
    beginWindow,
    endWindow,
    summary,
    reset,
    isRunning,
  };
})(window);
