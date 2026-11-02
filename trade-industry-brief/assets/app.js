(function () {
  "use strict";
  /* ---------- 기간 선택 ----------
   * periods/*.js 파일이 window.PERIODS["YYYY-MM"]에 기간별 데이터를 등록합니다.
   * ?p=YYYY-MM 로 기간을 고르고, 없으면 가장 최근 기간을 보여줍니다.
   */
  const PERIODS = window.PERIODS || {};
  const KEYS = Object.keys(PERIODS).sort();
  const qp = new URLSearchParams(location.search).get("p");
  const KEY = KEYS.includes(qp) ? qp : KEYS[KEYS.length - 1];
  const R = PERIODS[KEY];
  const PREV = KEYS.indexOf(KEY) > 0 ? PERIODS[KEYS[KEYS.indexOf(KEY) - 1]] : null;
  const NEXT = KEYS.indexOf(KEY) < KEYS.length - 1 ? PERIODS[KEYS[KEYS.indexOf(KEY) + 1]] : null;
  const L = R.labels;
  const periodUrl = (k) => `?p=${k}`;
  const $ = (sel, root = document) => root.querySelector(sel);
  const charts = {};

  /* ---------- helpers ---------- */
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 1) => v == null ? "–" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const cls = (v) => v == null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "flat";
  const pct = (v, d = 1, unit = "%") => {
    if (v == null) return '<span class="flat">–</span>';
    const arrow = v > 0 ? "▲" : v < 0 ? "▼" : "";
    return `<span class="${cls(v)}">${arrow}${fmt(Math.abs(v), d)}${unit}</span>`;
  };
  const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SECTOR_COLORS = {
    semi: "#1f4e79", computer: "#3f7cbf", mobile: "#6f9bc8", auto: "#8c2d3a", ship: "#2f6f6a",
    energy: "#a8661c", battery: "#56853a", materials: "#5f6670", machinery: "#4a5689", consumer: "#9a4f72", other: "#aab3bc"
  };

  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, config);
  }
  function baseOptions(extra = {}) {
    const grid = css("--rule"), ink = css("--muted");
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 500 },
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: ink, boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: { padding: 8 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: grid }, border: { display: false }, ticks: { color: ink, font: { size: 11 } } }
      }
    }, extra);
  }

  /* ---------- meta ---------- */
  function renderMeta() {
    const m = R.meta;
    const src = `${m.tradeIssuer} 「${m.tradeTitle}」(${m.tradeDate}), ${m.industryIssuer} 「${m.industryTitle}」(${m.industryDate})`;
    document.title = `수출입·산업활동 브리핑 | ${R.label}`;
    $("#footerSources").textContent = `원자료: ${src}. 숫자는 보도자료를 옮긴 것이며 해석 문구는 이 사이트의 정리입니다.`;
    const sel = $("#periodSelect");
    sel.innerHTML = KEYS.slice().reverse().map((k) => `<option value="${k}"${k === KEY ? " selected" : ""}>${esc(PERIODS[k].label)}${k === KEYS[KEYS.length - 1] ? " (최신)" : ""}</option>`).join("");
    sel.addEventListener("change", () => { location.search = periodUrl(sel.value).slice(1); });
    if (KEY !== KEYS[KEYS.length - 1]) {
      $("#archiveBanner").hidden = false;
      $("#archiveBanner").innerHTML = `지난 기록을 보고 있습니다: <b>${esc(R.label)}</b>. <a href="${periodUrl(KEYS[KEYS.length - 1])}">최신 자료로 가기</a>`;
    }
    $("#heroLede").innerHTML = R.hero;
    $("#mixMonth").textContent = L.tradeMonth;
    $("#sectorsIntro").textContent = `수출은 ${L.tradeMonth}, 생산·출하·재고는 ${L.industryMonth} 기준입니다. 분야를 고르면 수출 추이, 산업 지표, 가격, 지역을 한 화면에서 볼 수 있습니다.`;
    $("#workdaysIntro").textContent = R.texts.workdaysIntro;
    $("#pricesIntro").textContent = R.texts.pricesIntro;
    $("#semiGapCaption").textContent = R.texts.semiGapCaption;
    $("#fxCaption").textContent = R.texts.fxCaption;
    $("#tradeHead").innerHTML = `${L.tradeMonth} 수출입 <span class="muted">통관기준 잠정치</span>`;
    $("#industryHead").innerHTML = `${L.industryMonth} 산업활동 <span class="muted">전월비는 계절조정, 전년동월비는 원계열</span>`;
    $("#semiGapHead").innerHTML = `반도체: 수출액과 국내 생산 <span class="muted">전년동월비 %, ’26.1~${R.industry.indexLabels[R.industry.indexLabels.length - 1]}</span>`;
    $("#flowIntro").textContent = `수출이 좋을 때 가격, 생산, 출하, 재고, 투자도 같은 방향으로 움직이는지 확인합니다. 수출은 조업일수 차이(${R.workdays.prev}일 → ${R.workdays.curr}일)를 없애려고 일평균 기준으로 환산했고, 산업 지표는 ${L.industryMonth}, 수출은 ${L.tradeMonth}이라 한 달 시차가 있습니다.`;
  }

  /* ---------- hero: 수출 구성 막대 ---------- */
  function sectorTotals(s) {
    const cur = s.exports.reduce((a, e) => a + e.cur, 0);
    const prev = s.exports.reduce((a, e) => a + e.prev, 0);
    // 품목이 하나면 보도자료의 증감률을 그대로 사용 (반올림 오차 방지)
    const yoy = s.exports.length === 1 ? s.exports[0].yoy : (cur / prev - 1) * 100;
    return { cur, prev, yoy };
  }
  function renderMix() {
    const total = R.trade.export.value;
    const segs = R.sectors.map((s) => ({ id: s.id, name: s.name, v: sectorTotals(s).cur })).sort((a, b) => b.v - a.v);
    const covered = segs.reduce((a, s) => a + s.v, 0);
    segs.push({ id: "other", name: "기타", v: total - covered });
    const bar = $("#mixBar"), legend = $("#mixLegend");
    bar.innerHTML = ""; legend.innerHTML = "";
    segs.forEach((s) => {
      const share = (s.v / total) * 100;
      const b = document.createElement(s.id === "other" ? "div" : "button");
      b.className = "mix__seg";
      b.style.flex = `${s.v} 0 0`;
      b.style.background = SECTOR_COLORS[s.id];
      if (s.id === "other") b.style.color = "#1c2733";
      b.innerHTML = share >= 6 ? `${esc(s.name)}<span>${fmt(share)}%</span>` : "";
      b.title = `${s.name} ${fmt(s.v)}억 달러 (${fmt(share)}%)`;
      if (s.id !== "other") {
        b.type = "button";
        b.setAttribute("aria-label", `${s.name} ${fmt(s.v)}억 달러, 비중 ${fmt(share)}%. 분야별 동향 보기`);
        b.addEventListener("click", () => { selectSector(s.id); $("#sectors").scrollIntoView(); });
      }
      bar.appendChild(b);
      const li = document.createElement("li");
      li.innerHTML = `<i style="background:${SECTOR_COLORS[s.id]}"></i>${esc(s.name)} ${fmt(s.v)}억 달러`;
      legend.appendChild(li);
    });
  }

  /* ---------- 요약 ---------- */
  function renderSummary() {
    const t = R.trade;
    const figs = [
      ["수출", `${fmt(t.export.value)}억 달러`, `전년동월비 ${pct(t.export.yoy)}`],
      ["수입", `${fmt(t.import.value)}억 달러`, `전년동월비 ${pct(t.import.yoy)}`],
      ["무역수지", `${fmt(t.balance.value)}억 달러 흑자`, `${t.balance.streak}개월 연속 흑자`],
      ["일평균 수출", `${fmt(t.export.daily)}억 달러`, `전년동월비 ${pct(t.export.dailyYoy)}`],
      [`${L.ytd} 누적 수출`, `${fmt(t.ytd.export, 0)}억 달러`, `${pct(t.ytd.exportYoy)}, ${esc(t.ytd.note)}`],
      [`${L.ytd} 누적 수지`, `${fmt(t.ytd.balance, 0)}억 달러`, `수입 누적 ${fmt(t.ytd.import, 0)}억 달러(${pct(t.ytd.importYoy)})`]
    ];
    $("#tradeFigures").innerHTML = figs.map(([k, v, s]) => `<div><dt>${k}</dt><dd>${v}<small>${s}</small></dd></div>`).join("");

    $("#industryTable tbody").innerHTML = R.industry.headline.map((r) =>
      `<tr><th scope="row">${r.name}</th><td class="num">${pct(r.mom)}</td><td class="num">${pct(r.yoy)}</td><td class="note">${esc(r.note)}</td></tr>`).join("");
    $("#industryExtra").innerHTML = R.industry.extra.map((r) => `<div><dt>${r.name}</dt><dd>${r.value}<small>${r.change}</small></dd></div>`).join("");

    const items = R.takeaways;
    $("#takeaways").innerHTML = items.map((i) => `<li>${i}</li>`).join("");

    makeChart("tradeChart", {
      data: {
        labels: R.months,
        datasets: [
          { type: "bar", label: "무역수지", data: t.balanceMonthly, backgroundColor: css("--mark"), order: 3 },
          { type: "line", label: "수출", data: t.exportMonthly, borderColor: css("--up"), backgroundColor: css("--up"), pointRadius: 2, tension: .25, order: 1 },
          { type: "line", label: "수입", data: t.importMonthly, borderColor: css("--down"), backgroundColor: css("--down"), pointRadius: 2, tension: .25, order: 2 }
        ]
      },
      options: baseOptions({ plugins: { legend: { labels: { color: css("--muted"), boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${fmt(c.parsed.y)}억 달러` } } } })
    });
  }

  /* ---------- 분야별 ---------- */
  let currentSector = R.sectors[0].id;
  function renderSectorTabs() {
    const box = $("#sectorTabs");
    box.innerHTML = R.sectors.map((s) => {
      const t = sectorTotals(s);
      return `<button type="button" role="tab" id="tab-${s.id}" aria-controls="sectorPanel" aria-selected="${s.id === currentSector}" tabindex="${s.id === currentSector ? 0 : -1}" data-id="${s.id}">${esc(s.name)}<span class="chg ${cls(t.yoy)}">${t.yoy > 0 ? "▲" : "▼"}${fmt(Math.abs(t.yoy))}%</span></button>`;
    }).join("");
    box.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => selectSector(b.dataset.id)));
    box.addEventListener("keydown", (e) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
      const ids = R.sectors.map((s) => s.id);
      let i = ids.indexOf(currentSector);
      if (e.key === "ArrowRight") i = (i + 1) % ids.length;
      if (e.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
      if (e.key === "Home") i = 0;
      if (e.key === "End") i = ids.length - 1;
      e.preventDefault();
      selectSector(ids[i]);
      $(`#tab-${ids[i]}`).focus();
    });
  }

  function selectSector(id) {
    currentSector = id;
    document.querySelectorAll("#sectorTabs button").forEach((b) => {
      const on = b.dataset.id === id;
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    });
    $("#sectorPanel").setAttribute("aria-labelledby", `tab-${id}`);
    renderSector(R.sectors.find((s) => s.id === id));
    try { history.replaceState(null, "", `#${id}`); } catch (e) { /* ignore */ }
  }

  function renderSector(s) {
    Object.keys(charts).filter((k) => k.startsWith("sc-")).forEach((k) => { charts[k].destroy(); delete charts[k]; });
    const color = SECTOR_COLORS[s.id];

    const exportsHtml = s.exports.map((e, i) => `
      <div class="export" style="border-top-color:${color}">
        <div class="export__name"><span>${esc(e.name)}</span><span class="export__rank">${esc(e.rank || "")}</span></div>
        <div class="export__val">${fmt(e.cur)}<small> 억 달러</small></div>
        <div class="export__meta">전년동월 ${fmt(e.prev)}억 달러 대비 ${pct(e.yoy)}</div>
        <div class="chart chart--xs"><canvas id="sc-exp-${i}" aria-label="${esc(e.name)} 월별 수출 추이"></canvas></div>
      </div>`).join("");

    const breakdownHtml = s.breakdown.length ? `
      <div class="table-scroll"><table class="table table--dense">
        <thead><tr><th scope="col">세부</th><th scope="col" class="num">${L.prevTradeMonth}</th><th scope="col" class="num">${L.curTradeMonth}</th><th scope="col" class="num">증감률</th></tr></thead>
        <tbody>${s.breakdown.map((b) => `<tr><th scope="row">${esc(b.name)}</th><td class="num">${fmt(b.from, b.unit ? 0 : 1)}</td><td class="num">${fmt(b.to, b.unit ? 0 : 1)}</td><td class="num">${pct(b.yoy)}</td></tr>`).join("")}</tbody>
      </table></div><p class="caption">단위: 억 달러 (별도 표기 제외). 일부 전년 값은 증감률로 역산.</p>` : "";

    const rows = s.industry.map((n) => [n, R.industryRows[n]]).filter((r) => r[1]);
    const industryHtml = rows.length ? `
      <div class="table-scroll"><table class="table table--dense">
        <thead><tr><th scope="col" rowspan="2">업종</th><th scope="colgroup" class="grp" colspan="2">생산</th><th scope="colgroup" class="grp" colspan="2">출하</th><th scope="colgroup" class="grp" colspan="2">재고</th></tr>
        <tr><th scope="col" class="num">전월비</th><th scope="col" class="num">전년비</th><th scope="col" class="num">전월비</th><th scope="col" class="num">전년비</th><th scope="col" class="num">전월비</th><th scope="col" class="num">전년비</th></tr></thead>
        <tbody>${rows.map(([n, v]) => `<tr><th scope="row">${esc(n)}</th>${v.map((x) => `<td class="num">${pct(x)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>` : `<p class="empty">해당 업종 통계가 없습니다.</p>`;

    let indexChart = "";
    if (s.id === "semi" || s.id === "auto") {
      indexChart = `<div class="chart chart--sm" style="margin-top:14px"><canvas id="sc-index" aria-label="${s.name} 생산지수 추이"></canvas></div>
        <p class="caption">${s.name} 생산지수(원지수, 2020=100)와 같은 달 수출 증감률</p>`;
    }

    const decompRows = R.decomposition.filter((r) => r.sector === s.id);
    const priceKeys = s.prices || [];
    const chartKeys = priceKeys.filter((k) => R.prices[k]);
    let pricesHtml = "";
    if (chartKeys.length) {
      pricesHtml = `<div class="panel"><h3>가격</h3>
        ${chartKeys.map((k, i) => `<p class="caption" style="margin:${i ? 14 : 0}px 0 4px"><b>${R.prices[k].title}</b> (${R.prices[k].unit})${R.prices[k].note ? `, ${R.prices[k].note}` : ""}</p><div class="chart chart--xs"><canvas id="sc-price-${k}"></canvas></div>`).join("")}
      </div>`;
    }

    const maxReg = Math.max(...s.regions.map((r) => Math.abs(r.yoy)), 1);
    const regionsHtml = s.regions.length ? `<ul class="bars">${s.regions.map((r) => {
      const w = Math.max(2, Math.abs(r.yoy) / maxReg * 100);
      return `<li><span>${esc(r.name)} <span class="muted">${fmt(r.value)}억</span></span><span class="track"><span class="fill" style="width:${w}%;background:${r.yoy >= 0 ? css("--up") : css("--down")}"></span></span><span class="v">${pct(r.yoy)}</span></li>`;
    }).join("")}</ul><p class="caption">${L.regionBasis}</p>` : "";

    $("#sectorPanel").innerHTML = `
      <p class="sector__lead">${esc(s.lead)}</p>
      ${alignmentCard(s.id)}
      <div class="sector__grid">
        <div class="sector__col">
          <div class="panel"><h3>${L.tradeMonth} 수출 <span class="muted">월별 추이 ${L.monthRange}</span></h3><div class="exports">${exportsHtml}</div></div>
          ${breakdownHtml ? `<div class="panel"><h3>세부 품목</h3>${breakdownHtml}</div>` : ""}
          <div class="panel"><h3>주요 내용</h3><ul class="points">${s.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
            ${s.workday ? `<p class="workday-note"><b>조업일수</b> ${esc(s.workday)}</p>` : ""}</div>
        </div>
        <div class="sector__col">
          <div class="panel"><h3>${L.industryMonth} 생산·출하·재고 <span class="muted">산업활동동향, %</span></h3>${industryHtml}${indexChart}</div>
          ${decompRows.length ? `<div class="panel"><h3>가격·물량 분해 <span class="muted">전년동월비</span></h3>${decompCompact(decompRows)}</div>` : ""}
          ${pricesHtml}
          ${regionsHtml ? `<div class="panel"><h3>주요 지역</h3>${regionsHtml}</div>` : ""}
        </div>
      </div>`;

    // charts
    s.exports.forEach((e, i) => {
      makeChart(`sc-exp-${i}`, {
        type: "bar",
        data: { labels: R.months, datasets: [{ data: e.monthly.map((v) => v / 100), backgroundColor: e.monthly.map((_, j) => j === 12 ? color : color + "66"), borderRadius: 2 }] },
        options: baseOptions({ plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(c.parsed.y)}억 달러` } } },
          scales: { x: { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } }, y: { display: false, beginAtZero: true } } })
      });
    });
    if (s.id === "semi" || s.id === "auto") {
      const I = R.industry;
      const idx = s.id === "semi" ? I.semiIndex : I.autoIndex;
      const ex = s.id === "semi" ? I.semiExportYoy : I.autoExportYoy;
      makeChart("sc-index", {
        data: { labels: I.indexLabels, datasets: [
          { type: "bar", label: "생산지수", data: idx, backgroundColor: color + "88", yAxisID: "y", borderRadius: 2 },
          { type: "line", label: "수출 증감률(%)", data: ex, borderColor: css("--up"), backgroundColor: css("--up"), yAxisID: "y1", pointRadius: 2, tension: 0 }
        ] },
        options: baseOptions({ scales: {
          x: { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } },
          y: { position: "left", grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 } } },
          y1: { position: "right", grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 }, callback: (v) => v + "%" } }
        } })
      });
    }
    chartKeys.forEach((k) => priceChart(`sc-price-${k}`, R.prices[k], color));
  }

  function priceChart(id, p, color) {
    const datasets = p.multi
      ? p.multi.map((m, i) => ({ label: m.name, data: m.values, borderColor: [css("--up"), css("--down"), css("--muted")][i], backgroundColor: [css("--up"), css("--down"), css("--muted")][i], pointRadius: 3, tension: 0 }))
      : [{ label: p.title, data: p.values, borderColor: color || css("--ink"), backgroundColor: color || css("--ink"), pointRadius: 3, tension: 0 }];
    makeChart(id, {
      type: "line",
      data: { labels: p.labels, datasets },
      options: baseOptions({ plugins: { legend: { display: !!p.multi, labels: { color: css("--muted"), boxWidth: 8, font: { size: 10 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${fmt(c.parsed.y, c.parsed.y > 1000 ? 0 : 1)} ${p.unit}` } } },
        scales: { x: { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } }, y: { grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 } } } } })
    });
  }


  /* ---------- 가격·물량 분해 ---------- */
  // (1+금액) = (1+가격)(1+물량). 로그로 나눠 금액 증가율을 가격 기여(%p)와 물량 기여(%p)로 분해합니다.
  function decompose(r) {
    let v = r.value, p = r.price, q = r.volume, filled = null;
    if (p == null && q != null) { p = ((1 + v / 100) / (1 + q / 100) - 1) * 100; filled = "price"; }
    if (q == null && p != null) { q = ((1 + v / 100) / (1 + p / 100) - 1) * 100; filled = "volume"; }
    const lv = Math.log(1 + v / 100), lp = Math.log(1 + p / 100), lq = Math.log(1 + q / 100);
    let cp, cq;
    if (Math.abs(lv) < 1e-6) { cp = lp * 100; cq = lq * 100; } else { cp = v * lp / lv; cq = v * lq / lv; }
    return { v, p, q, cp, cq, filled };
  }
  function decompReading(d) {
    const { v, cp, cq } = d;
    if (cp >= 0 && cq >= 0) return `금액 증가의 ${fmt(cp / v * 100, 0)}%가 가격, ${fmt(cq / v * 100, 0)}%가 물량`;
    if (cp > 0 && cq < 0) return v >= 0 ? `물량 감소(${signed(cq)}%p)를 가격(${signed(cp)}%p)이 메우고 남아 금액 증가` : `가격 상승(${signed(cp)}%p)보다 물량 감소(${signed(cq)}%p)가 커 금액 감소`;
    if (cp < 0 && cq > 0) return v >= 0 ? `단가 하락(${signed(cp)}%p)을 물량 증가(${signed(cq)}%p)가 메움` : `물량은 늘었지만 단가 하락이 더 커 금액 감소`;
    return "가격과 물량이 모두 감소";
  }
  // 막대 축척: 가장 큰 값 기준, 단 100%p를 넘으면 100%p에서 자르고 표시
  function barScale(ds) {
    const m = Math.max(...ds.map((d) => Math.max(Math.max(d.cp, 0) + Math.max(d.cq, 0), Math.max(-d.cp, 0) + Math.max(-d.cq, 0), Math.abs(d.v))), 1);
    return Math.min(m, 100);
  }
  function contribBar(d, scale) {
    let pos = 0, neg = 0, html = "";
    [[d.cp, css("--mark")], [d.cq, css("--down")]].forEach(([val, c]) => {
      const w = (from, len) => Math.max(0, Math.min(len, scale - from)) / scale * 50;
      if (val >= 0) { html += `<span class="cb__seg" style="left:${50 + Math.min(pos, scale) / scale * 50}%;width:${w(pos, val)}%;background:${c}"></span>`; pos += val; }
      else { html += `<span class="cb__seg" style="right:${50 + Math.min(neg, scale) / scale * 50}%;width:${w(neg, -val)}%;background:${c}"></span>`; neg += -val; }
    });
    const clip = Math.abs(d.v) > scale || pos > scale || neg > scale;
    const tv = Math.max(-scale, Math.min(scale, d.v));
    const tick = `<span class="cb__tick" style="left:${50 + tv / scale * 50}%" title="금액 ${signed(d.v)}%"></span>${clip ? '<span class="cb__clip" title="막대가 길어 잘림">≫</span>' : ""}`;
    return `<span class="cb" role="img" aria-label="가격 기여 ${signed(d.cp)}%p, 물량 기여 ${signed(d.cq)}%p, 금액 ${signed(d.v)}%"><span class="cb__zero"></span>${html}${tick}</span>`;
  }
  function decompTable(rows) {
    const ds = rows.map((r) => ({ r, d: decompose(r) }));
    const scale = barScale(ds.map(({ d }) => d));
    return `<div class="table-scroll"><table class="table decomp">
      <thead><tr><th scope="col">항목</th><th scope="col" class="num">금액</th><th scope="col" class="num">단가</th><th scope="col" class="num">물량</th><th scope="col" class="num">가격 기여</th><th scope="col" class="num">물량 기여</th><th scope="col" class="cb-col">기여도 <span class="muted">(<i class="sw" style="background:var(--mark)"></i>가격 <i class="sw" style="background:var(--down)"></i>물량 <i class="sw sw--tick"></i>금액)</span></th></tr></thead>
      <tbody>${ds.map(({ r, d }) => `<tr>
        <th scope="row">${esc(r.name)} <span class="muted">${r.month}</span></th>
        <td class="num">${pct(d.v)}</td>
        <td class="num">${pct(d.p)}${d.filled === "price" ? '<br><span class="muted">역산</span>' : ""}</td>
        <td class="num">${pct(d.q)}${d.filled === "volume" ? '<br><span class="muted">역산</span>' : ""}${r.proxy ? '<br><span class="muted">생산지수</span>' : ""}</td>
        <td class="num">${signed(d.cp)}%p</td>
        <td class="num">${signed(d.cq)}%p</td>
        <td class="cb-col">${contribBar(d, scale)}<div class="note">${decompReading(d)}${r.basis ? `. ${esc(r.basis)}` : ""}</div></td>
      </tr>`).join("")}</tbody></table></div>`;
  }

  function decompCompact(rows) {
    const ds = rows.map((r) => ({ r, d: decompose(r) }));
    const scale = barScale(ds.map(({ d }) => d));
    return `<ul class="dc">${ds.map(({ r, d }) => `<li>
      <div class="dc__name"><b>${esc(r.name)}</b> <span class="muted">${r.month}</span></div>
      <div class="dc__eq">금액 ${pct(d.v)} = 가격 <b style="color:var(--mark)">${signed(d.cp)}%p</b> + 물량 <b class="${cls(d.cq)}">${signed(d.cq)}%p</b></div>
      ${contribBar(d, scale)}
      <div class="dc__note">단가 ${signed(d.p)}%${d.filled === "price" ? "(역산)" : ""}, 물량 ${signed(d.q)}%${d.filled === "volume" ? "(역산)" : ""}${r.proxy ? "(생산지수)" : ""}. ${decompReading(d)}</div>
    </li>`).join("")}</ul>
    <p class="caption"><i class="sw" style="background:var(--mark)"></i>가격 기여 <i class="sw" style="background:var(--down)"></i>물량 기여 <i class="sw sw--tick"></i>금액 증가율</p>`;
  }

  /* ---------- 흐름 점검 ---------- */
  // 조업일수 환산: 전년 동월 조업일 ÷ 올해 조업일
  const wdFactor = (X) => X.workdays.prev / X.workdays.curr;
  const CATS = [
    ["export", "수출", "일평균 환산"], ["price", "가격·단가", ""], ["volume", "물량·생산", ""],
    ["ship", "출하·판매", ""], ["stock", "재고 부담", "재고−출하"], ["invest", "투자·수주", ""]
  ];
  const adjExport = (v, X = R) => ((1 + v / 100) * wdFactor(X) - 1) * 100;
  function tone(cat, v) {
    if (v == null) return null;
    const x = cat === "stock" ? -v : v;
    return Math.abs(x) < 2 ? 0 : x > 0 ? 1 : -1;
  }
  function judge(id, X = R) {
    const A = X.alignment && X.alignment[id];
    if (!A) return null;
    const first = {};
    A.signals.forEach((s) => { if (!s.ref && !first[s.cat]) first[s.cat] = s; });
    const cells = {};
    CATS.forEach(([c]) => {
      const s = first[c];
      if (!s) return;
      const val = c === "export" ? adjExport(s.value, X) : s.value;
      cells[c] = { s, val, t: tone(c, val) };
    });
    const e = cells.export ? cells.export.t : 0;
    const others = CATS.map(([c]) => c).filter((c) => c !== "export" && cells[c] && cells[c].t !== 0);
    const agree = others.filter((c) => cells[c].t === e).length;
    let kind, status;
    if (A.statusOverride) { kind = "diverge"; status = A.statusOverride; }
    else if (!e || others.length < 2) { kind = "hold"; status = "판단 유보"; }
    else if (agree === others.length) { kind = "same"; status = "같은 방향"; }
    else if (agree / others.length >= 0.6) { kind = "mostly"; status = "대체로 같은 방향"; }
    else { kind = "diverge"; status = "엇갈림"; }
    const flags = [];
    if (cells.price && cells.volume && cells.price.t > 0 && cells.volume.t <= 0) flags.push("가격 주도");
    if (A.signals.some((s) => s.cat === "stock" && !s.ref && tone("stock", s.value) < 0)) flags.push("재고 부담");
    if (cells.export && tone("export", cells.export.s.value) !== cells.export.t) flags.push("조업일수 효과");
    if (X.alignment[id].note) flags.push(X.alignment[id].note);
    return { kind, status, flags, cells, e, agree, n: others.length, A };
  }
  function cellText(c, x) {
    if (c === "stock") return x.val > 0 ? `재고가 ${fmt(x.val)}%p 빠름` : x.val < 0 ? `출하가 ${fmt(-x.val)}%p 빠름` : "같은 속도";
    return `${signed(x.val)}%`;
  }
  function renderFlow() {
    const head = `<thead><tr><th scope="col">분야</th>${CATS.map(([, n, sub]) => `<th scope="col">${n}${sub ? `<br><span class="muted">${sub}</span>` : ""}</th>`).join("")}<th scope="col">판정</th></tr></thead>`;
    const body = R.sectors.map((sec) => {
      const j = judge(sec.id);
      if (!j) return "";
      const tds = CATS.map(([c]) => {
        const x = j.cells[c];
        if (!x) return `<td class="fc fc--na"><span>자료 없음</span></td>`;
        const t = x.t;
        const opp = c !== "export" && j.e && t && t !== j.e;
        const sym = t > 0 ? "▲" : t < 0 ? "▼" : "■";
        return `<td class="fc ${t > 0 ? "fc--pos" : t < 0 ? "fc--neg" : "fc--flat"}${opp ? " fc--opp" : ""}" title="${esc(x.s.label)} (${x.s.month})${x.s.note ? " · " + esc(x.s.note) : ""}">
          <b>${sym} ${cellText(c, x)}</b><span>${esc(x.s.label)} ${x.s.month}${c === "export" ? `<br>원래 ${signed(x.s.value)}%` : ""}</span></td>`;
      }).join("");
      return `<tr data-id="${sec.id}"><th scope="row"><button type="button" class="linkish" data-id="${sec.id}">${esc(sec.name)}</button></th>${tds}
        <td><span class="badge badge--${j.kind}">${j.status}</span>${j.flags.map((f) => `<span class="flag">${f}</span>`).join("")}</td></tr>`;
    }).join("");
    $("#flowTable").innerHTML = head + `<tbody>${body}</tbody>`;
    $("#flowTable").querySelectorAll("button[data-id]").forEach((b) => b.addEventListener("click", () => { selectSector(b.dataset.id); $("#sectors").scrollIntoView(); }));

    const counts = { same: [], mostly: [], diverge: [], hold: [] };
    R.sectors.forEach((s) => { const j = judge(s.id); if (j) counts[j.kind].push(s.name); });
    const priceLed = R.sectors.filter((s) => { const j = judge(s.id); return j && j.flags.includes("가격 주도"); }).map((s) => s.name);
    const stock = R.sectors.filter((s) => { const j = judge(s.id); return j && j.flags.includes("재고 부담"); }).map((s) => s.name);
    $("#flowSummary").innerHTML = `
      <div><dt>같은 방향</dt><dd>${counts.same.join(", ") || "없음"}</dd></div>
      <div><dt>대체로 같은 방향</dt><dd>${counts.mostly.join(", ") || "없음"}</dd></div>
      <div><dt>엇갈림</dt><dd>${counts.diverge.join(", ") || "없음"}</dd></div>
      <div><dt>가격 주도 (단가↑, 물량 정체·감소)</dt><dd>${priceLed.join(", ") || "없음"}</dd></div>
      <div><dt>재고 부담 (재고가 출하보다 2%p 넘게 빨리 증가)</dt><dd>${stock.join(", ") || "없음"}</dd></div>`;
  }
  function alignmentCard(id) {
    const j = judge(id);
    if (!j) return "";
    const list = j.A.signals.map((s) => {
      const t = s.ref ? null : tone(s.cat, s.cat === "export" ? adjExport(s.value) : s.value);
      const catName = CATS.find(([c]) => c === s.cat)[1];
      const val = s.cat === "stock" ? (s.value > 0 ? `재고가 ${fmt(s.value)}%p 빠름` : `출하가 ${fmt(-s.value)}%p 빠름`) :
        s.cat === "export" ? `<span class="${cls(s.value)}">${signed(s.value)}%</span> <span class="muted">(일평균 <span class="${cls(adjExport(s.value))}">${signed(adjExport(s.value))}%</span>)</span>` : `${signed(s.value)}%`;
      return `<li class="sig ${s.cat === "export" ? "sig--export " : ""}${s.ref ? "sig--ref" : t > 0 ? "sig--pos" : t < 0 ? "sig--neg" : "sig--flat"}">
        <span class="sig__dot" aria-hidden="true"></span>
        <span class="sig__cat">${catName}</span>
        <span class="sig__label">${esc(s.label)} <span class="muted">${s.month}</span>${s.note ? `<small>${esc(s.note)}</small>` : ""}</span>
        <span class="sig__val">${val}${s.ref ? ' <span class="muted">참고</span>' : ""}</span></li>`;
    }).join("");
    return `<div class="panel flowcard">
      <div class="flowcard__head"><h3>흐름 점검</h3><span class="badge badge--${j.kind}">${j.status}</span>${j.flags.map((f) => `<span class="flag">${f}</span>`).join("")}
        <span class="muted flowcard__count">${j.n ? `수출과 같은 방향 ${j.agree}/${j.n}개 신호` : ""}</span></div>
      <p class="flowcard__verdict">${esc(j.A.verdict)}</p>
      <ul class="sigs">${list}</ul>
      <p class="workday-note"><b>확인할 점</b> ${esc(j.A.watch)}</p>
    </div>`;
  }

  /* ---------- 조업일수 ---------- */
  function workdayCount(y, m) {
    const hol = R.holidays[`${y}-${String(m).padStart(2, "0")}`] || [];
    const last = new Date(y, m, 0).getDate();
    let total = 0;
    const days = [];
    for (let d = 1; d <= last; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      const isHol = hol.includes(d);
      let w = dow === 0 ? 0 : dow === 6 ? 0.5 : 1;
      if (isHol) w = 0;
      total += w;
      days.push({ d, dow, w, isHol });
    }
    return { total, days };
  }
  function calendarHtml(y, m) {
    const { total, days } = workdayCount(y, m);
    const first = days[0].dow;
    const dows = ["일", "월", "화", "수", "목", "금", "토"];
    let cells = dows.map((d) => `<div class="cal__dow">${d}</div>`).join("");
    for (let i = 0; i < first; i++) cells += `<div class="cal__d pad"></div>`;
    days.forEach((x) => {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
      const name = R.holidayNames[key];
      let c = "off";
      if (x.isHol) c = "hol"; else if (x.w === 1) c = "full"; else if (x.w === 0.5) c = "half";
      const label = `${m}월 ${x.d}일 ${dows[x.dow]}요일${name ? ", " + name : ""}, 조업일 ${x.w}`;
      cells += `<div class="cal__d ${c}" title="${label}" aria-label="${label}"><span>${x.d}</span></div>`;
    });
    return `<div class="cal"><h4><span>${y}년 ${m}월</span><b>${fmt(total)}일</b></h4><div class="cal__grid" role="img" aria-label="${y}년 ${m}월 조업일수 ${total}일">${cells}</div></div>`;
  }
  function renderWorkdays() {
    const W = R.workdays, y = W.year, m = W.month, im = m - 1;
    const box = $("#calendars");
    box.innerHTML = calendarHtml(y - 1, m) + calendarHtml(y, m) + calendarHtml(y - 1, im) + calendarHtml(y, im) +
      `<div class="cal__legend" style="grid-column:1/-1"><span><i style="background:var(--ink)"></i>평일 1일</span><span><i style="background:var(--rule)"></i>토요일 0.5일</span><span><i style="background:var(--mark-bg);outline:1px solid var(--mark)"></i>공휴일 0일</span><span><i style="background:transparent;outline:1px solid var(--rule)"></i>일요일 0일</span><span>위 두 달력은 수출 기준월(${m}월), 아래 두 달력은 산업활동 기준월(${im}월)</span></div>`;

    const t = R.trade;
    const days = t.exportMonthly.map((v, i) => v / t.exportDaily[i]);
    const impDays = t.importMonthly.map((v, i) => v / t.importDaily[i]);
    const round = (x) => Math.round(x * 2) / 2;
    const rowsHtml = R.months.map((mo, i) => `<tr class="${i === 12 || i === 0 ? "is-hl" : ""}"><th scope="row">${mo}</th><td class="num">${fmt(t.exportMonthly[i])}</td><td class="num">${fmt(t.exportDaily[i])}</td><td class="num"><b>${fmt(round(days[i]))}</b></td><td class="num">${fmt(round(impDays[i]))}</td></tr>`).join("");
    $("#workdayTable").innerHTML = `<thead><tr><th scope="col">월</th><th scope="col" class="num">수출(억$)</th><th scope="col" class="num">일평균</th><th scope="col" class="num">조업일수</th><th scope="col" class="num">수입 기준</th></tr></thead><tbody>${rowsHtml}</tbody>`;

    makeChart("workdayChart", {
      data: { labels: R.months, datasets: [
        { type: "bar", label: "조업일수(일)", data: days.map(round), backgroundColor: days.map((_, i) => i === 12 ? css("--mark") : css("--rule")), yAxisID: "y", borderRadius: 2 },
        { type: "line", label: "일평균 수출(억$)", data: t.exportDaily, borderColor: css("--up"), backgroundColor: css("--up"), yAxisID: "y1", pointRadius: 2, tension: 0 }
      ] },
      options: baseOptions({ scales: {
        x: { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } },
        y: { min: 15, max: 26, grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 } } },
        y1: { position: "right", grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } }
      } })
    });

    const ip = workdayCount(y - 1, im).total, ic = workdayCount(y, im).total;
    const prevDaily = W.industryPrevYearExport / ip;
    const indDailyYoy = (t.exportDaily[11] / prevDaily - 1) * 100;
    const fs = R.sectors.find((s) => s.id === W.featureSector);
    const fe = fs.exports[0];
    $("#workdayCompare").innerHTML = `
      <div><dt>${m}월 조업일수</dt><dd>${fmt(W.prev)} → ${fmt(W.curr)}일<small>${signed(W.curr - W.prev)}일, ${esc(W.reason)}</small></dd></div>
      <div><dt>${m}월 수출: 총액 vs 일평균</dt><dd>${pct(t.export.yoy)} / ${pct(t.export.dailyYoy)}<small>${W.curr < W.prev ? "조업일 감소분을 빼면 증가 폭이 더 큽니다" : "조업일 증가분을 빼면 증가 폭이 더 작습니다"}</small></dd></div>
      <div><dt>${m}월 ${esc(fe.name)}: 총액 vs 일평균</dt><dd>${pct(fe.yoy)} / ${pct(adjExport(fe.yoy))}<small>조업일수 환산</small></dd></div>
      <div><dt>${im}월 조업일수 (산업활동 기준월)</dt><dd>${fmt(ip)} → ${fmt(ic)}일<small>일평균 수출 ${fmt(prevDaily)} → ${fmt(t.exportDaily[11])}억 달러(${signed(indDailyYoy)}%, 추정)</small></dd></div>`;
  }

  /* ---------- 가격 ---------- */
  function renderPrices() {
    const t = R.trade;
    const monthly = t.exportYoy.map((v, i) => decompose({ value: v, volume: t.exportVolumeYoy[i] }));
    makeChart("valueVolumeChart", {
      data: { labels: R.months, datasets: [
        { type: "bar", label: "가격 기여(%p)", data: monthly.map((d) => +d.cp.toFixed(1)), backgroundColor: css("--mark"), stack: "c", borderRadius: 1, order: 2 },
        { type: "bar", label: "물량 기여(%p)", data: monthly.map((d) => +d.cq.toFixed(1)), backgroundColor: css("--down"), stack: "c", borderRadius: 1, order: 2 },
        { type: "line", label: "금액 증가율(%)", data: t.exportYoy, borderColor: css("--ink"), backgroundColor: css("--ink"), pointRadius: 2, tension: 0, order: 1 }
      ] },
      options: baseOptions({
        plugins: { legend: { labels: { color: css("--muted"), boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: {
          label: (c) => `${c.dataset.label} ${signed(c.parsed.y)}`,
          footer: (items) => { const d = monthly[items[0].dataIndex]; return d.cp > 0 && d.cq > 0 ? `가격 몫 ${fmt(d.cp / d.v * 100, 0)}%` : decompReading(d); }
        } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } }, y: { stacked: true, grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 } } } }
      })
    });
    const sep = monthly[12];
    const ytdStart = Math.max(0, R.months.findIndex((m) => m.startsWith("’26.1")));
    const ytd = monthly.slice(ytdStart);
    const avgCp = ytd.reduce((a, d) => a + d.cp, 0) / ytd.length, avgCq = ytd.reduce((a, d) => a + d.cq, 0) / ytd.length;
    const volNeg = ytd.filter((d) => d.cq < 0).length;
    $("#valueVolumeCaption").textContent = `${L.tradeMonth} 금액 증가율 ${signed(sep.v)}%는 가격 ${signed(sep.cp)}%p, 물량 ${signed(sep.cq)}%p로 나뉩니다(${decompReading(sep)}). 올해 ${L.ytd} 월평균으로는 가격 ${signed(avgCp)}%p, 물량 ${signed(avgCq)}%p로 증가분이 사실상 모두 가격에서 나왔고, ${ytd.length}개월 중 ${volNeg}개월은 물량이 오히려 줄었습니다.`;

    const I = R.industry;
    makeChart("semiGapChart", {
      type: "line",
      data: { labels: I.indexLabels, datasets: [
        { label: "반도체 수출액", data: I.semiExportYoy, borderColor: css("--up"), backgroundColor: css("--up"), pointRadius: 3, tension: 0 },
        { label: "반도체 생산지수", data: I.semiIndexYoy, borderColor: css("--down"), backgroundColor: css("--down"), pointRadius: 3, tension: 0 }
      ] },
      options: baseOptions({ plugins: { legend: { labels: { color: css("--muted"), boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${signed(c.parsed.y)}%` } } } })
    });

    $("#unitTable").innerHTML = decompTable(R.decomposition);

    const order = [["memory", "메모리 고정가격", "달러"], ["ddr4"], ["dubai"], ["products"], ["lithium"], ["nickel"]];
    const grid = $("#priceCharts");
    grid.innerHTML = order.map(([k, title, unit]) => {
      const p = R.prices[k];
      const t2 = p ? p.title : title, u = p ? p.unit : unit;
      const d5 = R.prices.ddr5, nd = R.prices.nand;
      const note = k === "memory" ? `DDR5 16Gb ${fmt(d5.values[0])} → ${fmt(d5.values[d5.values.length - 1])}, NAND 128Gb ${fmt(nd.values[0])} → ${fmt(nd.values[nd.values.length - 1])} (${d5.labels[0]}~${d5.labels[d5.labels.length - 1]}월)` : p.note || "";
      return `<article class="panel"><h3>${t2} <span class="muted">${u}</span></h3><div class="chart chart--sm"><canvas id="pc-${k}"></canvas></div>${note ? `<p class="caption">${note}</p>` : ""}</article>`;
    }).join("");
    priceChart("pc-memory", { labels: R.prices.ddr5.labels, unit: "달러", multi: [{ name: "DDR5 16Gb", values: R.prices.ddr5.values }, { name: "NAND 128Gb", values: R.prices.nand.values }] });
    ["ddr4", "dubai", "products", "lithium", "nickel"].forEach((k) => priceChart(`pc-${k}`, R.prices[k], css("--ink")));

    makeChart("fxChart", {
      data: { labels: R.months, datasets: [
        { type: "line", label: "원/달러 환율", data: t.fx, borderColor: css("--ink"), backgroundColor: css("--ink"), yAxisID: "y", pointRadius: 2, tension: 0 },
        { type: "bar", label: "원화 수출(조 원)", data: t.exportKrw, backgroundColor: css("--rule"), yAxisID: "y1", borderRadius: 2 }
      ] },
      options: baseOptions({ scales: {
        x: { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 10 } } },
        y: { grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 } } },
        y1: { position: "right", grid: { display: false }, beginAtZero: true, ticks: { color: css("--muted"), font: { size: 10 } } }
      } })
    });
  }

  /* ---------- 지역 ---------- */
  function renderRegions() {
    const regs = R.trade.regions;
    makeChart("regionChart", {
      type: "bar",
      data: { labels: regs.map((r) => r.name), datasets: [{ data: regs.map((r) => r.yoy), backgroundColor: regs.map((r) => r.yoy >= 0 ? css("--up") : css("--down")), borderRadius: 2 }] },
      options: baseOptions({ indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${signed(c.parsed.x)}%` } } },
        scales: { x: { grid: { color: css("--rule") }, ticks: { color: css("--muted"), font: { size: 10 }, callback: (v) => v + "%" } }, y: { grid: { display: false }, ticks: { color: css("--ink"), font: { size: 11 } } } } })
    });
    $("#regionTable").innerHTML = `<thead><tr><th scope="col">지역</th><th scope="col" class="num">수출액</th><th scope="col" class="num">증감률</th><th scope="col" class="num">무역수지</th></tr></thead><tbody>` +
      regs.map((r) => `<tr><th scope="row">${r.name}</th><td class="num">${fmt(r.value)}</td><td class="num">${pct(r.yoy)}</td><td class="num ${cls(r.balance)}">${signed(r.balance, 0)}</td></tr>`).join("") +
      `<tr><th scope="row">전체</th><td class="num"><b>${fmt(R.trade.export.value)}</b></td><td class="num">${pct(R.trade.export.yoy)}</td><td class="num up">+${fmt(R.trade.balance.value)}</td></tr></tbody>`;
  }


  /* ---------- 지난 보도자료 대비 점검 ---------- */
  const STATUS = { "해소": "ok", "부분": "part", "지속": "same", "악화": "bad" };
  const KIND_RANK = { diverge: 0, hold: 1, mostly: 2, same: 3 };
  const toneCls = (t) => t > 0 ? "up" : t < 0 ? "down" : "flat";
  function valTxt(c, x) {
    return c === "stock" ? `<span class="${toneCls(x.t)}">${signed(x.val)}%p</span>` : `<span class="${toneCls(x.t)}">${signed(x.val)}%</span>`;
  }
  const badgeHtml = (j) => `<span class="badge badge--${j.kind}">${j.status}</span>`;

  function renderFollowup() {
    if (!PREV || !R.followups) {
      $("#followup").hidden = true;
      document.querySelectorAll('a[href="#followup"]').forEach((a) => { a.hidden = true; });
      return;
    }
    $("#followupIntro").textContent = `지난 기준(${PREV.label})에서 남긴 확인 항목과 흐름 판정이 이번 자료(${R.label})에서 어떻게 나왔는지 정리했습니다.`;

    // 1. 지난 체크리스트 결과
    const prevItems = Object.fromEntries((PREV.checklist || []).map((c) => [c.id, c]));
    const counts = {};
    R.followups.forEach((f) => { counts[f.status] = (counts[f.status] || 0) + 1; });
    $("#followupCounts").innerHTML = Object.keys(STATUS).map((k) => `<div><dt><span class="st st--${STATUS[k]}">${k}</span></dt><dd>${counts[k] || 0}개</dd></div>`).join("");
    $("#followupList").innerHTML = R.followups.map((f) => {
      const c = prevItems[f.prevId] || {};
      const sec = R.sectors.find((x) => x.id === c.sector);
      return `<li class="fu">
        <span class="st st--${STATUS[f.status]}">${f.status}</span>
        <div class="fu__body">
          <p class="fu__title">${sec ? `<span class="chip">${esc(sec.name)}</span>` : ""}${esc(c.title || f.prevId)}</p>
          <dl class="fu__dl">
            <div><dt>지난 수치</dt><dd>${esc(c.now || "–")}</dd></div>
            <div><dt>판단 기준</dt><dd>${esc(c.rule || "–")}</dd></div>
            <div><dt>이번 결과</dt><dd>${esc(f.evidence)}</dd></div>
          </dl>
        </div>
      </li>`;
    }).join("");

    // 2. 흐름 판정 변화
    const head = `<thead><tr><th scope="col">분야</th><th scope="col">지난 판정<br><span class="muted">${esc(PREV.labels.industryMonth)} 산업 · ${esc(PREV.labels.tradeMonth)} 수출</span></th><th scope="col">이번 판정<br><span class="muted">${esc(L.industryMonth)} 산업 · ${esc(L.tradeMonth)} 수출</span></th><th scope="col">변화</th>
      <th scope="col" class="num">수출(일평균)</th><th scope="col" class="num">물량·생산</th><th scope="col" class="num">출하·판매</th><th scope="col" class="num">재고−출하</th></tr></thead>`;
    const body = R.sectors.map((s) => {
      const a = judge(s.id, PREV), b = judge(s.id, R);
      if (!a || !b) return "";
      const d = KIND_RANK[b.kind] - KIND_RANK[a.kind];
      const change = d > 0 ? "개선" : d < 0 ? "약화" : "유지";
      const added = b.flags.filter((f) => !a.flags.includes(f)).map((f) => `<span class="flag">+ ${f}</span>`);
      const removed = a.flags.filter((f) => !b.flags.includes(f)).map((f) => `<span class="flag flag--off">− ${f}</span>`);
      const cell = (c) => {
        const x = a.cells[c], y = b.cells[c];
        if (!x && !y) return `<td class="num muted">–</td>`;
        return `<td class="num">${x ? valTxt(c, x) : "–"} <span class="muted">→</span> ${y ? valTxt(c, y) : "–"}</td>`;
      };
      return `<tr><th scope="row"><button type="button" class="linkish" data-id="${s.id}">${esc(s.name)}</button></th>
        <td>${badgeHtml(a)}</td><td>${badgeHtml(b)}</td>
        <td><span class="chg-label chg-label--${d > 0 ? "up" : d < 0 ? "down" : "same"}">${change}</span>${added.join("")}${removed.join("")}</td>
        ${["export", "volume", "ship", "stock"].map(cell).join("")}</tr>`;
    }).join("");
    $("#transitionTable").innerHTML = head + `<tbody>${body}</tbody>`;
    $("#transitionTable").querySelectorAll("button[data-id]").forEach((b) => b.addEventListener("click", () => { selectSector(b.dataset.id); $("#sectors").scrollIntoView(); }));

    // 3. 가격·물량 기여 변화
    const prevMap = Object.fromEntries((PREV.decomposition || []).map((r) => [r.key, r]));
    const pairs = R.decomposition.filter((r) => prevMap[r.key]).map((r) => ({ r, a: decompose(prevMap[r.key]), b: decompose(r), pr: prevMap[r.key] }));
    const scale = barScale(pairs.flatMap((p) => [p.a, p.b]));
    const readChange = (a, b) => {
      const out = [];
      if (Math.sign(a.cq) !== Math.sign(b.cq)) out.push(b.cq >= 0 ? "물량 기여가 플러스로 전환" : "물량 기여가 마이너스로 전환");
      else if (Math.abs(b.cq - a.cq) >= 3) {
        const word = b.cq < 0 ? (b.cq > a.cq ? "물량 감소 폭 축소" : "물량 감소 폭 확대") : (b.cq > a.cq ? "물량 기여 확대" : "물량 기여 축소");
        out.push(`${word}(${signed(a.cq)} → ${signed(b.cq)}%p)`);
      }
      const clean = (d) => d.cp >= 0 && d.cq >= 0 && d.v > 0;
      if (clean(a) && clean(b)) out.push(`가격 몫 ${fmt(a.cp / a.v * 100, 0)}% → ${fmt(b.cp / b.v * 100, 0)}%`);
      else if (Math.abs(b.cp - a.cp) >= 3) out.push(`가격 기여 ${signed(a.cp)} → ${signed(b.cp)}%p`);
      if (b.cq < 0 && b.v > 0) out.push("금액 증가는 모두 가격");
      return out.join(", ") || "구조 유지";
    };

    $("#decompChange").innerHTML = `<div class="table-scroll"><table class="table decomp">
      <thead><tr><th scope="col">항목</th><th scope="col" class="num">지난<br><span class="muted">금액 / 가격 / 물량</span></th><th scope="col" class="num">이번<br><span class="muted">금액 / 가격 / 물량</span></th><th scope="col" class="cb-col">기여도 (위: 지난, 아래: 이번)</th><th scope="col">변화</th></tr></thead>
      <tbody>${pairs.map(({ r, a, b, pr }) => `<tr>
        <th scope="row">${esc(r.name)}</th>
        <td class="num">${pr.month} ${pct(a.v)}<br><span class="muted">${signed(a.cp)} / ${signed(a.cq)}%p</span></td>
        <td class="num">${r.month} ${pct(b.v)}<br><span class="muted">${signed(b.cp)} / ${signed(b.cq)}%p</span></td>
        <td class="cb-col"><div class="cb-pair">${contribBar(a, scale)}${contribBar(b, scale)}</div></td>
        <td class="note">${readChange(a, b)}</td></tr>`).join("")}</tbody></table></div>
      <p class="caption"><i class="sw" style="background:var(--mark)"></i>가격 기여 <i class="sw" style="background:var(--down)"></i>물량 기여 <i class="sw sw--tick"></i>금액 증가율. 막대는 ±100%p에서 잘립니다.</p>`;

    // 4. 가격 지표 변화
    const keys = ["ddr5", "nand", "ddr4", "dubai", "lithium", "nickel"].filter((k) => PREV.prices[k] && R.prices[k] && !R.prices[k].multi);
    const last = (p) => { const l = p.labels[p.labels.length - 1]; return { v: p.values[p.values.length - 1], l: /^\d+$/.test(l) ? `${l}월` : l }; };
    const priceRows = keys.map((k) => {
      const a = last(PREV.prices[k]), b = last(R.prices[k]);
      const ch = (b.v / a.v - 1) * 100;
      return `<tr><th scope="row">${esc(R.prices[k].title)} <span class="muted">${esc(R.prices[k].unit)}</span></th><td class="num">${fmt(a.v, a.v > 1000 ? 0 : 1)} <span class="muted">${esc(a.l)}</span></td><td class="num">${fmt(b.v, b.v > 1000 ? 0 : 1)} <span class="muted">${esc(b.l)}</span></td><td class="num">${pct(ch)}</td></tr>`;
    });
    const fa = PREV.trade.fx[12], fb = R.trade.fx[12];
    priceRows.push(`<tr><th scope="row">원/달러 환율</th><td class="num">${fmt(fa)}</td><td class="num">${fmt(fb)}</td><td class="num">${pct((fb / fa - 1) * 100)}</td></tr>`);
    priceRows.push(`<tr><th scope="row">전체 수출 물량 <span class="muted">전년비</span></th><td class="num">${pct(PREV.trade.exportVolumeYoy[12])}</td><td class="num">${pct(R.trade.exportVolumeYoy[12])}</td><td class="num">${signed(R.trade.exportVolumeYoy[12] - PREV.trade.exportVolumeYoy[12])}%p</td></tr>`);
    priceRows.push(`<tr><th scope="row">전체 수입 물량 <span class="muted">전년비</span></th><td class="num">${pct(PREV.trade.importVolumeYoy[12])}</td><td class="num">${pct(R.trade.importVolumeYoy[12])}</td><td class="num">${signed(R.trade.importVolumeYoy[12] - PREV.trade.importVolumeYoy[12])}%p</td></tr>`);
    $("#priceChange").innerHTML = `<thead><tr><th scope="col">지표</th><th scope="col" class="num">지난 기준</th><th scope="col" class="num">이번 기준</th><th scope="col" class="num">변화</th></tr></thead><tbody>${priceRows.join("")}</tbody>`;

    // 5. 수정치
    if (R.revisions && R.revisions.length) {
      $("#revisionTable").innerHTML = `<thead><tr><th scope="col">항목</th><th scope="col">지난 발표</th><th scope="col">수정 후</th><th scope="col">수정한 자료</th></tr></thead><tbody>${R.revisions.map((v) => `<tr><th scope="row">${esc(v.item)}</th><td>${esc(v.before)}</td><td><b>${esc(v.after)}</b></td><td class="note">${esc(v.source)}</td></tr>`).join("")}</tbody>`;
    } else { $("#revisionPanel").hidden = true; }
  }

  /* ---------- 다음 보도자료 체크리스트 ---------- */
  function renderChecklist() {
    const nr = R.nextReleases || {};
    const nextFU = NEXT && NEXT.followups ? Object.fromEntries(NEXT.followups.map((f) => [f.prevId, f])) : {};
    $("#checklistIntro").textContent = NEXT
      ? `${R.label} 자료를 보고 남긴 확인 항목입니다. 결과는 다음 기록(${NEXT.label})에서 확인한 내용입니다.`
      : `${R.label} 자료를 바탕으로 다음 보도자료가 나오면 확인할 항목입니다. 각 항목의 판단 기준대로 결과를 보면 흐름이 이어지는지 알 수 있습니다.`;
    const groups = [["trade", nr.trade], ["industry", nr.industry], ["both", { title: "두 자료 모두", date: "" }]];
    $("#checklistGrid").innerHTML = groups.map(([g, info]) => {
      const items = (R.checklist || []).filter((c) => c.release === g);
      if (!items.length || !info) return "";
      return `<article class="panel cl"><h3>${esc(info.title)} <span class="muted">${esc(info.date)}</span></h3>
        <ul class="cl__list">${items.map((c) => {
          const sec = R.sectors.find((x) => x.id === c.sector);
          const fu = nextFU[c.id];
          return `<li>
            <p class="cl__title"><span class="cl__box" aria-hidden="true"></span>${sec ? `<span class="chip">${esc(sec.name)}</span>` : ""}${esc(c.title)}</p>
            <dl class="fu__dl">
              <div><dt>지금</dt><dd>${esc(c.now)}</dd></div>
              <div><dt>판단 기준</dt><dd>${esc(c.rule)}</dd></div>
              <div><dt>볼 곳</dt><dd>${esc(c.where)}</dd></div>
            </dl>
            ${fu ? `<p class="cl__result"><span class="st st--${STATUS[fu.status]}">${fu.status}</span> ${esc(fu.evidence)} <a href="${periodUrl(NEXT.id)}#followup">${esc(NEXT.label)}에서 보기</a></p>` : ""}
          </li>`;
        }).join("")}</ul></article>`;
    }).join("");
  }

  /* ---------- 보도자료 기록 ---------- */
  function renderArchive() {
    const rows = KEYS.slice().reverse().map((k) => {
      const X = PERIODS[k], t = X.trade;
      const semi = X.sectors.find((s) => s.id === "semi").exports[0];
      const mining = X.industry.headline.find((h) => h.name === "광공업생산");
      const util = X.industry.extra.find((e) => e.name.includes("가동률"));
      const js = X.sectors.map((s) => judge(s.id, X)).filter(Boolean);
      const nSame = js.filter((j) => j.kind === "same" || j.kind === "mostly").length;
      const nDiv = js.filter((j) => j.kind === "diverge").length;
      return `<tr class="${k === KEY ? "is-hl" : ""}">
        <th scope="row"><a href="${periodUrl(k)}">${esc(X.label)}</a>${k === KEY ? ' <span class="muted">보는 중</span>' : ""}</th>
        <td class="num">${fmt(t.export.value)}<br>${pct(t.export.yoy)}</td>
        <td class="num">${fmt(t.export.daily)}<br>${pct(t.export.dailyYoy)}</td>
        <td class="num">${fmt(X.workdays.prev)} → ${fmt(X.workdays.curr)}</td>
        <td class="num">${pct(t.exportVolumeYoy[12])}</td>
        <td class="num">${fmt(semi.cur)}<br>${pct(semi.yoy)}</td>
        <td class="num">${fmt(t.balance.value)}</td>
        <td class="num">${pct(mining.mom)} / ${pct(mining.yoy)}<br><span class="muted">${esc(X.labels.industryMonth)}</span></td>
        <td class="num">${esc(util.value)}</td>
        <td class="num">${nSame} / ${nDiv}</td>
      </tr>`;
    }).join("");
    $("#archiveTable").innerHTML = `<thead><tr><th scope="col">기준 자료</th><th scope="col" class="num">수출(억$)</th><th scope="col" class="num">일평균</th><th scope="col" class="num">조업일수</th><th scope="col" class="num">수출 물량</th><th scope="col" class="num">반도체</th><th scope="col" class="num">무역수지</th><th scope="col" class="num">광공업생산<br><span class="muted">전월비 / 전년비</span></th><th scope="col" class="num">제조업 가동률</th><th scope="col" class="num">같은 방향 / 엇갈림<br><span class="muted">분야 수</span></th></tr></thead><tbody>${rows}</tbody>`;
  }

  function renderNotes() { $("#notesList").innerHTML = R.notes.map((n) => `<li>${esc(n)}</li>`).join(""); }

  /* ---------- nav highlight ---------- */
  function navSpy() {
    if (!("IntersectionObserver" in window)) return;
    const links = [...document.querySelectorAll(".nav a")];
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${e.target.id}` ? "true" : "false"));
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    links.forEach((a) => { const s = document.querySelector(a.getAttribute("href")); if (s) io.observe(s); });
  }

  function renderAll() {
    if (window.Chart) Chart.defaults.font.family = css("--sans");
    renderMix();
    renderSummary();
    renderFlow();
    renderFollowup();
    renderChecklist();
    renderArchive();
    renderSectorTabs();
    renderSector(R.sectors.find((s) => s.id === currentSector));
    renderWorkdays();
    renderPrices();
    renderRegions();
  }

  // 시작
  const hash = location.hash.replace("#", "");
  if (R.sectors.some((s) => s.id === hash)) currentSector = hash;
  renderMeta();
  renderNotes();
  renderAll();
  navSpy();
  if (R.sectors.some((s) => s.id === hash)) $("#sectors").scrollIntoView();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
})();
