# CUADC 成绩计算器 · Score Calculator

[中文](#简介) · [English](#introduction)

---

## 简介

单页 Web 应用，依据《**2026 中国大学生飞行器设计创新大赛竞赛规则**》中「**无人机短距起降**」项目 **第 6.1 条**，估算**单轮**得分 \(S_{\mathrm{turn}}\)。赛项口语中的「**微固**」即本项目（微型固定翼、短距起降与有效载荷计分）。

**本工具仅供备赛估算与方案对比，不构成对竞赛规则的官方解释；最终以大赛发布的规则文本与现场裁判为准。**

### 功能概览

- **参数试算**：有效载荷 \(W_{\mathrm{payload}}\)（g）、空机质量 \(W_{\mathrm{empty}}\)（g）、最大翼展 \(b\)（mm）、起飞距离 \(d\)（m）；数字框与滑块联动；同步显示 \(B\)、\(M\)、\(Z\) 与 \(S_{\mathrm{turn}}\)（保留两位小数，且不小于 0）。
- **公式与交互**：页内使用 KaTeX 渲染规则 6.1 相关公式；聚焦某一参数输入时，公式区对应变量会高亮（`\htmlClass` + 受控 `trust`）。
- **灵敏度与重要性**：各参数对得分的影响曲线（迷你折线）；「参数重要性排序」按单参数全范围扫描的 \(\max S-\min S\) 排序，**排位变化时行位移动画**（尊重系统「减少动态效果」设置）。
- **数据可视化**：柱状图对比「当前试算」与成绩库中一、二、三等奖参考柱；可设最多三条**自定分数线**（图中虚线）；起飞距离与 \(B\) 分段色带标尺。
- **成绩库**：内置 2025 总决赛等参考数据（弹窗表格可检索、自填入库、恢复默认），仅存本机浏览器。
- **已存试算（快照）**：在参数区勾选保存；可载入、在列表中「对比」最多两条以展开**并排三列表**；与总决赛库数据源不同，页面文案已区分说明。
- **对照与比较**（三种用途，见页内「成绩库与对照」说明）：
  - **逐项差距**：当前输入相对**一条已存试算**的数值与 \(\Delta\)（含 \(S_{\mathrm{turn}}\)）。
  - **结果比较矩阵**：任选**基准**与**多列对比**（已存试算与总决赛库混选；矩阵内不含实时「当前输入」列）。
- **界面主题**：浅色 / 深色 / 跟随系统，偏好在 `localStorage` 中保存；底部「数据可视化」与「对照与比较」并排时**等高底对齐**。

### 技术说明

- 纯静态：**单个 `index.html`**，无构建步骤。
- 依赖 CDN：KaTeX（含 auto-render，部分公式使用 `\htmlClass` 需 `trust`）、Google Fonts（Inter / Noto Sans SC / JetBrains Mono）。
- 数据仅存用户浏览器本地：成绩库与已存试算合并为**一条** `localStorage` 记录（键名 `model-aircraft-local-db-v1`，由旧版两键自动迁移）；清除站点数据或换设备会丢失。

### 本地使用

1. 克隆本仓库或下载 `index.html`。
2. 用浏览器直接打开 `index.html`，或通过任意静态文件服务器打开项目目录（便于部分浏览器对 `file://` 的限制）。

示例（已安装 Node.js）：

```bash
npx --yes serve .
```

然后在浏览器中访问终端里提示的本地地址。

### 与规则的关系

- 总成绩取**两轮较高者**（规则 6.2），**本页仅计算单轮** \(S_{\mathrm{turn}}\)。
- 起飞距离 \(d > 2.4\,\mathrm{m}\) 时，规则 6.1 仅列出两档 \(B\)；工具按 \(B=0\) 提示警告，请以现场裁判解释为准。

---

## Introduction

A single-page, static web app that estimates the **single-round** score \(S_{\mathrm{turn}}\) for the **CUADC 2026** ruleset, section **6.1**, event **“UAV short takeoff and landing”** (often called **“微固”** in casual Chinese among teams).

**This tool is for training and design trade-offs only. It is not an official interpretation of the competition rules; the published rules and field officials prevail.**

### Features

- **Inputs**: payload, empty mass, wingspan \(b\) (mm), takeoff distance \(d\) (m), with linked sliders; shows \(B\), \(M\), \(Z\), and \(S_{\mathrm{turn}}\) (two decimals, floored at 0).
- **Formulas**: KaTeX-rendered rule 6.1 math; focusing an input highlights the matching symbol in the formula strip (via `\htmlClass` with a narrow `trust` policy).
- **Sensitivity & importance**: per-parameter impact mini-charts; an **importance ranking** bar list sorted by score range per parameter, with a **reorder animation** when ranks change (respects `prefers-reduced-motion`).
- **Charts**: bar chart vs prize-tier references; up to three **custom score lines**; takeoff ribbon for \(B\) bands.
- **Reference library**: embedded finals data (searchable modal, local edits, reset); browser-only storage.
- **Saved trials**: optional save from the form; load back, or pick up to two for a **three-column** comparison with the current trial (distinct from the finals table rows).
- **Compare tools**: (1) row-wise **delta vs one saved trial** while editing; (2) **matrix** baseline vs multiple targets mixing saved trials and library rows (no live “current input” column in the matrix).
- **Theme**: light / dark / system; bottom **viz** and **compare** panels align in height on wide layouts.

### Tech stack

- One file: `index.html` (no bundler).
- CDN: KaTeX (+ auto-render), Google Fonts.
- Browser storage: reference library rows and saved trials are stored together under `localStorage` key `model-aircraft-local-db-v1` (migrates from older split keys on first load).

### Local use

Open `index.html` in a browser, or serve the folder with any static server (see command above).

### Rules note

- **Overall** score uses the **better of two rounds** (rule 6.2); **this page computes one round only**.
- For \(d > 2.4\,\mathrm{m}\), rule 6.1 only tabulates two \(B\) bands; the tool sets \(B = 0\) with a warning—follow the officials on site.

---

## Repository

GitHub: [stianyu798-arch/CUADC-Score-Cauculator](https://github.com/stianyu798-arch/CUADC-Score-Cauculator)
