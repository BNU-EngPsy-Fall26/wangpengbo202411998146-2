/**
 * config.js — 全局配置
 * 工程心理学作业二：双实验交互式网页
 *
 * 数据默认保存在浏览器本地，并可一键导出 CSV。
 * 如需将数据提交到课程的收数接口，把六位项目码填入 DEFAULT_PROJECT 即可，
 * 页面本身不提供任何配置入口。
 */
window.APP_CONFIG = {
  submit: {
    url: 'https://attention-lab-production.up.railway.app/api/hw2/submit',
    // 只读接口：读取本项目已提交的匿名记录，用于展示全体结果（需要项目码，不需要下载密钥）
    dataUrl: 'https://attention-lab-production.up.railway.app/api/hw2/data',
    // 六位项目码（公开标识，写入网页即可）；下载密钥不要写在这里。
    // 留空则跳过提交，只做本地保存与 CSV 导出。
    DEFAULT_PROJECT: 'U9VNVY',
  },

  // 实验标识（两个实验使用不同 experiment 标识，便于区分数据）
  experiments: {
    flanker: {
      id: 'flanker_improved',
      name: 'Flanker 侧翼干扰实验',
      shortName: 'Flanker',
    },
    cleveland: {
      id: 'cleveland_improved',
      name: 'Cleveland–McGill 图形知觉实验',
      shortName: 'Cleveland–McGill',
    },
  },

  // 会话长度：'standard' 或 'short'，由研究者在正式收集数据前统一设定，
  // 被试无法选择；实际取值会写入数据记录（session.mode / session.perCondition）。
  //   standard：每条件 16 次（Flanker 96、图形知觉 48）
  //   short   ：每条件 12 次（Flanker 72、图形知觉 36）
  // 两种取值均满足「每条件 ≥ 10 个正式试次」的验收下限。
  session: {
    mode: 'standard',
    perCondition: { standard: 16, short: 12 },
  },

  // 本地存储键名前缀
  storagePrefix: 'engpsy_hw2_',
};
