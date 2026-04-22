(function () {

      /** 旧版独立存储键，首次启动时合并进 UNIFIED_DB_KEY 后移除 */
      const STORAGE_KEY_LEGACY = "model-aircraft-score-snapshots-v1";
      const REF_LIB_KEY_LEGACY = "model-aircraft-ref-scores-v1";
      /** 本机统一数据库：总决赛成绩库行 + 用户保存的试算参数（单键 JSON） */
      const UNIFIED_DB_KEY = "model-aircraft-local-db-v1";

      function chartPalette() {
        const st = getComputedStyle(document.documentElement);
        function pick(n, fb) {
          const v = st.getPropertyValue(n).trim();
          return v || fb;
        }
        return {
          black: pick("--chart-bar-fill", "#000000"),
          ref: pick("--chart-ref-fill", "#6b7280"),
          nearBlack: pick("--chart-value-text", "#1c2024"),
          slate: pick("--chart-axis-text", "#60646c"),
          white: pick("--chart-surface", "#ffffff"),
        };
      }

      function roundInt(x) {
        return Math.round(Number(x) || 0);
      }

      function factorB(takeoffM) {
        const t = Number(takeoffM);
        if (Number.isNaN(t) || t < 0) return { B: 0, warn: "起飞距离无效" };
        if (t <= 1.2) return { B: 20, warn: "" };
        return { B: 15, warn: "" };
      }

      function computeTurn(wp, we, bmm, takeoffM) {
        const Wp = roundInt(wp);
        const We = roundInt(we);
        const b = roundInt(bmm);
        const { B, warn } = factorB(takeoffM);
        const denom = Math.pow(We / 453 - 1, 4) + 8.9;
        const M = 11 / denom;
        const Z = B - Math.pow(b / 305, 1.5);
        /* 规程 6.1：S_turn = 3*(Wp/453)*M*B + Z */
        let S = 3 * (Wp / 453) * M * B + Z;
        if (S < 0) S = 0;
        S = Math.round(S * 100) / 100;
        return { Wp, We, b, B, M, Z, S, warn };
      }

      function readInputs() {
        return {
          wp: document.getElementById("wp").value,
          we: document.getElementById("we").value,
          b: document.getElementById("b").value,
          takeoff: document.getElementById("takeoff").value,
        };
      }

      /** 兼容旧快照中的 t1；缺省按 1.5 m */
      function takeoffFromSnap(s) {
        if (!s) return 1.5;
        if (s.takeoff != null && Number.isFinite(Number(s.takeoff))) return Number(s.takeoff);
        if (s.t1 != null && Number.isFinite(Number(s.t1))) return Number(s.t1);
        return 1.5;
      }

      function snapshotFromInputs() {
        const x = readInputs();
        return {
          wp: roundInt(x.wp),
          we: roundInt(x.we),
          b: roundInt(x.b),
          takeoff: Number(x.takeoff),
          at: Date.now(),
        };
      }

      const DIFF_IDX_KEY = "model-aircraft-diff-base-idx";
      const COMP_BASE_KEY = "model-aircraft-comp-base-idx";

      /** 参数重要性上一帧的 key 顺序（与 rows.sort 后一致），用于排序变化时的位移动画 */
      let lastImportanceOrderKeys = null;

      function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      }

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function getImportanceGroupTranslateY(g) {
        const tr = g.getAttribute("transform") || "";
        const m = /translate\(\s*0\s*,\s*([-0-9.eE]+)\s*\)/.exec(tr);
        return m ? parseFloat(m[1]) : 0;
      }

      /**
       * SVG 组从 y0 动画到 y1（仅改 transform）。
       * 用 isConnected 判断节点是否仍挂在文档中；勿用全局 generation 与 update 抢跑，否则滑块高频重绘会立刻取消动画。
       */
      function animateImportanceGroupY(g, y0, y1, durationMs) {
        if (!g) return;
        if (g._impAnimRaf != null) {
          cancelAnimationFrame(g._impAnimRaf);
          g._impAnimRaf = null;
        }
        const dur = Math.max(0, durationMs);
        if (dur <= 0 || y0 === y1) {
          g.setAttribute("transform", "translate(0," + y1 + ")");
          return;
        }
        const t0 = performance.now();
        function frame(now) {
          if (!g.isConnected) {
            g._impAnimRaf = null;
            return;
          }
          const u = Math.min(1, (now - t0) / dur);
          const y = y0 + (y1 - y0) * easeOutCubic(u);
          g.setAttribute("transform", "translate(0," + y + ")");
          if (u < 1) g._impAnimRaf = requestAnimationFrame(frame);
          else {
            g._impAnimRaf = null;
            g.setAttribute("transform", "translate(0," + y1 + ")");
          }
        }
        g._impAnimRaf = requestAnimationFrame(frame);
      }

      /** 固定其余输入，单参数扫描曲线 + 当前值竖线 */
      function renderSensitivityCharts() {
        const P = chartPalette();
        const accent =
          getComputedStyle(document.documentElement).getPropertyValue("--legal-blue").trim() || "#476cff";
        const wp0 = roundInt(document.getElementById("wp").value);
        const we0 = roundInt(document.getElementById("we").value);
        const b0 = roundInt(document.getElementById("b").value);
        const t0 = Number(document.getElementById("takeoff").value);

        function miniLine(hostId, curEl, xMin, xMax, steps, getS, x0, fmtCur) {
          const host = document.getElementById(hostId);
          if (!host || !curEl) return;
          const n = Math.max(12, steps | 0);
          const pts = [];
          let sMin = Infinity;
          let sMax = -Infinity;
          for (let i = 0; i <= n; i++) {
            const x = xMin + (xMax - xMin) * (i / n);
            const s = getS(x);
            if (Number.isFinite(s)) {
              pts.push({ x, s });
              if (s < sMin) sMin = s;
              if (s > sMax) sMax = s;
            }
          }
          if (!pts.length) return;
          if (sMin === sMax) {
            sMin -= 0.5;
            sMax += 0.5;
          }
          /* 纵轴留边：曲线在灰色绘图区内上下留白，视觉更居中 */
          const sSpan0 = sMax - sMin || 1;
          const yMargin = Math.max(sSpan0 * 0.07, 0.4);
          sMin -= yMargin;
          sMax += yMargin;

          const pad = { l: 26, r: 4, t: 8, b: 14 };
          const w = Math.max(host.clientWidth || 260, 160);
          let hPx = host.clientHeight;
          if (!hPx || hPx < 40) hPx = host.getBoundingClientRect().height;
          if (!hPx || hPx < 40) hPx = 100;
          const h = Math.max(76, Math.min(108, Math.round(hPx)));
          const innerW = w - pad.l - pad.r;
          const innerH = h - pad.t - pad.b;
          const span = xMax - xMin || 1;
          const sSpan = sMax - sMin || 1;
          function xScale(xv) {
            return pad.l + ((xv - xMin) / span) * innerW;
          }
          function yScale(sv) {
            return pad.t + innerH * (1 - (sv - sMin) / sSpan);
          }
          let dPath = "";
          pts.forEach(function (p, i) {
            const px = xScale(p.x);
            const py = yScale(p.s);
            dPath += (i === 0 ? "M " : " L ") + px + " " + py;
          });
          const xClamped = Math.min(xMax, Math.max(xMin, x0));
          const s0 = getS(xClamped);
          const cx = xScale(xClamped);
          const cy = yScale(Math.min(sMax, Math.max(sMin, Number.isFinite(s0) ? s0 : sMin)));

          curEl.textContent =
            "当前：" +
            fmtCur(xClamped) +
            " → S=" +
            (Number.isFinite(s0) ? s0.toFixed(2) : "—");

          const NS = "http://www.w3.org/2000/svg";
          host.textContent = "";
          const svg = document.createElementNS(NS, "svg");
          svg.setAttribute("viewBox", "0 0 " + w + " " + h);
          svg.setAttribute("width", String(w));
          svg.setAttribute("height", String(h));
          const path = document.createElementNS(NS, "path");
          path.setAttribute("d", dPath);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", P.black);
          path.setAttribute("stroke-width", "1.65");
          path.setAttribute("stroke-linejoin", "round");
          path.setAttribute("stroke-linecap", "round");
          svg.appendChild(path);
          const vline = document.createElementNS(NS, "line");
          vline.setAttribute("x1", String(cx));
          vline.setAttribute("x2", String(cx));
          vline.setAttribute("y1", String(pad.t));
          vline.setAttribute("y2", String(pad.t + innerH));
          vline.setAttribute("stroke", accent);
          vline.setAttribute("stroke-width", "1.2");
          vline.setAttribute("stroke-dasharray", "4 3");
          vline.setAttribute("opacity", "0.9");
          svg.appendChild(vline);
          const circ = document.createElementNS(NS, "circle");
          circ.setAttribute("cx", String(cx));
          circ.setAttribute("cy", String(cy));
          circ.setAttribute("r", "4");
          circ.setAttribute("fill", accent);
          svg.appendChild(circ);
          const tTop = document.createElementNS(NS, "text");
          tTop.setAttribute("x", "2");
          tTop.setAttribute("y", String(pad.t + 10));
          tTop.setAttribute("fill", P.slate);
          tTop.setAttribute("font-size", "9");
          tTop.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          tTop.textContent = sMax.toFixed(1);
          svg.appendChild(tTop);
          const tBot = document.createElementNS(NS, "text");
          tBot.setAttribute("x", "2");
          tBot.setAttribute("y", String(pad.t + innerH + 2));
          tBot.setAttribute("fill", P.slate);
          tBot.setAttribute("font-size", "9");
          tBot.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          tBot.textContent = sMin.toFixed(1);
          svg.appendChild(tBot);
          host.appendChild(svg);
        }

        miniLine(
          "sensChartWp",
          document.getElementById("sensCurWp"),
          0,
          2000,
          50,
          function (xv) {
            return computeTurn(xv, we0, b0, t0).S;
          },
          wp0,
          function (x) {
            return String(Math.round(x)) + " g";
          }
        );
        miniLine(
          "sensChartWe",
          document.getElementById("sensCurWe"),
          0,
          2000,
          50,
          function (xv) {
            return computeTurn(wp0, xv, b0, t0).S;
          },
          we0,
          function (x) {
            return String(Math.round(x)) + " g";
          }
        );
        miniLine(
          "sensChartB",
          document.getElementById("sensCurB"),
          0,
          4000,
          48,
          function (xv) {
            return computeTurn(wp0, we0, xv, t0).S;
          },
          b0,
          function (x) {
            return String(Math.round(x)) + " mm";
          }
        );

        const impactDeltas = computeImpactDeltas(wp0, we0, b0, t0);
        renderParamImportanceBars(wp0, we0, b0, t0, impactDeltas);
        applySliderImportanceClasses(impactDeltas);
      }

      /** 与重要性条形图相同度量：单参数全范围扫描下 max(S)−min(S) */
      function computeImpactDeltas(wp0, we0, b0, t0) {
        let lo;
        let hi;
        let s;

        lo = Infinity;
        hi = -Infinity;
        for (let wp = 0; wp <= 2000; wp++) {
          s = computeTurn(wp, we0, b0, t0).S;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const dWp = hi - lo;

        lo = Infinity;
        hi = -Infinity;
        for (let we = 0; we <= 2000; we++) {
          s = computeTurn(wp0, we, b0, t0).S;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const dWe = hi - lo;

        lo = Infinity;
        hi = -Infinity;
        for (let b = 0; b <= 4000; b++) {
          s = computeTurn(wp0, we0, b, t0).S;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const dB = hi - lo;

        lo = Infinity;
        hi = -Infinity;
        for (let i = 0; i <= 600; i++) {
          const d = (2.4 * i) / 600;
          s = computeTurn(wp0, we0, b0, d).S;
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
        const dD = hi - lo;

        return { wp: dWp, we: dWe, b: dB, d: dD };
      }

      const SLIDER_IMP_CLASSES = ["param-slider--imp-high", "param-slider--imp-mid", "param-slider--imp-low"];

      function applySliderImportanceClasses(deltas) {
        const map = [
          { id: "wpSl", delta: deltas.wp },
          { id: "weSl", delta: deltas.we },
          { id: "bSl", delta: deltas.b },
          { id: "takeoffSl", delta: deltas.d },
        ];
        map.sort(function (a, b) {
          const d = b.delta - a.delta;
          if (d !== 0) return d;
          return a.id.localeCompare(b.id);
        });
        map.forEach(function (item, idx) {
          const el = document.getElementById(item.id);
          if (!el) return;
          SLIDER_IMP_CLASSES.forEach(function (c) {
            el.classList.remove(c);
          });
          const tier = idx === 0 ? "param-slider--imp-high" : idx === 3 ? "param-slider--imp-low" : "param-slider--imp-mid";
          el.classList.add(tier);
        });
      }

      /**
       * 固定其余量，单参数在滑块允许范围内扫遍，用 max(S)−min(S) 作为「可调控空间」指标，用于排序谁更值得优先调。
       */
      /**
       * 参数重要性条形图：复用 SVG 与各行 g 元素，避免每次 update 清空 DOM 打断换位动画。
       * 排序变化时用 translate Y 缓动，文字/条形/Δ 随组一起移动。
       */
      function renderParamImportanceBars(wp0, we0, b0, t0, deltasIn) {
        const host = document.getElementById("paramImportanceHost");
        const leg = document.getElementById("paramImportanceLegend");
        if (!host) return;
        const P = chartPalette();
        const accent =
          getComputedStyle(document.documentElement).getPropertyValue("--legal-blue").trim() || "#0d74ce";

        const d = deltasIn || computeImpactDeltas(wp0, we0, b0, t0);
        const dWp = d.wp;
        const dWe = d.we;
        const dB = d.b;
        const dD = d.d;

        const rows = [
          { key: "wp", label: "W_payload", sub: "0–2000 g", delta: dWp },
          { key: "we", label: "W_empty", sub: "0–2000 g", delta: dWe },
          { key: "b", label: "b 翼展", sub: "0–4000 mm", delta: dB },
          { key: "d", label: "d 起飞距离", sub: "0–2.4 m", delta: dD },
        ];
        rows.sort(function (a, b) {
          const d0 = b.delta - a.delta;
          if (d0 !== 0) return d0;
          return a.key.localeCompare(b.key);
        });
        const newOrder = rows.map(function (r) {
          return r.key;
        });
        const maxD = Math.max(rows[0].delta, 1e-9);
        const canUseOrderAnim =
          lastImportanceOrderKeys != null &&
          lastImportanceOrderKeys.length === newOrder.length &&
          newOrder.every(function (k) {
            return lastImportanceOrderKeys.indexOf(k) >= 0;
          });
        const orderChanged =
          canUseOrderAnim &&
          newOrder.some(function (k, i) {
            return lastImportanceOrderKeys[i] !== k;
          });
        const wantReorderAnim = orderChanged && !prefersReducedMotion();

        function marginalHint() {
          function dSdWp() {
            if (wp0 <= 0) return computeTurn(1, we0, b0, t0).S - computeTurn(0, we0, b0, t0).S;
            if (wp0 >= 2000) return computeTurn(2000, we0, b0, t0).S - computeTurn(1999, we0, b0, t0).S;
            return (computeTurn(wp0 + 1, we0, b0, t0).S - computeTurn(wp0 - 1, we0, b0, t0).S) / 2;
          }
          function dSdWe() {
            if (we0 <= 0) return computeTurn(wp0, 1, b0, t0).S - computeTurn(wp0, 0, b0, t0).S;
            if (we0 >= 2000) return computeTurn(wp0, 2000, b0, t0).S - computeTurn(wp0, 1999, b0, t0).S;
            return (computeTurn(wp0, we0 + 1, b0, t0).S - computeTurn(wp0, we0 - 1, b0, t0).S) / 2;
          }
          function dSdB() {
            if (b0 <= 0) return computeTurn(wp0, we0, 1, t0).S - computeTurn(wp0, we0, 0, t0).S;
            if (b0 >= 4000) return computeTurn(wp0, we0, 4000, t0).S - computeTurn(wp0, we0, 3999, t0).S;
            return (computeTurn(wp0, we0, b0 + 1, t0).S - computeTurn(wp0, we0, b0 - 1, t0).S) / 2;
          }
          function dSdT() {
            const h = 0.01;
            const dMax = 2.4;
            if (t0 <= h) return (computeTurn(wp0, we0, b0, h).S - computeTurn(wp0, we0, b0, 0).S) / h;
            if (t0 >= dMax - h) return (computeTurn(wp0, we0, b0, dMax).S - computeTurn(wp0, we0, b0, dMax - h).S) / h;
            return (computeTurn(wp0, we0, b0, t0 + h).S - computeTurn(wp0, we0, b0, t0 - h).S) / (2 * h);
          }
          const a = dSdWp() * 100;
          const b2 = dSdWe() * 100;
          const c = dSdB() * 10;
          const d3 = dSdT() * 0.1;
          return (
            "边际近似：+100 g 载荷 " +
            (a >= 0 ? "+" : "") +
            a.toFixed(2) +
            " 分；+100 g 空机 " +
            (b2 >= 0 ? "+" : "") +
            b2.toFixed(2) +
            " 分；+10 mm 翼展 " +
            (c >= 0 ? "+" : "") +
            c.toFixed(2) +
            " 分；+0.10 m 起飞 " +
            (d3 >= 0 ? "+" : "") +
            d3.toFixed(2) +
            " 分（B 分段可突变）。"
          );
        }

        if (leg) leg.textContent = marginalHint();

        const NS = "http://www.w3.org/2000/svg";
        const rowH = 56;
        const labW = 112;
        const valW = 70;
        const padT = 30;
        const padB = 12;
        const w = Math.max(host.clientWidth || 320, 280);
        const innerW = w - labW - valW - 16;
        const hSvg = padT + rows.length * rowH + padB;

        let svg = host.querySelector(":scope > svg");
        if (!svg) {
          svg = document.createElementNS(NS, "svg");
          host.appendChild(svg);
          const title = document.createElementNS(NS, "text");
          title.setAttribute("class", "imp-chart-title");
          title.setAttribute("x", "0");
          title.setAttribute("y", "13");
          title.setAttribute("fill", P.slate);
          title.setAttribute("font-size", "11");
          title.setAttribute("font-weight", "600");
          title.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          title.textContent = "全范围落差 Δ（其余量固定）";
          svg.appendChild(title);
        } else {
          const tEl = svg.querySelector(".imp-chart-title");
          if (tEl) tEl.setAttribute("fill", P.slate);
        }

        svg.setAttribute("viewBox", "0 0 " + w + " " + hSvg);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(hSvg));

        function ensureRowGroup(key) {
          let g = svg.querySelector('g.imp-row[data-key="' + key + '"]');
          if (g) return g;
          g = document.createElementNS(NS, "g");
          g.setAttribute("class", "imp-row");
          g.setAttribute("data-key", key);
          const yLab = 12;
          const ySub = 27;
          const yBar = 38;
          const lab = document.createElementNS(NS, "text");
          lab.setAttribute("class", "imp-row-lab");
          lab.setAttribute("x", "0");
          lab.setAttribute("y", String(yLab));
          lab.setAttribute("fill", P.nearBlack);
          lab.setAttribute("font-size", "11.5");
          lab.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          g.appendChild(lab);
          const sub = document.createElementNS(NS, "text");
          sub.setAttribute("class", "imp-row-sub");
          sub.setAttribute("x", "0");
          sub.setAttribute("y", String(ySub));
          sub.setAttribute("fill", P.slate);
          sub.setAttribute("font-size", "9.5");
          sub.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          g.appendChild(sub);
          const track = document.createElementNS(NS, "rect");
          track.setAttribute("class", "imp-bar-track");
          track.setAttribute("y", String(yBar));
          track.setAttribute("height", "9");
          track.setAttribute("rx", "4");
          track.setAttribute("fill", P.slate);
          track.setAttribute("opacity", "0.12");
          g.appendChild(track);
          const fill = document.createElementNS(NS, "rect");
          fill.setAttribute("class", "imp-bar-fill");
          fill.setAttribute("y", String(yBar));
          fill.setAttribute("height", "9");
          fill.setAttribute("rx", "4");
          fill.setAttribute("fill", accent);
          g.appendChild(fill);
          const vt = document.createElementNS(NS, "text");
          vt.setAttribute("class", "imp-row-val");
          vt.setAttribute("y", String(yLab));
          vt.setAttribute("fill", P.nearBlack);
          vt.setAttribute("font-size", "11");
          vt.setAttribute("font-weight", "600");
          vt.setAttribute("font-family", "JetBrains Mono, Inter, sans-serif");
          vt.setAttribute("font-variant-numeric", "tabular-nums");
          g.appendChild(vt);
          svg.appendChild(g);
          return g;
        }

        ["wp", "we", "b", "d"].forEach(ensureRowGroup);

        rows.forEach(function (row, rank) {
          const newY = padT + rank * rowH;
          const oldIdx = wantReorderAnim ? lastImportanceOrderKeys.indexOf(row.key) : rank;
          const oldY = padT + oldIdx * rowH;
          const yLab = 12;
          const ySub = 27;
          const yBar = 38;
          const bx = labW;
          const bw = innerW * (row.delta / maxD);

          const g = ensureRowGroup(row.key);
          const lab = g.querySelector(".imp-row-lab");
          const sub = g.querySelector(".imp-row-sub");
          const track = g.querySelector(".imp-bar-track");
          const fill = g.querySelector(".imp-bar-fill");
          const vt = g.querySelector(".imp-row-val");
          if (!lab || !sub || !track || !fill || !vt) return;

          lab.textContent =
            (rank === 0 ? "① " : rank === 1 ? "② " : rank === 2 ? "③ " : "④ ") + row.label;
          lab.setAttribute("font-weight", rank === 0 ? "700" : "500");
          lab.setAttribute("fill", P.nearBlack);
          sub.textContent = row.sub;
          sub.setAttribute("fill", P.slate);
          track.setAttribute("x", String(bx));
          track.setAttribute("width", String(innerW));
          track.setAttribute("fill", P.slate);
          fill.setAttribute("x", String(bx));
          fill.setAttribute("width", String(Math.max(2, bw)));
          fill.setAttribute("fill", accent);
          fill.setAttribute("opacity", String(1 - rank * 0.14));
          vt.setAttribute("x", String(bx + innerW + 8));
          vt.setAttribute("fill", P.nearBlack);
          vt.textContent = "Δ " + row.delta.toFixed(2);

          if (wantReorderAnim && oldY !== newY) {
            var yFrom = oldY;
            if (g._impAnimRaf != null) {
              yFrom = getImportanceGroupTranslateY(g);
            } else {
              g.setAttribute("transform", "translate(0," + oldY + ")");
            }
            (function (gRow, yFrom2, yTo) {
              requestAnimationFrame(function () {
                if (!gRow.isConnected) return;
                requestAnimationFrame(function () {
                  animateImportanceGroupY(gRow, yFrom2, yTo, 260);
                });
              });
            })(g, yFrom, newY);
          } else if (g._impAnimRaf == null) {
            g.setAttribute("transform", "translate(0," + newY + ")");
          }
        });

        lastImportanceOrderKeys = newOrder.slice();
      }

      function compSelectValue(type, idx) {
        return type + ":" + idx;
      }

      function parseCompSelectValue(raw) {
        if (raw == null || raw === "") return null;
        const s = String(raw);
        const colon = s.indexOf(":");
        if (colon < 0) {
          const n = Number(s);
          if (!Number.isFinite(n) || n < 0) return null;
          return { type: "snap", index: n | 0 };
        }
        const type = s.slice(0, colon);
        const index = Number(s.slice(colon + 1));
        if (type !== "snap") return null;
        if (!Number.isFinite(index) || index < 0) return null;
        return { type: type, index: index | 0 };
      }

      function normalizeStoredCompKey(raw) {
        if (raw == null || raw === "") return "";
        const s = String(raw);
        if (s.indexOf(":") >= 0) return s;
        return "snap:" + s;
      }

      function compEntryValid(parsed, snapLen) {
        if (!parsed) return false;
        return parsed.index >= 0 && parsed.index < snapLen;
      }

      function getCompEntry(parsed) {
        if (!parsed) return null;
        const list = loadSnapshots();
        if (parsed.index < 0 || parsed.index >= list.length) return null;
        return { kind: "snap", snap: list[parsed.index] };
      }

      function compEntryLabel(e) {
        return e.snap.name || "未命名";
      }

      function sturnFromCompEntry(e) {
        const t = takeoffFromSnap(e.snap);
        return computeTurn(e.snap.wp, e.snap.we, e.snap.b, t).S;
      }

      function appendCompOptGroups(selectEl, list) {
        if (list.length > 0) {
          const og = document.createElement("optgroup");
          og.label = "已存试算";
          list.forEach(function (s, i) {
            const o = document.createElement("option");
            o.value = compSelectValue("snap", i);
            o.textContent = (s.name || "未命名") + " · S=" + (s.total != null ? s.total.toFixed(2) : "—");
            og.appendChild(o);
          });
          selectEl.appendChild(og);
        }
      }

      function populateCompSelects() {
        const list = loadSnapshots();
        const baseSel = document.getElementById("compBaselineSelect");
        const tgtSel = document.getElementById("compTargetsSelect");
        if (!baseSel || !tgtSel) return;
        const prevBase = baseSel.value;
        const prevTgt = Array.from(tgtSel.selectedOptions).map(function (o) {
          return o.value;
        });
        baseSel.innerHTML = '<option value="">— 请选择基准 —</option>';
        tgtSel.innerHTML = "";
        appendCompOptGroups(baseSel, list);
        appendCompOptGroups(tgtSel, list);

        let newBase = prevBase;
        if (!compEntryValid(parseCompSelectValue(normalizeStoredCompKey(newBase)), list.length)) {
          const saved = localStorage.getItem(COMP_BASE_KEY);
          const migrated = normalizeStoredCompKey(saved);
          newBase = compEntryValid(parseCompSelectValue(migrated), list.length) ? migrated : "";
        }
        baseSel.value = newBase;
        if (baseSel.value) localStorage.setItem(COMP_BASE_KEY, baseSel.value);
        else localStorage.removeItem(COMP_BASE_KEY);
        prevTgt.forEach(function (v) {
          if (v === baseSel.value) return;
          const opt = Array.from(tgtSel.options).find(function (o) {
            return o.value === v;
          });
          if (opt) opt.selected = true;
        });
        renderCompMatrix();
      }

      function renderCompMatrix() {
        const empty = document.getElementById("compMatrixEmpty");
        const wrap = document.getElementById("compMatrixWrap");
        const head = document.getElementById("compMatrixHead");
        const body = document.getElementById("compMatrixBody");
        const baseSel = document.getElementById("compBaselineSelect");
        const tgtSel = document.getElementById("compTargetsSelect");
        if (!empty || !wrap || !head || !body || !baseSel || !tgtSel) return;

        const list = loadSnapshots();
        const baseEntry = getCompEntry(parseCompSelectValue(baseSel.value));
        const tgtEntries = Array.from(tgtSel.selectedOptions)
          .map(function (o) {
            return o.value;
          })
          .filter(function (v) {
            return v !== "" && v !== baseSel.value;
          })
          .map(function (v) {
            return getCompEntry(parseCompSelectValue(v));
          })
          .filter(Boolean);

        if (list.length === 0) {
          empty.hidden = false;
          empty.textContent = "暂无已存试算数据。";
          wrap.hidden = true;
          return;
        }
        if (!baseEntry) {
          empty.hidden = false;
          empty.textContent = "请选择一个基准。";
          wrap.hidden = true;
          return;
        }
        if (tgtEntries.length === 0) {
          empty.hidden = false;
          empty.textContent = "请在「对比结果」中多选至少一项（勿与基准相同）。";
          wrap.hidden = true;
          return;
        }

        empty.hidden = true;
        wrap.hidden = false;
        head.innerHTML = "";
        body.innerHTML = "";

        const trh = document.createElement("tr");
        const th0 = document.createElement("th");
        th0.textContent = "项目";
        trh.appendChild(th0);
        const thB = document.createElement("th");
        thB.textContent = "基准：" + compEntryLabel(baseEntry);
        trh.appendChild(thB);
        tgtEntries.forEach(function (e) {
          const th = document.createElement("th");
          th.textContent = compEntryLabel(e) + "（Δ）";
          trh.appendChild(th);
        });
        head.appendChild(trh);

        function cellParamDelta(baseNum, tgtE, getSnapVal, dec) {
          const nv = Number(getSnapVal(tgtE.snap));
          if (!Number.isFinite(nv)) return "—";
          if (!Number.isFinite(baseNum)) {
            return dec != null ? nv.toFixed(dec) : String(Math.round(nv));
          }
          const d = nv - baseNum;
          if (dec != null) {
            return nv.toFixed(dec) + "（" + (d >= 0 ? "+" : "") + d.toFixed(dec) + "）";
          }
          return String(Math.round(nv)) + "（" + (d >= 0 ? "+" : "") + String(Math.round(d)) + "）";
        }

        function addParamRow(label, getSnapVal, dec) {
          const tr = document.createElement("tr");
          const td0 = document.createElement("td");
          td0.textContent = label;
          tr.appendChild(td0);
          const tdB = document.createElement("td");
          tdB.textContent = formatParamNum(getSnapVal(baseEntry.snap), dec);
          tr.appendChild(tdB);
          const bv = Number.isFinite(Number(getSnapVal(baseEntry.snap)))
            ? Number(getSnapVal(baseEntry.snap))
            : NaN;
          tgtEntries.forEach(function (te) {
            const td = document.createElement("td");
            td.textContent = cellParamDelta(bv, te, getSnapVal, dec);
            tr.appendChild(td);
          });
          body.appendChild(tr);
        }

        function addSturnRow() {
          const tr = document.createElement("tr");
          const td0 = document.createElement("td");
          td0.textContent = "S_turn（单轮）";
          tr.appendChild(td0);
          const baseS = sturnFromCompEntry(baseEntry);
          const tdB = document.createElement("td");
          tdB.textContent = formatParamNum(baseS, 2);
          tr.appendChild(tdB);
          tgtEntries.forEach(function (te) {
            const td = document.createElement("td");
            const nv = sturnFromCompEntry(te);
            if (!Number.isFinite(nv)) {
              td.textContent = "—";
            } else {
              const d = nv - baseS;
              td.textContent = nv.toFixed(2) + "（" + (d >= 0 ? "+" : "") + d.toFixed(2) + "）";
            }
            tr.appendChild(td);
          });
          body.appendChild(tr);
        }

        addParamRow(
          "W_payload (g)",
          function (s) {
            return s.wp;
          },
          0
        );
        addParamRow(
          "W_empty (g)",
          function (s) {
            return s.we;
          },
          0
        );
        addParamRow(
          "b (mm)",
          function (s) {
            return s.b;
          },
          0
        );
        addParamRow(
          "起飞 d (m)",
          function (s) {
            return takeoffFromSnap(s);
          },
          2
        );
        addSturnRow();
      }

      function formatParamNum(v, decimals) {
        if (v == null || v === "") return "—";
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        return decimals != null ? n.toFixed(decimals) : String(n);
      }

      function populateDiffSelect() {
        const sel = document.getElementById("diffSnapSelect");
        if (!sel) return;
        const list = loadSnapshots();
        const prev = sel.value;
        sel.innerHTML = '<option value="">— 请选择试算 —</option>';
        list.forEach((s, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent =
            (s.name || "未命名") +
            " · 单轮 " +
            (s.total != null ? s.total.toFixed(2) : "—") +
            " · " +
            new Date(s.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
          sel.appendChild(opt);
        });
        const saved = localStorage.getItem(DIFF_IDX_KEY);
        let pick = prev;
        if (pick !== "" && !list[Number(pick)]) pick = "";
        if (pick === "" && saved != null && list[Number(saved)]) pick = saved;
        sel.value = pick;
        if (sel.value && list[Number(sel.value)]) {
          localStorage.setItem(DIFF_IDX_KEY, sel.value);
        } else {
          localStorage.removeItem(DIFF_IDX_KEY);
        }
      }

      function appendDiffRow(body, key, cur, base, delta, decimals, rowClass) {
        const tr = document.createElement("tr");
        if (rowClass) tr.className = rowClass;
        const td0 = document.createElement("td");
        td0.textContent = key;
        tr.appendChild(td0);
        const td1 = document.createElement("td");
        td1.textContent = formatParamNum(cur, decimals);
        tr.appendChild(td1);
        const td2 = document.createElement("td");
        td2.textContent = formatParamNum(base, decimals);
        tr.appendChild(td2);
        const td3 = document.createElement("td");
        if (delta == null || Number.isNaN(delta)) {
          td3.textContent = "—";
        } else {
          const v = Math.round(delta * 100) / 100;
          const span = document.createElement("span");
          span.className = v >= 0 ? "delta-pos" : "delta-neg";
          span.textContent = (v >= 0 ? "+" : "") + v.toFixed(2);
          td3.appendChild(span);
        }
        tr.appendChild(td3);
        body.appendChild(tr);
      }

      function renderDiffTable() {
        const table = document.getElementById("versionDiffTable");
        const wrap = document.getElementById("versionDiffTableWrap");
        const body = document.getElementById("versionDiffBody");
        const empty = document.getElementById("versionDiffEmpty");
        const sel = document.getElementById("diffSnapSelect");
        const list = loadSnapshots();

        if (list.length === 0) {
          table.hidden = true;
          if (wrap) wrap.hidden = true;
          empty.hidden = false;
          empty.textContent = "暂无已存结果：请先在「参数输入」区保存至少一条。";
          return;
        }

        const idx = sel.value === "" ? -1 : Number(sel.value);
        const snap = idx >= 0 && list[idx] ? list[idx] : null;

        if (!snap) {
          table.hidden = true;
          if (wrap) wrap.hidden = true;
          empty.hidden = false;
          empty.textContent = "请在上方下拉框中选择一条基准试算，即可查看与当前输入的逐项差距。";
          return;
        }

        empty.hidden = true;
        table.hidden = false;
        if (wrap) wrap.hidden = false;
        body.innerHTML = "";

        const cur = snapshotFromInputs();
        const st = takeoffFromSnap(snap);
        const rC = computeTurn(cur.wp, cur.we, cur.b, cur.takeoff);
        const rS = computeTurn(snap.wp, snap.we, snap.b, st);

        appendDiffRow(body, "W_payload (g)", cur.wp, snap.wp, Number(cur.wp) - snap.wp, 0, null);
        appendDiffRow(body, "W_empty (g)", cur.we, snap.we, Number(cur.we) - snap.we, 0, null);
        appendDiffRow(body, "b (mm)", cur.b, snap.b, Number(cur.b) - snap.b, 0, null);
        appendDiffRow(body, "起飞 (m)", cur.takeoff, st, Number(cur.takeoff) - st, 2, null);
        appendDiffRow(body, "S_turn", rC.S, rS.S, rC.S - rS.S, 2, "diff-score-start diff-stotal");
      }

      /** 一等奖 / 二等奖 / 三等奖 各自组内「较高机组分」的最大值，作柱色参考线 */
      function getAwardTierMaxHighs() {
        try {
          const rows = getRefRows();
          function maxHighForAward(award) {
            let m = -Infinity;
            rows.forEach(function (r) {
              if ((r.award || "").trim() !== award) return;
              const h = Math.max(Number(r.s1) || 0, Number(r.s2) || 0);
              if (Number.isFinite(h) && h > m) m = h;
            });
            return m === -Infinity ? null : m;
          }
          return {
            hi1: maxHighForAward("一等奖"),
            hi2: maxHighForAward("二等奖"),
            hi3: maxHighForAward("三等奖"),
          };
        } catch {
          return { hi1: null, hi2: null, hi3: null };
        }
      }

      function chartTierColors() {
        const st = getComputedStyle(document.documentElement);
        function pick(n, fb) {
          const v = st.getPropertyValue(n).trim();
          return v || fb;
        }
        return {
          high: pick("--chart-tier-high", "#b5ead7"),
          mid: pick("--chart-tier-mid", "#ffdac1"),
          low: pick("--chart-tier-low", "#ffb7b2"),
        };
      }

      /**
       * 绿：≥ 一等奖组内参考最高分；黄：≥ 三等奖组内参考最高分且 < 一等奖线；红：< 三等奖线。
       * 二等奖组内最高分落在黄区区间内，仅作语义参考。缺奖级数据时逐级降级。
       */
      function tierFillForAwardScores(score, H, pal) {
        const s = Number(score) || 0;
        const h1 = H.hi1;
        const h2 = H.hi2;
        const h3 = H.hi3;
        if (h1 != null && h3 != null) {
          if (s >= h1) return pal.high;
          if (s >= h3) return pal.mid;
          return pal.low;
        }
        if (h1 != null && h2 != null) {
          if (s >= h1) return pal.high;
          if (s >= h2) return pal.mid;
          return pal.low;
        }
        if (h2 != null && h3 != null) {
          if (s >= h2) return pal.high;
          if (s >= h3) return pal.mid;
          return pal.low;
        }
        if (h1 != null) {
          return s >= h1 ? pal.high : pal.mid;
        }
        if (h2 != null) {
          return s >= h2 ? pal.mid : pal.low;
        }
        if (h3 != null) {
          return s >= h3 ? pal.mid : pal.low;
        }
        return pal.mid;
      }

      function parseCssColorToRgb(str) {
        const s = (str || "").trim();
        if (!s) return { r: 200, g: 200, b: 200 };
        if (s[0] === "#") {
          let x = s.slice(1);
          if (x.length === 3) {
            x = x
              .split("")
              .map(function (c) {
                return c + c;
              })
              .join("");
          }
          const v = parseInt(x, 16);
          if (Number.isNaN(v)) return { r: 200, g: 200, b: 200 };
          return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
        }
        const m = s.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
        return { r: 200, g: 200, b: 200 };
      }

      function smoothstep01(t) {
        t = Math.max(0, Math.min(1, t));
        return t * t * (3 - 2 * t);
      }

      function lerpNum(a, b, t) {
        return a + (b - a) * t;
      }

      function lerpRgb(A, B, t) {
        return {
          r: Math.round(lerpNum(A.r, B.r, t)),
          g: Math.round(lerpNum(A.g, B.g, t)),
          b: Math.round(lerpNum(A.b, B.b, t)),
        };
      }

      /** 三等分色带：在 lo、hi 两侧阈值附近渐变，中间为 mid 色 */
      function blendThreeScoreZones(s, lo, hi, rgbL, rgbM, rgbH) {
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return rgbM;
        if (lo >= hi) return rgbM;
        const span = hi - lo;
        const eps = Math.min(Math.max(0.28, span * 0.055), span * 0.42);
        if (lo + eps >= hi - eps) {
          const u = smoothstep01((s - lo) / (hi - lo));
          return lerpRgb(lerpRgb(rgbL, rgbM, 0.5), rgbH, u);
        }
        if (s <= lo - eps) return rgbL;
        if (s < lo + eps) {
          return lerpRgb(rgbL, rgbM, smoothstep01((s - (lo - eps)) / (2 * eps)));
        }
        if (s <= hi - eps) return rgbM;
        if (s < hi + eps) {
          return lerpRgb(rgbM, rgbH, smoothstep01((s - (hi - eps)) / (2 * eps)));
        }
        return rgbH;
      }

      /** 两档：th 以上为 rgbAbove，以下为 rgbBelow */
      function blendTwoScoreZones(s, th, rgbBelow, rgbAbove) {
        if (!Number.isFinite(th)) return rgbBelow;
        const eps = Math.max(0.32, Math.abs(th) * 0.06 + 0.12);
        if (s <= th - eps) return rgbBelow;
        if (s < th + eps) {
          return lerpRgb(rgbBelow, rgbAbove, smoothstep01((s - (th - eps)) / (2 * eps)));
        }
        return rgbAbove;
      }

      function tierRgbDiscrete(score, H, pal, rgbH, rgbM, rgbL) {
        const f = tierFillForAwardScores(score, H, pal);
        if (f === pal.high) return rgbH;
        if (f === pal.low) return rgbL;
        return rgbM;
      }

      /**
       * 与 tierFillForAwardScores 分区一致，在阈值附近做 RGB 平滑，避免分档跳变。
       */
      function scoreAccentRgb(score, H, pal, rgbH, rgbM, rgbL) {
        const s = Number(score) || 0;
        const h1 = H.hi1;
        const h2 = H.hi2;
        const h3 = H.hi3;

        if (h1 != null && h3 != null) {
          const a = Number(h3);
          const b = Number(h1);
          if (a < b) return blendThreeScoreZones(s, a, b, rgbL, rgbM, rgbH);
          return tierRgbDiscrete(score, H, pal, rgbH, rgbM, rgbL);
        }
        if (h1 != null && h2 != null) {
          const a = Number(h2);
          const b = Number(h1);
          if (a < b) return blendThreeScoreZones(s, a, b, rgbL, rgbM, rgbH);
          return tierRgbDiscrete(score, H, pal, rgbH, rgbM, rgbL);
        }
        if (h2 != null && h3 != null) {
          const a = Number(h3);
          const b = Number(h2);
          if (a < b) return blendThreeScoreZones(s, a, b, rgbL, rgbM, rgbH);
          return tierRgbDiscrete(score, H, pal, rgbH, rgbM, rgbL);
        }
        if (h1 != null) {
          return blendTwoScoreZones(s, Number(h1), rgbM, rgbH);
        }
        if (h2 != null) {
          return blendTwoScoreZones(s, Number(h2), rgbL, rgbM);
        }
        if (h3 != null) {
          return blendTwoScoreZones(s, Number(h3), rgbL, rgbM);
        }
        return rgbM;
      }

      function scoreAccentBorderRgb(rgb, dark) {
        if (dark) {
          return {
            r: Math.round(lerpNum(rgb.r, 36, 0.58)),
            g: Math.round(lerpNum(rgb.g, 44, 0.58)),
            b: Math.round(lerpNum(rgb.b, 52, 0.58)),
          };
        }
        return {
          r: Math.round(Math.min(255, rgb.r * 0.5 + 52)),
          g: Math.round(Math.min(255, rgb.g * 0.5 + 58)),
          b: Math.round(Math.min(255, rgb.b * 0.5 + 54)),
        };
      }

      function applyScorePrimaryTint(el, score, H, pal) {
        if (!el) return;
        const rgbH = parseCssColorToRgb(pal.high);
        const rgbM = parseCssColorToRgb(pal.mid);
        const rgbL = parseCssColorToRgb(pal.low);
        const rgb = scoreAccentRgb(score, H, pal, rgbH, rgbM, rgbL);
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        const bdr = scoreAccentBorderRgb(rgb, dark);
        el.style.setProperty("--score-tint-r", String(rgb.r));
        el.style.setProperty("--score-tint-g", String(rgb.g));
        el.style.setProperty("--score-tint-b", String(rgb.b));
        el.style.setProperty("--score-br", String(bdr.r));
        el.style.setProperty("--score-bg", String(bdr.g));
        el.style.setProperty("--score-bb", String(bdr.b));
        el.classList.add("result-block--score-tier");
      }

      function clearScorePrimaryTint(el) {
        if (!el) return;
        el.classList.remove("result-block--score-tier");
        ["--score-tint-r", "--score-tint-g", "--score-tint-b", "--score-br", "--score-bg", "--score-bb"].forEach(function (p) {
          el.style.removeProperty(p);
        });
      }

      /** 纵轴上限：略高于当前分，使柱高随分数连续变化（否则 max=当前分 时柱永远满格且重绘易抖） */
      function chartYMax(s) {
        const v = Math.max(0, Number(s) || 0);
        if (v <= 1e-9) return 10;
        const m = Math.max(v * 1.22, v + 0.35);
        return Math.ceil(m * 100) / 100;
      }

      const CUSTOM_SCORE_LINES_KEY = "model-aircraft-custom-score-lines-v1";

      function readCustomScoreLineValues() {
        const out = [];
        for (let i = 1; i <= 3; i++) {
          const el = document.getElementById("customScoreLine" + i);
          if (!el || el.value === "" || el.value == null) {
            out.push(null);
            continue;
          }
          const v = parseFloat(el.value);
          out.push(Number.isFinite(v) && v >= 0 ? v : null);
        }
        return out;
      }

      function loadCustomScoreLinesIntoInputs() {
        try {
          const raw = localStorage.getItem(CUSTOM_SCORE_LINES_KEY);
          if (!raw) return;
          const a = JSON.parse(raw);
          if (!Array.isArray(a) || a.length !== 3) return;
          for (let i = 0; i < 3; i++) {
            const el = document.getElementById("customScoreLine" + (i + 1));
            if (!el) continue;
            const v = a[i];
            if (v != null && Number.isFinite(Number(v))) el.value = String(Number(v));
          }
        } catch (_) {}
      }

      function saveCustomScoreLinesFromInputs() {
        try {
          const vals = readCustomScoreLineValues();
          localStorage.setItem(CUSTOM_SCORE_LINES_KEY, JSON.stringify(vals));
        } catch (_) {}
      }

      function renderBarChart(score) {
        const host = document.getElementById("barChart");
        if (!host) return;
        const P = chartPalette();
        const value = Math.max(0, Number(score) || 0);
        const awardHi = getAwardTierMaxHighs();
        const tierPal = chartTierColors();
        const fillCur = tierFillForAwardScores(value, awardHi, tierPal);

        const H = awardHi;
        function normHi(x) {
          if (x == null || !Number.isFinite(Number(x))) return null;
          return Math.max(0, Number(x));
        }
        const hi1 = normHi(H.hi1);
        const hi2 = normHi(H.hi2);
        const hi3 = normHi(H.hi3);
        const customVals = readCustomScoreLineValues();

        const w = Math.max(host.clientWidth || 320, 280);
        const shortLab = w < 400;
        const lab1 = shortLab ? "一等" : "一等奖";
        const lab2 = shortLab ? "二等" : "二等奖";
        const lab3 = shortLab ? "三等" : "三等奖";

        const tipParts = [];
        if (hi1 != null) tipParts.push(lab1 + " " + hi1.toFixed(2));
        if (hi2 != null) tipParts.push(lab2 + " " + hi2.toFixed(2));
        if (hi3 != null) tipParts.push(lab3 + " " + hi3.toFixed(2));
        const customTip = customVals
          .map(function (cv, i) {
            return cv != null ? "线" + (i + 1) + " " + cv.toFixed(2) : null;
          })
          .filter(Boolean);
        if (customTip.length) tipParts.push("自定 " + customTip.join(" · "));
        host.title = tipParts.length ? "奖级与自定线：" + tipParts.join(" · ") : "";

        const maxInput = Math.max(
          value,
          hi1 != null ? hi1 : 0,
          hi2 != null ? hi2 : 0,
          hi3 != null ? hi3 : 0,
          Math.max(0, customVals[0] != null ? customVals[0] : 0),
          Math.max(0, customVals[1] != null ? customVals[1] : 0),
          Math.max(0, customVals[2] != null ? customVals[2] : 0),
          1e-9
        );
        const maxVal = Math.max(chartYMax(maxInput), 1e-6);

        function clamp01(f) {
          if (!Number.isFinite(f) || f < 0) return 0;
          return f > 1 ? 1 : f;
        }
        const fTrial = clamp01(value / maxVal);
        const f1 = clamp01((hi1 != null ? hi1 : 0) / maxVal);
        const f2 = clamp01((hi2 != null ? hi2 : 0) / maxVal);
        const f3 = clamp01((hi3 != null ? hi3 : 0) / maxVal);

        const h = 220;
        const pad = { l: 8, r: 8, t: 16, b: 38 };
        const innerW = w - pad.l - pad.r;
        const innerH = h - pad.t - pad.b;
        const nCol = 4;
        const barGap = w < 360 ? 4 : w < 520 ? 6 : 8;
        const barW = (innerW - (nCol - 1) * barGap) / nCol;
        const fsVal = w < 360 ? "11" : "12";
        const fsLab = w < 340 ? "10" : "11";

        const NS = "http://www.w3.org/2000/svg";
        let svg = host.querySelector("svg");
        const needBuild =
          !svg ||
          Number(svg.getAttribute("data-w") || 0) !== w ||
          svg.getAttribute("data-layout") !== "quad-tier-custom";

        function yForScore(s) {
          const t = Math.max(0, Math.min(Number(s) || 0, maxVal));
          return pad.t + innerH * (1 - t / maxVal);
        }

        if (needBuild) {
          host.textContent = "";
          svg = document.createElementNS(NS, "svg");
          svg.setAttribute("viewBox", "0 0 " + w + " " + h);
          svg.setAttribute("width", String(w));
          svg.setAttribute("height", String(h));
          svg.setAttribute("data-w", String(w));
          svg.setAttribute("data-layout", "quad-tier-custom");

          const yLabel = document.createElementNS(NS, "text");
          yLabel.setAttribute("class", "chart-y-label");
          yLabel.setAttribute("x", String(pad.l));
          yLabel.setAttribute("y", "14");
          yLabel.setAttribute("fill", P.slate);
          yLabel.setAttribute("font-size", "12");
          yLabel.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
          svg.appendChild(yLabel);

          const gBands = document.createElementNS(NS, "g");
          gBands.setAttribute("class", "chart-tier-bands");
          for (let zi = 0; zi < 3; zi++) {
            const r = document.createElementNS(NS, "rect");
            r.setAttribute("class", "tier-zone tier-zone--" + zi);
            r.setAttribute("opacity", "0");
            r.setAttribute("rx", "3");
            gBands.appendChild(r);
          }
          svg.appendChild(gBands);

          const strokeTier = ["#2f8f62", "#c97935", "#c94f58"];
          const gH = document.createElementNS(NS, "g");
          gH.setAttribute("class", "chart-tier-hlines");
          [1, 2, 3].forEach(function (ti) {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("class", "tier-rule tier-rule--" + ti);
            line.setAttribute("stroke", strokeTier[ti - 1]);
            line.setAttribute("stroke-width", "1.35");
            line.setAttribute("stroke-dasharray", "5 4");
            line.setAttribute("stroke-linecap", "round");
            line.setAttribute("opacity", "0");
            gH.appendChild(line);
            const tx = document.createElementNS(NS, "text");
            tx.setAttribute("class", "tier-rule-lab tier-rule-lab--" + ti);
            tx.setAttribute("text-anchor", "end");
            tx.setAttribute("fill", strokeTier[ti - 1]);
            tx.setAttribute("font-size", w < 360 ? "8.5" : "9");
            tx.setAttribute("font-weight", "600");
            tx.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
            tx.setAttribute("opacity", "0");
            gH.appendChild(tx);
          });

          const customStroke = ["#475569", "#7c3aed", "#0d9488"];
          const gCustom = document.createElementNS(NS, "g");
          gCustom.setAttribute("class", "chart-custom-hlines");
          [1, 2, 3].forEach(function (ci) {
            const line = document.createElementNS(NS, "line");
            line.setAttribute("class", "custom-rule custom-rule--" + ci);
            line.setAttribute("stroke", customStroke[ci - 1]);
            line.setAttribute("stroke-width", "1.25");
            line.setAttribute("stroke-dasharray", "6 4");
            line.setAttribute("stroke-linecap", "round");
            line.setAttribute("opacity", "0");
            gCustom.appendChild(line);
            const tx = document.createElementNS(NS, "text");
            tx.setAttribute("class", "custom-rule-lab custom-rule-lab--" + ci);
            tx.setAttribute("text-anchor", "start");
            tx.setAttribute("fill", customStroke[ci - 1]);
            tx.setAttribute("font-size", w < 360 ? "8.5" : "9");
            tx.setAttribute("font-weight", "600");
            tx.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
            tx.setAttribute("opacity", "0");
            gCustom.appendChild(tx);
          });

          function addBarRect(x, cls, fill) {
            const rect = document.createElementNS(NS, "rect");
            rect.setAttribute("class", "bar-fill bar-fill--smooth " + cls);
            rect.setAttribute("x", String(x));
            rect.setAttribute("y", String(pad.t));
            rect.setAttribute("width", String(barW));
            rect.setAttribute("height", String(innerH));
            rect.setAttribute("rx", "6");
            rect.setAttribute("fill", fill);
            svg.appendChild(rect);
          }

          function addBarTexts(cls) {
            const valText = document.createElementNS(NS, "text");
            valText.setAttribute("class", "bar-value " + cls + "-val");
            valText.setAttribute("text-anchor", "middle");
            valText.setAttribute("fill", P.nearBlack);
            valText.setAttribute("font-size", fsVal);
            valText.setAttribute("font-weight", "600");
            valText.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
            svg.appendChild(valText);
            const labText = document.createElementNS(NS, "text");
            labText.setAttribute("class", "bar-label " + cls + "-lab");
            labText.setAttribute("text-anchor", "middle");
            labText.setAttribute("fill", P.slate);
            labText.setAttribute("font-size", fsLab);
            labText.setAttribute("font-family", "Inter, Noto Sans SC, sans-serif");
            svg.appendChild(labText);
          }

          const xAt = function (i) {
            return pad.l + i * (barW + barGap);
          };
          addBarRect(xAt(0), "bar-col--trial", fillCur);
          addBarRect(xAt(1), "bar-col--r1", tierPal.high);
          addBarRect(xAt(2), "bar-col--r2", tierPal.mid);
          addBarRect(xAt(3), "bar-col--r3", tierPal.low);

          svg.appendChild(gH);

          addBarTexts("bar-col--trial");
          addBarTexts("bar-col--r1");
          addBarTexts("bar-col--r2");
          addBarTexts("bar-col--r3");

          svg.appendChild(gCustom);

          host.appendChild(svg);
        }

        const yLabel = svg.querySelector(".chart-y-label");
        const rectTrial = svg.querySelector(".bar-col--trial");
        const rectR1 = svg.querySelector(".bar-col--r1");
        const rectR2 = svg.querySelector(".bar-col--r2");
        const rectR3 = svg.querySelector(".bar-col--r3");
        const valTrial = svg.querySelector(".bar-col--trial-val");
        const valR1 = svg.querySelector(".bar-col--r1-val");
        const valR2 = svg.querySelector(".bar-col--r2-val");
        const valR3 = svg.querySelector(".bar-col--r3-val");
        const labTrial = svg.querySelector(".bar-col--trial-lab");
        const labR1 = svg.querySelector(".bar-col--r1-lab");
        const labR2 = svg.querySelector(".bar-col--r2-lab");
        const labR3 = svg.querySelector(".bar-col--r3-lab");

        if (yLabel) yLabel.textContent = "分数（0–" + maxVal.toFixed(1) + "）";

        function applyBarF(rect, valText, labText, f, xCol, valDisplay, labStr) {
          if (!rect) return;
          if (needBuild) {
            rect.style.setProperty("transition", "none");
            rect.style.transform = "scaleY(" + f + ")";
            requestAnimationFrame(function () {
              rect.style.removeProperty("transition");
              rect.style.transform = "scaleY(" + f + ")";
            });
          } else {
            rect.style.transform = "scaleY(" + f + ")";
          }
          if (valText) {
            valText.setAttribute("font-size", fsVal);
            const barTop = pad.t + innerH * (1 - f);
            valText.setAttribute("x", String(xCol + barW / 2));
            valText.setAttribute("y", String(barTop - 5));
            valText.textContent =
              valDisplay === null || valDisplay === undefined ? "—" : Number(valDisplay).toFixed(2);
          }
          if (labText) {
            labText.setAttribute("font-size", fsLab);
            labText.setAttribute("x", String(xCol + barW / 2));
            labText.setAttribute("y", String(h - 9));
            labText.textContent = labStr;
          }
        }

        const xAtU = function (i) {
          return pad.l + i * (barW + barGap);
        };
        applyBarF(rectTrial, valTrial, labTrial, fTrial, xAtU(0), value, "试算");
        applyBarF(rectR1, valR1, labR1, f1, xAtU(1), hi1, lab1);
        applyBarF(rectR2, valR2, labR2, f2, xAtU(2), hi2, lab2);
        applyBarF(rectR3, valR3, labR3, f3, xAtU(3), hi3, lab3);

        if (yLabel) yLabel.setAttribute("fill", P.slate);
        if (rectTrial) rectTrial.setAttribute("fill", fillCur);
        if (rectR1) rectR1.setAttribute("fill", tierPal.high);
        if (rectR2) rectR2.setAttribute("fill", tierPal.mid);
        if (rectR3) rectR3.setAttribute("fill", tierPal.low);
        [valTrial, valR1, valR2, valR3].forEach(function (t) {
          if (t) t.setAttribute("fill", P.nearBlack);
        });
        [labTrial, labR1, labR2, labR3].forEach(function (t) {
          if (t) t.setAttribute("fill", P.slate);
        });

        const yBot = pad.t + innerH;
        const xL = pad.l;
        const xR = pad.l + innerW;
        const ruleStroke = ["#2f8f62", "#c97935", "#c94f58"];

        const gBandsEl = svg.querySelector(".chart-tier-bands");
        if (gBandsEl) {
          const zr = gBandsEl.querySelectorAll(".tier-zone");
          const canBand = hi1 != null && hi3 != null && hi1 >= hi3;
          if (canBand && zr.length === 3) {
            const y1 = yForScore(hi1);
            const y3 = yForScore(hi3);
            const h0 = Math.max(0, y1 - pad.t);
            const h1z = Math.max(0, y3 - y1);
            const h2z = Math.max(0, yBot - y3);
            zr[0].setAttribute("x", String(xL));
            zr[0].setAttribute("y", String(pad.t));
            zr[0].setAttribute("width", String(innerW));
            zr[0].setAttribute("height", String(h0));
            zr[0].setAttribute("fill", tierPal.high);
            zr[0].setAttribute("opacity", "0.13");

            zr[1].setAttribute("x", String(xL));
            zr[1].setAttribute("y", String(y1));
            zr[1].setAttribute("width", String(innerW));
            zr[1].setAttribute("height", String(h1z));
            zr[1].setAttribute("fill", tierPal.mid);
            zr[1].setAttribute("opacity", "0.14");

            zr[2].setAttribute("x", String(xL));
            zr[2].setAttribute("y", String(y3));
            zr[2].setAttribute("width", String(innerW));
            zr[2].setAttribute("height", String(h2z));
            zr[2].setAttribute("fill", tierPal.low);
            zr[2].setAttribute("opacity", "0.14");
          } else {
            zr.forEach(function (r) {
              r.setAttribute("opacity", "0");
            });
          }
        }

        [
          { hi: hi1, lab: lab1 },
          { hi: hi2, lab: lab2 },
          { hi: hi3, lab: lab3 },
        ].forEach(function (rule, idx) {
          const ti = idx + 1;
          const line = svg.querySelector(".tier-rule--" + ti);
          const lab = svg.querySelector(".tier-rule-lab--" + ti);
          if (rule.hi == null || !Number.isFinite(rule.hi)) {
            if (line) line.setAttribute("opacity", "0");
            if (lab) lab.setAttribute("opacity", "0");
            return;
          }
          const yy = yForScore(rule.hi);
          if (line) {
            line.setAttribute("x1", String(xL));
            line.setAttribute("x2", String(xR));
            line.setAttribute("y1", String(yy));
            line.setAttribute("y2", String(yy));
            line.setAttribute("stroke", ruleStroke[idx]);
            line.setAttribute("opacity", "0.92");
          }
          if (lab) {
            lab.setAttribute("x", String(xR - 2));
            lab.setAttribute("y", String(yy - 3));
            lab.setAttribute("fill", ruleStroke[idx]);
            lab.textContent = rule.lab + " " + rule.hi.toFixed(2);
            lab.setAttribute("opacity", "1");
          }
        });

        const customStroke = ["#475569", "#7c3aed", "#0d9488"];
        customVals.forEach(function (cv, idx) {
          const ti = idx + 1;
          const line = svg.querySelector(".custom-rule--" + ti);
          const lab = svg.querySelector(".custom-rule-lab--" + ti);
          if (cv == null || !Number.isFinite(cv)) {
            if (line) line.setAttribute("opacity", "0");
            if (lab) lab.setAttribute("opacity", "0");
            return;
          }
          const yy = yForScore(cv);
          if (line) {
            line.setAttribute("x1", String(xL));
            line.setAttribute("x2", String(xR));
            line.setAttribute("y1", String(yy));
            line.setAttribute("y2", String(yy));
            line.setAttribute("stroke", customStroke[idx]);
            line.setAttribute("opacity", "0.88");
          }
          if (lab) {
            lab.setAttribute("x", String(xL + 4));
            lab.setAttribute("y", String(yy - 3));
            lab.setAttribute("fill", customStroke[idx]);
            lab.textContent = "线" + ti + " " + cv.toFixed(2);
            lab.setAttribute("opacity", "1");
          }
        });
      }

      function escapeSvgText(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      let zeroBannerExitHandler = null;

      /** 分数由 0 变为非 0 时先播退场动画再 hidden；回到 0 时取消退场并显示 */
      function syncZeroBannerVisibility(isZero) {
        const el = document.getElementById("scoreZeroBanner");
        if (!el) return;
        if (isZero) {
          if (zeroBannerExitHandler) {
            el.removeEventListener("animationend", zeroBannerExitHandler);
            zeroBannerExitHandler = null;
          }
          if (el._zeroExitFallback) {
            clearTimeout(el._zeroExitFallback);
            el._zeroExitFallback = null;
          }
          el.classList.remove("score-zero-banner--exiting");
          el.hidden = false;
          return;
        }
        if (el.hidden) return;
        if (prefersReducedMotion()) {
          el.classList.remove("score-zero-banner--exiting");
          el.hidden = true;
          return;
        }
        if (el.classList.contains("score-zero-banner--exiting")) return;

        function onEnd(e) {
          if (e.target !== el) return;
          const n = e.animationName || "";
          if (String(n).indexOf("scoreZeroBannerExit") === -1) return;
          el.removeEventListener("animationend", onEnd);
          zeroBannerExitHandler = null;
          if (el._zeroExitFallback) {
            clearTimeout(el._zeroExitFallback);
            el._zeroExitFallback = null;
          }
          el.classList.remove("score-zero-banner--exiting");
          el.hidden = true;
        }

        zeroBannerExitHandler = onEnd;
        el.addEventListener("animationend", onEnd);
        el._zeroExitFallback = setTimeout(function () {
          el._zeroExitFallback = null;
          el.removeEventListener("animationend", onEnd);
          zeroBannerExitHandler = null;
          el.classList.remove("score-zero-banner--exiting");
          el.hidden = true;
        }, 480);
        requestAnimationFrame(function () {
          el.classList.add("score-zero-banner--exiting");
        });
      }

      function update() {
        const x = readInputs();
        const r = computeTurn(x.wp, x.we, x.b, x.takeoff);
        const score = r.S;

        document.getElementById("outS").textContent = r.S.toFixed(2);

        const primaryBlock = document.getElementById("scorePrimaryBlock");
        const isZero = r.S === 0;
        primaryBlock.classList.toggle("result-block--score-zero", isZero);
        syncZeroBannerVisibility(isZero);

        const w1 = document.getElementById("warn1");
        w1.hidden = !r.warn;
        w1.textContent = r.warn;

        renderCompareTable();
        renderSensitivityCharts();
        renderDiffTable();

        const snapErr = document.getElementById("snapshotSaveError");
        if (snapErr && !snapErr.hidden && r.S > 0 && snapErr.textContent.indexOf("成绩为 0") !== -1) {
          clearSnapshotSaveError();
        }
      }

      function loadTrialsFromLegacy() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY_LEGACY);
          if (!raw) return [];
          const arr = JSON.parse(raw);
          return Array.isArray(arr) ? arr : [];
        } catch {
          return [];
        }
      }

      function migrateLegacyToUnified() {
        const trials = loadTrialsFromLegacy();
        const db = { v: 1, trials: trials };
        try {
          localStorage.setItem(UNIFIED_DB_KEY, JSON.stringify(db));
          localStorage.removeItem(REF_LIB_KEY_LEGACY);
          localStorage.removeItem(STORAGE_KEY_LEGACY);
        } catch (e) {
          /* ignore quota */
        }
        return db;
      }

      function loadUnifiedDb() {
        try {
          const raw = localStorage.getItem(UNIFIED_DB_KEY);
          if (raw) {
            const o = JSON.parse(raw);
            if (o && o.v === 1 && Array.isArray(o.trials)) return o;
          }
        } catch {
          /* fall through */
        }
        return migrateLegacyToUnified();
      }

      function saveUnifiedDb(db) {
        localStorage.setItem(
          UNIFIED_DB_KEY,
          JSON.stringify({ v: 1, trials: db.trials || [] })
        );
      }

      function loadSnapshots() {
        try {
          const db = loadUnifiedDb();
          return db.trials || [];
        } catch {
          return [];
        }
      }

      function saveSnapshots(list) {
        const db = loadUnifiedDb();
        db.trials = Array.isArray(list) ? list : [];
        saveUnifiedDb(db);
      }

      let comparePick = [];

      function renderSnapshotList() {
        const list = loadSnapshots();
        const ul = document.getElementById("snapshotList");
        ul.innerHTML = "";
        list
          .slice()
          .reverse()
          .forEach((snap, revIdx) => {
            const idx = list.length - 1 - revIdx;
            const li = document.createElement("li");
            if (comparePick.indexOf(idx) >= 0) {
              li.style.borderColor =
                getComputedStyle(document.documentElement).getPropertyValue("--expo-black").trim() || "#000";
              li.style.background = "rgba(0, 0, 0, 0.05)";
              li.style.boxShadow = "0 0 0 1px rgba(0, 0, 0, 0.12)";
            }
            const left = document.createElement("div");
            const name = snap.name || "未命名";
            const d = new Date(snap.at);
            left.innerHTML =
              "<strong>" +
              escapeHtml(name) +
              '</strong><div class="meta">' +
              d.toLocaleString("zh-CN") +
              " · S<sub>turn</sub> " +
              (snap.total != null ? snap.total.toFixed(2) : "—") +
              "</div>";
            const btns = document.createElement("div");
            btns.style.display = "flex";
            btns.style.gap = "6px";
            const bCompare = document.createElement("button");
            bCompare.type = "button";
            bCompare.className = "ghost";
            bCompare.textContent = "对比";
            bCompare.addEventListener("click", () => toggleCompare(idx));
            const bLoad = document.createElement("button");
            bLoad.type = "button";
            bLoad.className = "secondary";
            bLoad.textContent = "载入";
            bLoad.addEventListener("click", () => loadSnapshot(snap));
            const bDel = document.createElement("button");
            bDel.type = "button";
            bDel.className = "ghost";
            bDel.textContent = "删";
            bDel.addEventListener("click", () => deleteSnapshot(idx));
            btns.appendChild(bLoad);
            btns.appendChild(bCompare);
            btns.appendChild(bDel);
            li.appendChild(left);
            li.appendChild(btns);
            ul.appendChild(li);
          });
        populateDiffSelect();
        populateCompSelects();
        renderDiffTable();
      }

      function toggleCompare(idx) {
        const i = comparePick.indexOf(idx);
        if (i >= 0) comparePick.splice(i, 1);
        else {
          comparePick.push(idx);
          if (comparePick.length > 2) comparePick.shift();
        }
        renderSnapshotList();
        renderCompareTable();
      }

      function loadSnapshot(snap) {
        document.getElementById("wp").value = snap.wp;
        document.getElementById("we").value = snap.we;
        document.getElementById("b").value = snap.b;
        document.getElementById("takeoff").value = takeoffFromSnap(snap);
        syncSlidersFromNumbers();
        update();
      }

      function deleteSnapshot(idx) {
        const list = loadSnapshots();
        list.splice(idx, 1);
        saveSnapshots(list);
        const saved = localStorage.getItem(DIFF_IDX_KEY);
        if (saved !== null) {
          const si = Number(saved);
          if (si === idx) localStorage.removeItem(DIFF_IDX_KEY);
          else if (si > idx) localStorage.setItem(DIFF_IDX_KEY, String(si - 1));
        }
        comparePick = comparePick
          .map((j) => (j > idx ? j - 1 : j))
          .filter((j) => j >= 0 && j < list.length);
        renderSnapshotList();
        renderCompareTable();
      }

      function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
      }

      function renderCompareTable() {
        const list = loadSnapshots();
        const cur = snapshotFromInputs();
        const rCur = computeTurn(cur.wp, cur.we, cur.b, cur.takeoff);
        const total = rCur.S;

        const aIdx = comparePick[comparePick.length - 2];
        const bIdx = comparePick[comparePick.length - 1];
        const snapA = aIdx != null ? list[aIdx] : null;
        const snapB = bIdx != null ? list[bIdx] : null;

        const table = document.getElementById("compareTable");
        const compareWrap = document.getElementById("compareTableWrap");
        const body = document.getElementById("compareBody");
        document.getElementById("thCurrent").textContent = "当前";
        document.getElementById("thA").textContent = snapA ? snapA.name || "快照A" : "快照 A";
        document.getElementById("thB").textContent = snapB ? snapB.name || "快照B" : "快照 B";

        if (!snapA && !snapB) {
          table.hidden = true;
          if (compareWrap) compareWrap.hidden = true;
          return;
        }
        table.hidden = false;
        if (compareWrap) compareWrap.hidden = false;

        function scoreFromSnap(s) {
          if (!s) return null;
          const t = takeoffFromSnap(s);
          return computeTurn(s.wp, s.we, s.b, t).S;
        }

        const rows = [
          { k: "W_payload (g)", cur: cur.wp, a: snapA && snapA.wp, b: snapB && snapB.wp },
          { k: "W_empty (g)", cur: cur.we, a: snapA && snapA.we, b: snapB && snapB.we },
          { k: "b (mm)", cur: cur.b, a: snapA && snapA.b, b: snapB && snapB.b },
          { k: "起飞 (m)", cur: cur.takeoff, a: snapA ? takeoffFromSnap(snapA) : null, b: snapB ? takeoffFromSnap(snapB) : null },
          {
            k: "S_turn",
            cur: total,
            a: snapA ? scoreFromSnap(snapA) : null,
            b: snapB ? scoreFromSnap(snapB) : null,
            num: true,
          },
        ];

        body.innerHTML = "";
        rows.forEach((r) => {
          const tr = document.createElement("tr");
          const td0 = document.createElement("td");
          td0.textContent = r.k;
          tr.appendChild(td0);
          [r.cur, r.a, r.b].forEach((v) => {
            const td = document.createElement("td");
            if (v == null || v === "") td.textContent = "—";
            else if (r.num) td.textContent = Number(v).toFixed(2);
            else td.textContent = typeof v === "number" && !Number.isInteger(v) ? String(v) : String(v);
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });

        function appendTotalDeltaCell(td, snapTotal) {
          if (snapTotal == null || !Number.isFinite(snapTotal)) {
            td.textContent = "—";
            return;
          }
          const d = snapTotal - total;
          const span = document.createElement("span");
          span.className = d >= 0 ? "delta-pos" : "delta-neg";
          span.textContent = (d >= 0 ? "+" : "") + d.toFixed(2);
          td.title = "该列单轮成绩 − 当前单轮";
          td.appendChild(span);
        }

        if (snapA || snapB) {
          const trD = document.createElement("tr");
          trD.className = "diff-score-start";
          const tdL = document.createElement("td");
          tdL.textContent = "S_turn 与当前差（列 − 当前）";
          trD.appendChild(tdL);
          const tdC = document.createElement("td");
          tdC.textContent = "—";
          trD.appendChild(tdC);
          const tdDa = document.createElement("td");
          appendTotalDeltaCell(tdDa, snapA ? scoreFromSnap(snapA) : null);
          trD.appendChild(tdDa);
          const tdDb = document.createElement("td");
          appendTotalDeltaCell(tdDb, snapB ? scoreFromSnap(snapB) : null);
          trD.appendChild(tdDb);
          body.appendChild(trD);

          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 4;
          td.className = "compare-table__hint";
          td.textContent = "在「已存试算列表」中点「对比」最多选两条，与当前试算并排对照；与右侧「逐项差距」不同，本表不显示 Δ 列。";
          tr.appendChild(td);
          body.appendChild(tr);
        }
      }

      function clearSnapshotSaveError() {
        const err = document.getElementById("snapshotSaveError");
        const nameEl = document.getElementById("snapName");
        if (err) {
          err.hidden = true;
          err.textContent = "";
        }
        if (nameEl) nameEl.classList.remove("snapshot-name-invalid");
      }

      function validateSnapshotBeforeSave() {
        const nameEl = document.getElementById("snapName");
        const err = document.getElementById("snapshotSaveError");
        const name = nameEl.value.trim();
        const x = readInputs();
        const r = computeTurn(x.wp, x.we, x.b, x.takeoff);
        nameEl.classList.remove("snapshot-name-invalid");
        err.hidden = true;
        err.textContent = "";
        if (!name) {
          err.textContent = "请填写结果名称后再保存。";
          err.hidden = false;
          nameEl.classList.add("snapshot-name-invalid");
          nameEl.focus();
          return false;
        }
        if (r.S === 0) {
          err.textContent = "当前单轮成绩为 0，不能保存。请调整参数使得分大于 0 后再保存。";
          err.hidden = false;
          return false;
        }
        return true;
      }

      function pushSnapshot(name) {
        const cur = snapshotFromInputs();
        const r = computeTurn(cur.wp, cur.we, cur.b, cur.takeoff);
        const total = r.S;
        const list = loadSnapshots();
        list.push({
          name: name || "快照 " + (list.length + 1),
          ...cur,
          total,
        });
        saveSnapshots(list);
        renderSnapshotList();
        renderCompareTable();
      }

      document.getElementById("btnSaveResult").addEventListener("click", function () {
        const chk = document.getElementById("chkSaveResult");
        if (!chk || !chk.checked) {
          window.alert("请先勾选「将本次试算保存到已存结果列表」，再点击保存。");
          return;
        }
        if (!validateSnapshotBeforeSave()) return;
        const n = document.getElementById("snapName").value.trim();
        pushSnapshot(n);
        document.getElementById("snapName").value = "";
        chk.checked = false;
        clearSnapshotSaveError();
      });

      document.getElementById("snapName").addEventListener("input", clearSnapshotSaveError);

      document.getElementById("btnClearSnaps").addEventListener("click", () => {
        if (confirm("确定清空所有已存结果？")) {
          saveSnapshots([]);
          localStorage.removeItem(DIFF_IDX_KEY);
          localStorage.removeItem(COMP_BASE_KEY);
          comparePick = [];
          renderSnapshotList();
          renderCompareTable();
        }
      });

      document.getElementById("compBaselineSelect").addEventListener("change", function () {
        if (this.value) localStorage.setItem(COMP_BASE_KEY, this.value);
        else localStorage.removeItem(COMP_BASE_KEY);
        const tgt = document.getElementById("compTargetsSelect");
        if (tgt) {
          Array.from(tgt.options).forEach(function (o) {
            if (o.value === this.value) o.selected = false;
          }, this);
        }
        renderCompMatrix();
      });
      document.getElementById("compTargetsSelect").addEventListener("change", renderCompMatrix);

      document.getElementById("diffSnapSelect").addEventListener("change", function () {
        if (this.value) localStorage.setItem(DIFF_IDX_KEY, this.value);
        else localStorage.removeItem(DIFF_IDX_KEY);
        renderDiffTable();
      });

      const syncSlidersFromNumbers = (function () {
        const pairs = [
          { numId: "wp", rangeId: "wpSl", min: 0, max: 2000, decimals: null },
          { numId: "we", rangeId: "weSl", min: 0, max: 2000, decimals: null },
          { numId: "b", rangeId: "bSl", min: 0, max: 4000, decimals: null },
        ];
        function clamp(v, min, max) {
          if (Number.isNaN(v)) return min;
          return Math.min(max, Math.max(min, v));
        }
        function syncAll() {
          pairs.forEach((p) => {
            const n = document.getElementById(p.numId);
            const r = document.getElementById(p.rangeId);
            let v = parseFloat(n.value);
            if (Number.isNaN(v)) return;
            v = clamp(v, p.min, p.max);
            r.value = p.decimals != null ? v.toFixed(p.decimals) : String(Math.round(v));
          });
        }
        pairs.forEach((p) => {
          document.getElementById(p.rangeId).addEventListener("input", function () {
            const r = document.getElementById(p.rangeId);
            const n = document.getElementById(p.numId);
            const rv = Number(r.value);
            if (p.decimals != null) n.value = rv.toFixed(p.decimals);
            else n.value = String(Math.round(rv));
            update();
          });
          document.getElementById(p.numId).addEventListener("input", function () {
            const r = document.getElementById(p.rangeId);
            const n = document.getElementById(p.numId);
            let v = parseFloat(n.value);
            if (Number.isNaN(v)) {
              update();
              return;
            }
            v = clamp(v, p.min, p.max);
            if (p.decimals != null) n.value = v.toFixed(p.decimals);
            else n.value = String(Math.round(v));
            r.value = p.decimals != null ? v.toFixed(p.decimals) : String(Math.round(v));
            update();
          });
        });
    })();

      (function initTakeoffSegment() {
        const seg = document.getElementById("takeoffSegment");
        const hiddenInp = document.getElementById("takeoff");
        if (!seg || !hiddenInp) return;
        const btns = seg.querySelectorAll(".takeoff-btn");
        btns.forEach(btn => {
          btn.addEventListener("click", function() {
            const val = this.getAttribute("data-val");
            seg.setAttribute("data-value", val);
            btns.forEach(b => b.setAttribute("aria-pressed", b.getAttribute("data-val") === val ? "true" : "false"));
            hiddenInp.value = val;
            update();
          });
        });
      })();

      /** 左侧参数输入聚焦时，右侧「评分公式」对应格子高亮 */
      const FORMULA_PARAM_BY_INPUT_ID = {
        wp: "wp",
        wpSl: "wp",
        we: "we",
        weSl: "we",
        b: "b",
        bSl: "b",
        takeoff: "d",
        takeoffSl: "d",
      };

      function setFormulaParamHighlight(paramKey) {
        const row = document.getElementById("headerFormulaRow");
        if (!row) return;
        row.querySelectorAll(".formula-cell[data-formula-param]").forEach(function (cell) {
          const on = Boolean(paramKey) && cell.getAttribute("data-formula-param") === paramKey;
          cell.classList.toggle("formula-cell--hl", on);
        });
      }

      function wireFormulaParamHighlight() {
        const card = document.querySelector(".param-input-card");
        if (!card) return;
        card.addEventListener(
          "focusin",
          function (e) {
            const t = e.target;
            if (!t || !t.id) {
              setFormulaParamHighlight(null);
              return;
            }
            const key = FORMULA_PARAM_BY_INPUT_ID[t.id];
            setFormulaParamHighlight(key != null ? key : null);
          },
          true
        );
        card.addEventListener(
          "focusout",
          function (e) {
            const next = e.relatedTarget;
            if (next && card.contains(next)) return;
            setFormulaParamHighlight(null);
          },
          true
        );
      }


      function syncBodyScrollLock() {
        const infoM = document.getElementById("pageInfoModal");
        const locked = infoM && !infoM.hidden;
        document.body.style.overflow = locked ? "hidden" : "";
      }

      function cancelRefModalTransition(modal) {
        if (!modal || !modal._refModalCloseCleanup) return;
        modal._refModalCloseCleanup();
        delete modal._refModalCloseCleanup;
      }

      function animateModalOpen(modal) {
        if (!modal) return;
        cancelRefModalTransition(modal);
        delete modal.dataset.modalClosing;
        modal.hidden = false;
        modal.classList.remove("ref-modal--open");
        syncBodyScrollLock();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            modal.classList.add("ref-modal--open");
          });
        });
      }

      function animateModalClose(modal, onComplete) {
        if (!modal || modal.hidden) {
          if (onComplete) onComplete();
          return;
        }
        if (modal.dataset.modalClosing === "1") return;
        const panel = modal.querySelector(".ref-modal__panel") || modal.querySelector(".page-info__panel") || modal.firstElementChild;
        const prefersReduced =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        modal.dataset.modalClosing = "1";
        modal.classList.remove("ref-modal--open");

        const finish = () => {
          delete modal.dataset.modalClosing;
          modal.hidden = true;
          modal.classList.remove("ref-modal--open");
          syncBodyScrollLock();
          delete modal._refModalCloseCleanup;
          if (onComplete) onComplete();
        };

        if (prefersReduced || !panel) {
          finish();
          return;
        }

        let finished = false;
        const doFinish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(fallbackId);
          if (onEnd) panel.removeEventListener("transitionend", onEnd);
          finish();
        };

        const fallbackId = setTimeout(doFinish, 420);

        function onEnd(e) {
          if (e.target !== panel) return;
          doFinish();
        }

        panel.addEventListener("transitionend", onEnd);
        modal._refModalCloseCleanup = () => {
          if (finished) return;
          clearTimeout(fallbackId);
          panel.removeEventListener("transitionend", onEnd);
        };
      }

      function openPageInfoModal() {
        const modal = document.getElementById("pageInfoModal");
        if (!modal) return;
        const btn = document.getElementById("btnPageInfo");
        if (btn) btn.setAttribute("aria-expanded", "true");
        animateModalOpen(modal);
        const closeBtn = document.getElementById("pageInfoCloseBtn");
        if (closeBtn) closeBtn.focus();
      }

      function closePageInfoModal() {
        const modal = document.getElementById("pageInfoModal");
        if (!modal) return;
        animateModalClose(modal, () => {
          const btn = document.getElementById("btnPageInfo");
          if (btn) {
            btn.setAttribute("aria-expanded", "false");
            btn.focus();
          }
        });
      }

      document.getElementById("btnPageInfo").addEventListener("click", openPageInfoModal);
      document.getElementById("pageInfoCloseBtn").addEventListener("click", closePageInfoModal);
      document.getElementById("pageInfoCloseX").addEventListener("click", closePageInfoModal);
      document.getElementById("pageInfoBackdrop").addEventListener("click", closePageInfoModal);
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        const infoM = document.getElementById("pageInfoModal");
        if (infoM && !infoM.hidden) {
          closePageInfoModal();
        }
      });

      const THEME_KEY = "model-aircraft-theme-pref-v1";

      function getStoredThemePref() {
        try {
          return localStorage.getItem(THEME_KEY) || "system";
        } catch {
          return "system";
        }
      }

      function resolveThemeIsDark(pref) {
        if (pref === "dark") return true;
        if (pref === "light") return false;
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
      }

      function applyTheme() {
        const pref = getStoredThemePref();
        const dark = resolveThemeIsDark(pref);
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
        document.documentElement.setAttribute("data-theme-pref", pref);
        const meta = document.getElementById("metaThemeColor");
        if (meta) meta.setAttribute("content", dark ? "#12151a" : "#f0f0f3");
        const toggle = document.getElementById("themeToggle");
        if (toggle) {
          toggle.setAttribute("data-pref", pref);
          toggle.querySelectorAll(".theme-toggle__btn").forEach(function (btn) {
            const v = btn.getAttribute("data-pref");
            btn.setAttribute("aria-pressed", v === pref ? "true" : "false");
          });
        }
        update();
      }

      function setThemePref(pref) {
        try {
          localStorage.setItem(THEME_KEY, pref);
        } catch (_) {}
        applyTheme();
      }

      document.getElementById("themeToggle").addEventListener("click", function (e) {
        const btn = e.target.closest(".theme-toggle__btn");
        if (!btn) return;
        const p = btn.getAttribute("data-pref");
        if (p) setThemePref(p);
      });

      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (getStoredThemePref() === "system") applyTheme();
      });

      let resizeT;
      window.addEventListener("resize", function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(update, 120);
      });

      wireFormulaParamHighlight();

      loadCustomScoreLinesIntoInputs();
      for (let ci = 1; ci <= 3; ci++) {
        const el = document.getElementById("customScoreLine" + ci);
        if (!el) continue;
        el.addEventListener("input", function () {
          saveCustomScoreLinesFromInputs();
          update();
        });
        el.addEventListener("change", function () {
          saveCustomScoreLinesFromInputs();
        });
      }

      renderSnapshotList();
      syncSlidersFromNumbers();
      applyTheme();
    })();

