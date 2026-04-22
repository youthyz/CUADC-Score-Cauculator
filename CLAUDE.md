# CUADC-Score-Cauculator

## 项目简介

CUADC 2026（中国大学生飞行器设计创新大赛）无人机短距起降（微固）单项分数计算器。

基于比赛规则6.1计算单轮得分 S_turn，帮助参赛队伍快速评估和优化参数配置。

## 技术栈

- **纯前端静态应用** - 无构建步骤，单HTML文件
- **CDN依赖**：
  - KaTeX（公式渲染）
  - Google Fonts（Inter, Noto Sans SC, JetBrains Mono）
- **数据存储**：localStorage（key: `model-aircraft-local-db-v1`）

## 文件结构

```
CUADC-Score-Cauculator/
├── index.html    (3202行，结构清晰的HTML)
├── styles.css    (2437行，所有样式代码)
├── app.js        (3137行，所有JavaScript逻辑)
├── README.md
├── CHANGELOG.md
└── CLAUDE.md
```

## 核心计算逻辑

```
S_turn = 3 * (Wp/453) * M * B + Z

其中：
- Wp = 载荷重量 (g)
- We = 空机质量 (g)
- b = 翼展 (mm)
- d = 起飞距离 (m)
- B = 起飞距离系数 (d≤1.2m → 20, 1.2<d≤2.4m → 15, 否则 0)
- M = 11 / ((We/453 - 1)^4 + 8.9)
- Z = B - (b/305)^1.5
```

## 开发指南

- 直接用浏览器打开 `index.html` 即可运行
- 推送至 main 分支会自动部署到 GitHub Pages
- 代码风格：无注释偏好，语义化命名

## 功能模块

1. 参数输入（载荷、空机质量、翼展、起飞距离）
2. 公式可视化（KaTeX渲染，焦点高亮）
3. 敏感性分析（参数影响图表）
4. 重要性排名（动画柱状图）
5. 参考数据库（2025决赛32队数据）
6. 快照系统（保存/加载/对比配置）
