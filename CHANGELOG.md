# 迭代日志 · Changelog

本文档记录本项目的**功能与文档变更**。格式结合日期与简要条目，便于备赛版本追溯。

This file tracks **feature and documentation changes** for this project.

---

## [未发布] · Unreleased

当前无待定变更。

---

## 2026-04-12 — 本机数据库合并 · Unified local storage

### 中文

- **本地存储**：成绩库（总决赛等行）与「已存试算」合并为单一 `localStorage` 键 `model-aircraft-local-db-v1`；首次打开时自动从旧键迁移并删除 `model-aircraft-ref-scores-v1`、`model-aircraft-score-snapshots-v1`。页面标题与说明改为「本机数据库」。

### English

- **Storage**: Reference rows and saved trials share one JSON blob (`model-aircraft-local-db-v1`); legacy keys are migrated on first load and removed. Hub copy updated to “local database”.

---

## 2026-04-11 — 文档与界面整理 · Docs & UI polish

### 中文

- **README**：同步功能说明（参数重要性换位动画、公式变量高亮、三种对照方式、底部双栏等高、KaTeX `trust` 等）。
- **界面（既有实现，文档补记）**：「成绩库与对照」分区说明与并排表引导；「逐项差距 / 结果矩阵」命名与分工；参数重要性条形图复用 DOM 以避免换位动画被刷新打断。

### English

- **README**: Feature list updated (importance reorder animation, formula variable highlight, three compare modes, equal-height panels, KaTeX `trust` note).
- **UI (already in `index.html`, noted in docs)**: Hub copy and compare-table hint; clearer naming for delta table vs matrix; importance bars keep DOM across updates for smoother reorder animation.

---

## 2026-04-10 — 初始公开版本 · Initial public release

### 中文

- **核心计算**：按 CUADC 2026《无人机短距起降》规则 6.1 实现单轮 \(S_{\mathrm{turn}}\) 试算（含 \(M\)、分段 \(B\)、\(Z\)），\(d>2.4\,\mathrm{m}\) 时 \(B=0\) 并提示以现场裁判为准。
- **界面**：浅色 / 深色 / 系统主题；响应式布局；公式 KaTeX 渲染（宽屏横排、窄屏堆叠）。
- **输入**：\(W_{\mathrm{payload}}\)、\(W_{\mathrm{empty}}\)、\(b\)、\(d\) 数字输入与滑块联动。
- **可视化**：单轮成绩柱状图（当前试算与一、二、三等奖参考）；起飞距离与 \(B\) 分段色带标尺。
- **成绩库**：2025 总决赛等内置参考数据，支持检索、本地增删改、恢复默认。
- **快照**：保存命名版本、选择基准快照、参数与 \(S_{\mathrm{turn}}\) 差值表；多方案对比表。
- **文档**：新增中英文 `README.md` 与本迭代日志 `CHANGELOG.md`。

### English

- **Scoring core**: Implements rule **6.1** single-round \(S_{\mathrm{turn}}\) with \(M\), piecewise \(B\), and \(Z\); for \(d>2.4\,\mathrm{m}\), uses \(B=0\) with an on-page disclaimer.
- **UI**: Light/dark/system themes; responsive layout; KaTeX for formulas (stacked vs row layouts).
- **Inputs**: Sliders and numeric fields for masses, span, and takeoff distance.
- **Visualization**: Bar chart vs tier references; takeoff-distance ribbon for \(B\) bands.
- **Reference library**: Embedded finals data with search, local edits, and reset.
- **Snapshots**: Named saves, baseline selection, diff tables vs current parameters; multi-snapshot comparison.
- **Docs**: Added bilingual `README.md` and this `CHANGELOG.md`.

---

## 版本说明 · Versioning

本项目为静态页面，**未强制语义化版本号**；以 `CHANGELOG.md` 中的日期条目为主。若后续引入标签（如 `v1.0.0`），将在此补充说明。

For this static site, **SemVer tags are optional**; date-stamped entries in this file are the source of truth unless git tags are introduced later.
