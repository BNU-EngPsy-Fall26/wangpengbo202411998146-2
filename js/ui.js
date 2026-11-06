/**
 * ui.js — 共享 UI 组件
 * 步骤条（Stepper）
 */
(function (global) {
  'use strict';

  /* ===================== 步骤条 ===================== */

  /**
   * 创建步骤条
   * @param {HTMLElement|string} container 容器或其 id
   * @param {string[]} labels 步骤名
   * @returns {{setActive:function, setDone:function, el:HTMLElement}}
   */
  function createStepper(container, labels) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) return null;

    el.className = 'stepper';
    el.innerHTML = labels.map((label, i) => `
      <div class="step" data-step="${i}">
        <div class="dot">${i + 1}</div>
        <div class="step-label">${label}</div>
      </div>
    `).join('');

    const stepEls = Array.from(el.querySelectorAll('.step'));

    return {
      el,
      setActive(index) {
        stepEls.forEach((s, i) => {
          s.classList.toggle('active', i === index);
          s.classList.toggle('done', i < index);
          const dot = s.querySelector('.dot');
          if (dot) dot.textContent = i < index ? '✓' : String(i + 1);
        });
      },
      setDone(index) {
        if (stepEls[index]) {
          stepEls[index].classList.remove('active');
          stepEls[index].classList.add('done');
          const dot = stepEls[index].querySelector('.dot');
          if (dot) dot.textContent = '✓';
        }
      },
    };
  }

  global.ENG_UI = {
    createStepper,
  };
})(window);
