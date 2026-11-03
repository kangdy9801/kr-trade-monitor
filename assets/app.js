(function () {
  "use strict";
  const A = window.KTMAnalyze;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = A.fmt, signed = A.signed;
  const tone = (v) => v == null || isNaN(v) ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "";
  const pc = (v, d = 1, u = "%") => v == null || isNaN(v) ? '<span class="dim">—</span>' : `<span class="${tone(v)}">${signed(v, d)}${u}</span>`;

  /* ---------- 기록 ---------- */
  const LS_KEY = "ktm.records.v1";
  const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } };
  const saveLocal = (list) => { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } };
  const RECORDS = {};
  (window.KTM_SEED || []).forEach((r) => { RECORDS[r.id] = Object.assign({}, r, { source: "seed" }); });
  loadLocal().forEach((r) => { RECORDS[r.id] = Object.assign({}, r, { source: "local" }); });
  const ALL = Object.keys(RECORDS).sort();
  const PERIODS = {}, ERRORS = {};
  ALL.forEach((k, i) => {
    const pk = ALL.slice(0, i).reverse().find((x) => PERIODS[x]);
    try { PERIODS[k] = A.analyze(RECORDS[k], pk ? RECORDS[pk] : null, pk ? PERIODS[pk] : null); }
    catch (e) { ERRORS[k] = e.message; console.error(e); }
  });
  const KEYS = ALL.filter((k) => PERIODS[k]);
  const qp = new URLSearchParams(location.search).get("p");
  const KEY = KEYS.includes(qp) ? qp : KEYS[KEYS.length - 1];
  const P = KEY ? PERIODS[KEY] : null;
  const PREVP = P && KEYS.indexOf(KEY) > 0 ? PERIODS[KEYS[KEYS.indexOf(KEY) - 1]] : null;

  /* ---------- 공통 조각 ---------- */
  const tile = (t) => `<div class="tile"><p class="tile__label">${esc(t.label)}</p><p class="tile__value ${t.tone ? (t.tone === "up" ? "pos" : "neg") : tone(t.value)}">${t.text ? esc(t.text) : signed(t.value) + "%"}</p>${t.text && t.value != null ? `<p class="tile__chg">${pc(t.value)} ${esc(t.sub || "")}</p>` : `<p class="tile__sub">${esc(t.sub || "")}</p>`}</div>`;
  const table = (head, rows, cls = "") => `<div class="tbl-wrap"><table class="tbl ${cls}"><thead><tr>${head.map((h, i) => `<th scope="col"${i ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => i ? `<td class="r">${c}</td>` : `<th scope="row">${c}</th>`).join("")}</tr>`).join("")}</tbody></table></div>`;

  /* ---------- 화면 ---------- */
  function render() {
    const B = P.brief;
    document.title = `수출입·산업활동 리포트 | ${P.label}`;
    $("#lede").innerHTML = P.hero;
    $("#footSrc").textContent = `원자료: 산업통상부 「${P.meta.tradeTitle}」(${P.meta.tradeDate}), 국가데이터처 「${P.meta.industryTitle}」(${P.meta.industryDate}).`;

    // 1. 요약
    $("#summaryCards").innerHTML = [B.summary.trade, B.summary.industry].map((s) => `<article class="card card--flat"><h3 class="card__title">${esc(s.title)}</h3><p class="card__sub">${esc(s.src)}</p><ul class="bullets">${s.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></article>`).join("");

    // 2. 반도체
    if (B.semi) {
      const s = B.semi;
      $("#semiTiles").innerHTML = s.tiles.map(tile).join("");
      const ph = ["메모리 고정가격"].concat(s.price.labels.map((l) => l.replace(/^\d{2}\./, "") + (/^\d+$/.test(l.replace(/^\d{2}\./, "")) ? "월" : "")));
      const priceTbl = table(ph.map(esc), [
        ["DDR5 16Gb (달러)"].concat(s.price.ddr5.map((v) => fmt(v))),
        ["전월비", ].concat(s.price.ddr5Mom.map((v) => pc(v))),
        ["NAND 128Gb (달러)"].concat(s.price.nand.map((v) => fmt(v))),
        ["전월비"].concat(s.price.nandMom.map((v) => pc(v)))
      ], "tbl--compact");
      const indTbl = s.industry.length ? table([`${esc(P.labels.industryMonth)} 반도체`, "전월비", "전년비", s.prevIM ? `${esc(s.prevIM)} 전월비` : "", s.prevIM ? `${esc(s.prevIM)} 전년비` : ""].filter(Boolean),
        s.industry.map((r) => [r.name, pc(r.mom), `<b>${pc(r.yoy)}</b>`].concat(s.prevIM ? [pc(r.pmom), pc(r.pyoy)] : []))) : "";
      const ser = s.series ? table(["월"].concat(s.series.labels.map(esc)), [
        ["반도체 수출 (전년비)"].concat(s.series.exp.map((v) => pc(v))),
        ["반도체 생산 (전년비)"].concat(s.series.prod.map((v) => pc(v))),
        ["가격 몫 (%)"].concat(s.series.share.map((v) => v == null ? "—" : `<b>${v}</b>`))
      ], "tbl--compact") : "";
      $("#semiTables").innerHTML = `<h3 class="mini">가격 흐름</h3>${priceTbl}<h3 class="mini">물량 흐름 (생산·출하·재고)</h3>${indTbl}<h3 class="mini">수출 vs 생산, 가격 몫</h3>${ser}<p class="fine">가격 몫 = 수출 증가분 중 가격(단가)이 차지하는 비율. 100이면 물량은 늘지 않고 가격만 올랐다는 뜻이에요.</p>`;
    }

    // 3. 물량·가격
    const V = B.volPrice;
    $("#vpTiles").innerHTML = V.tiles.map(tile).join("");
    $("#vpTables").innerHTML =
      table(["품목", "수출액", "물량", "단가", "설명"], V.items.map((x) => [esc(x.name), pc(x.v), x.q == null ? '<span class="dim">—</span>' : pc(x.q), pc(x.p), `<span class="desc">${esc(x.note)}</span>`]), "tbl--items") +
      table(["월"].concat(V.months.map(esc)), [
        ["수출액"].concat(V.value.map((v) => pc(v))),
        ["물량"].concat(V.volume.map((v) => pc(v))),
        ["<b>추정 단가</b>"].concat(V.unit.map((v) => `<b>${pc(v)}</b>`))
      ], "tbl--compact");

    // 4. 20대 품목
    const I = B.items;
    $("#itemTiles").innerHTML = I.tiles.map(tile).join("");
    const chip = (label, arr, cls) => arr.length ? `<span class="chip chip--${cls}">${esc(label)}: ${esc(arr.join(", "))}</span>` : "";
    $("#itemChips").innerHTML = chip("플러스 전환", I.plusTurn, "pos") + chip("마이너스 전환", I.minusTurn, "neg") + chip("증감률 개선(+5%p 이상)", I.better, "plain") + chip("증감률 악화(−5%p 이상)", I.worse, "plain");
    $("#itemTable").innerHTML = table(["품목", `${esc(I.prevMonth)} 금액`, `${esc(I.curMonth)} 금액`, "한 달 새 변화", `${esc(I.prevMonth)} 전년비`, `${esc(I.curMonth)} 전년비`, "증감률 변화"],
      I.rows.map((r) => [esc(r.name), fmt(r.prev), `<b>${fmt(r.cur)}</b>`, pc(r.mom), pc(r.y0), `<b>${pc(r.y1)}</b>`, pc(r.dy, 1, "%p")])) + '<p class="fine">금액 단위 억 달러.</p>';

    // 5. 자동차
    if (B.auto) {
      const a = B.auto;
      $("#autoTiles").innerHTML = a.tiles.map(tile).join("");
      $("#autoText").textContent = a.text;
      const share = (d) => a.total.diff > 0 && d > 0 ? `${fmt(d / a.total.diff * 100, 0)}%` : "—";
      $("#autoTable").innerHTML = table(["차종", `${esc(P.labels.prevTradeMonth)}`, `${esc(P.labels.curTradeMonth)}`, "전년비", "증감액", "증가분 중 비중"],
        a.byType.map((r) => [esc(r.name), fmt(r.from), `<b>${fmt(r.to)}</b>`, `<b>${pc(r.yoy)}</b>`, pc(r.diff, 1, "억"), share(r.diff)])
          .concat([["<b>자동차 합계</b>", fmt(a.total.from), `<b>${fmt(a.total.to)}</b>`, `<b>${pc(a.total.yoy)}</b>`, pc(a.total.diff, 1, "억"), ""]])
          .concat(a.byKind.map((r) => [`<span class="dim">└</span> ${esc(r.name)}`, fmt(r.from), fmt(r.to), pc(r.yoy), pc(r.diff, 1, "억"), ""]))) +
        `<p class="fine">금액 단위 억 달러. 차종별 합계와 신차·중고차 합계는 모두 자동차 수출 총액과 같아요.${a.regions.length ? ` 지역(${esc(P.labels.regionBasis.split(" 기준")[0])}): ${a.regions.map((g) => `${esc(g.name)} ${signed(g.yoy)}%`).join(", ")}.` : ""}</p>`;
    } else { $("#s-auto").hidden = true; }

    // 6. 읽는 법
    $("#guideIntro").textContent = B.guide.intro;
    $("#guideList").innerHTML = B.guide.items.map((g) => `<li class="gitem">
      <div class="gitem__head"><h3>${esc(g.title)}</h3><span class="badge badge--${g.badge[1]}">${esc(g.badge[0])}</span></div>
      <p class="gitem__row"><span class="tag">이번 데이터</span><span>${g.data}</span></p>
      ${g.chips ? `<div class="sig">${g.chips.map((c) => `<span class="sig__chip ${c.on ? "is-on" : ""}"><i aria-hidden="true"></i>${esc(c.label)} ${signed(c.v)}%</span>`).join("")}</div>` : ""}
      <p class="gitem__row"><span class="tag">읽는 법</span><span>${esc(g.read)}</span></p>
    </li>`).join("");

    // 7. 지난달 비교
    if (B.compare) {
      const C = B.compare;
      $("#compareSub").textContent = `${C.prevLabel} → ${C.curLabel}`;
      $("#compareTable").innerHTML = table(["지표", "지난 기록", "이번", "변화"], C.rows.filter((r) => r.a != null && r.z != null).map((r) => {
        const d = r.z - r.a, u = r.u === "달러" ? "" : r.u;
        return [esc(r.label), `${fmt(r.a, r.d)}${esc(u === "%p" ? "%p" : r.u === "달러" ? "달러" : "%")}`, `<b>${fmt(r.z, r.d)}${esc(r.u === "%p" ? "%p" : r.u === "달러" ? "달러" : "%")}</b>`, r.u === "달러" ? pc(r.a ? (r.z / r.a - 1) * 100 : null) : pc(d, r.d, "%p")];
      }));
      $("#revisions").innerHTML = C.revisions.length ? `<details class="rev"><summary>이번 보도자료에서 지난 수치 ${C.revisions.length}건이 수정됐어요</summary>${table(["항목", "지난 발표", "수정 후"], C.revisions.map((v) => [esc(v.item), esc(v.before), `<b>${esc(v.after)}</b>`]))}</details>` : "";
    } else { $("#s-compare").hidden = true; $("#navCompare").hidden = true; }
  }


  /* ---------- 분야별 흐름 점검 ---------- */
  const CAT_NAMES = { export: "수출", price: "가격·단가", volume: "물량·생산", ship: "출하·판매", stock: "재고−출하", invest: "투자·수주" };
  const HEAD_NAMES = Object.assign({}, CAT_NAMES, { export: "수출(일평균)", stock: "재고 소진<br><small>출하−재고</small>" });
  const KIND_CLS = { same: "green", mostly: "amber", diverge: "red", hold: "gray" };
  const badge = (j) => `<span class="badge badge--${KIND_CLS[j.kind]}">${esc(j.status)}</span>`;
  const flagsHtml = (j) => j.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join("");
  function renderSectors() {
    const W = P.workdays;
    $("#sectorSub").textContent = `수출(${P.labels.tradeMonth})이 좋을 때 가격·생산·출하·재고·투자(${P.labels.industryMonth})도 같은 방향인지 봐요. 수출은 조업일수(${fmt(W.prev)}일 → ${fmt(W.curr)}일)를 감안한 일평균 기준이에요.`;
    const cats = ["export", "price", "volume", "ship", "stock", "invest"];
    const head = ["분야"].concat(cats.map((c) => HEAD_NAMES[c])).concat(["판정"]).concat(PREVP ? ["지난달"] : []);
    const rows = P.sectors.map((s) => {
      const j = A.judge(P, s.id); if (!j) return null;
      const cells = cats.map((c) => {
        const x = j.cells[c];
        if (!x) return '<span class="dim">—</span>';
        const opp = c !== "export" && j.e && x.t && x.t !== j.e;
        const v = c === "stock" ? `${signed(-x.val)}%p` : `${signed(x.val)}%`;
        return `<span class="cell ${x.t > 0 ? "pos" : x.t < 0 ? "neg" : "dim"}${opp ? " is-opp" : ""}" title="${esc(x.s.label)} (${esc(x.s.month)})"><b>${v}</b><small>${esc(x.s.label.replace(" 재고−출하", ""))}</small></span>`;
      });
      const pj = PREVP ? A.judge(PREVP, s.id) : null;
      return [`<a href="#sec-${s.id}" class="sname">${esc(s.name)}</a>`].concat(cells).concat([badge(j)]).concat(PREVP ? [pj ? badge(pj) : "—"] : []);
    }).filter(Boolean);
    $("#sectorTable").innerHTML = `<div class="tbl-wrap"><table class="tbl tbl--flow"><thead><tr>${head.map((h, i) => `<th scope="col"${i && i < 7 ? ' class="r"' : ""}>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => i ? `<td${i < 7 ? ' class="r"' : ""}>${c}</td>` : `<th scope="row">${c}</th>`).join("")}</tr>`).join("")}</tbody></table></div>`;

    $("#sectorDetails").innerHTML = P.sectors.map((s) => {
      const j = A.judge(P, s.id); if (!j) return "";
      const Aln = P.alignment[s.id];
      const pj = PREVP ? A.judge(PREVP, s.id) : null;
      const ex = s.exports.map((e) => `${esc(e.name)} ${fmt(e.cur)}억 달러(${signed(e.yoy)}%)`).join(", ");
      const sig = table(["구분", "지표", "기준월", "값", "메모"], Aln.signals.map((g) => [
        esc(CAT_NAMES[g.cat]) + (g.ref ? ' <span class="dim">(참고)</span>' : ""), esc(g.label), esc(g.month),
        g.cat === "stock" ? pc(g.value, 1, "%p") : g.cat === "export" && W0() ? `${pc(g.value)} <span class="dim">일평균 ${signed(A.adjExport(g.value, P))}%</span>` : pc(g.value),
        `<span class="desc">${esc(g.note || "")}</span>`]), "tbl--sig");
      return `<details class="acc__item" id="sec-${s.id}">
        <summary><span class="acc__name">${esc(s.name)}</span>${badge(j)}${flagsHtml(j)}<span class="acc__ex">${ex}</span></summary>
        <div class="acc__body">
          <p class="acc__verdict">${esc(Aln.verdict)}</p>
          ${pj ? `<p class="acc__line"><span class="tag">지난달</span><span>${badge(pj)} → ${badge(j)}</span></p>` : ""}
          ${s.lead ? `<p class="acc__line"><span class="tag">보도자료 설명</span> <span>${esc(s.lead).replace(/\n/g, "<br>")}</span></p>` : ""}
          ${s.breakdown.length ? `<p class="acc__line"><span class="tag">세부 품목</span> <span>${s.breakdown.map((x) => `${esc(x.name)} ${fmt(x.from, x.unit ? 0 : 1)} → ${fmt(x.to, x.unit ? 0 : 1)}${x.unit ? "만 톤" : "억"}(${signed(x.yoy)}%)`).join(", ")}</span></p>` : ""}
          ${s.regions.length ? `<p class="acc__line"><span class="tag">지역</span> <span>${s.regions.map((r) => `${esc(r.name)} ${signed(r.yoy)}%`).join(", ")} <span class="dim">(${esc(P.labels.regionBasis.split(" 기준")[0])})</span></span></p>` : ""}
          ${sig}
          <p class="acc__line"><span class="tag">확인할 점</span> <span>${esc(Aln.watch)}</span></p>
        </div></details>`;
    }).join("");
    if (location.hash.startsWith("#sec-")) { const d = document.querySelector(location.hash); if (d) d.open = true; }
    document.querySelectorAll(".sname").forEach((a) => a.addEventListener("click", () => { const d = document.querySelector(a.getAttribute("href")); if (d) d.open = true; }));
  }
  const W0 = () => P.workdays.prev !== P.workdays.curr;

  /* ---------- 조업일수 ---------- */
  function renderWorkdays() {
    const W = P.workdays, t = P.trade;
    const days = t.exportMonthly.map((v, i) => Math.round(v / t.exportDaily[i] * 2) / 2);
    $("#wdTiles").innerHTML = [
      { label: `${W.month}월 조업일수`, text: `${fmt(W.prev)} → ${fmt(W.curr)}일`, sub: W.prev === W.curr ? "작년과 같음" : `${signed(W.curr - W.prev)}일` },
      { label: `${W.month}월 수출 총액`, value: t.export.yoy, sub: "전년동월비" },
      { label: `${W.month}월 일평균 수출`, value: t.export.dailyYoy, sub: `${fmt(t.export.daily)}억 달러/일` },
      { label: `${P.labels.industryMonth} 조업일수`, text: `${fmt(days[11])}일`, sub: "산업활동 기준월" }
    ].map(tile).join("");
    $("#wdTable").innerHTML = table(["월"].concat(P.months.map((m) => esc(m.replace("’", "")))), [
      ["조업일수(일)"].concat(days.map((d, i) => i === 0 || i === 12 ? `<b>${fmt(d)}</b>` : fmt(d))),
      ["일평균 수출(억$)"].concat(t.exportDaily.map((v) => fmt(v))),
      ["수출 증감률"].concat(t.exportYoy.map((v) => pc(v)))
    ], "tbl--compact");
  }

  /* ---------- 지난 체크 결과 / 다음 체크 ---------- */
  const ST_CLS = { "해소": "green", "부분": "amber", "지속": "gray", "악화": "red", "확인 불가": "gray" };
  function renderChecks() {
    if (PREVP && P.followups && P.followups.length) {
      const prevItems = Object.fromEntries((PREVP.checklist || []).map((c) => [c.id, c]));
      const cnt = {}; P.followups.forEach((f) => { cnt[f.status] = (cnt[f.status] || 0) + 1; });
      $("#followCounts").innerHTML = ["해소", "부분", "지속", "악화"].map((k) => `<span class="badge badge--${ST_CLS[k]}">${k} ${cnt[k] || 0}</span>`).join("");
      const secName = (id) => (P.sectors.find((x) => x.id === id) || {}).name || "";
      const order = { "악화": 0, "지속": 1, "부분": 2, "해소": 3, "확인 불가": 4 };
      $("#followTable").innerHTML = table(["지난번 체크 항목", "지난 → 이번", "결과"], P.followups.slice().sort((a, z) => order[a.status] - order[z.status]).map((f) => {
        const c = prevItems[f.prevId] || {};
        return [`<span title="${esc(c.rule || "")}">${esc(c.title || f.prevId)}</span>`, esc(f.evidence.replace(/^[^:]+:\s*/, "")), `<span class="badge badge--${ST_CLS[f.status]}">${esc(f.status)}</span>`];
      }), "tbl--wrap");
    } else { $("#followTitle").hidden = true; }

    const nr = P.nextReleases || {};
    $("#checkSub").textContent = `${P.label} 자료를 보고 정한 항목이에요. 다음 PDF를 올리면 같은 지표로 자동 채점돼요.`;
    const secName = (id) => (P.sectors.find((x) => x.id === id) || {}).name || "";
    const group = (rel, title) => {
      const items = (P.checklist || []).filter((c) => c.release === rel);
      if (!items.length) return "";
      return `<h3 class="mini">${esc(title)}</h3>` + table(["항목", "지금", "판단 기준"], items.map((c) => [`<span title="${esc(c.where || "")}">${esc(c.title)}</span>`, esc(c.now), `<span class="desc">${esc(c.rule)}</span>`]), "tbl--wrap");
    };
    $("#checkTables").innerHTML = group("trade", `${nr.trade ? nr.trade.title : "다음 수출입 동향"} (${nr.trade ? nr.trade.date : ""})`) + group("industry", `${nr.industry ? nr.industry.title : "다음 산업활동동향"} (${nr.industry ? nr.industry.date : ""})`) + group("both", "두 자료 모두");
  }

  /* ---------- 기준 자료 선택 ---------- */
  function renderSelect() {
    const sel = $("#periodSelect");
    sel.innerHTML = KEYS.slice().reverse().map((k) => `<option value="${k}"${k === KEY ? " selected" : ""}>${esc(PERIODS[k].label)}${RECORDS[k].source === "local" ? " · 내 업로드" : ""}</option>`).join("");
    sel.addEventListener("change", () => { location.search = `?p=${sel.value}`; });
  }

  /* ---------- PDF 업로드 ---------- */
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  let pending = [];
  const status = (msg, kind = "") => { const el = $("#uploadStatus"); el.className = `status ${kind}`; el.innerHTML = msg; };
  function loadPdfJs() {
    return new Promise((res, rej) => {
      const done = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.KTM_PDF_WORKER || PDFJS_WORKER; res(window.pdfjsLib); };
      if (window.pdfjsLib) return done();
      const sc = document.createElement("script");
      sc.src = window.KTM_PDFJS || PDFJS;
      sc.onload = done;
      sc.onerror = () => rej(new Error("PDF 해석 도구를 불러오지 못했어요. 인터넷 연결을 확인하세요."));
      document.head.appendChild(sc);
    });
  }
  function renderFiles() {
    $("#fileList").innerHTML = pending.map((f, i) => `<li><b>${esc(f.file.name)}</b> <span class="${f.error ? "neg" : "muted"}">${f.error ? esc(f.error) : f.parsed ? `${f.parsed.type === "trade" ? "수출입 동향" : "산업활동동향"} · ${f.parsed.year}년 ${f.parsed.month}월` : "읽는 중…"}</span> <button type="button" class="link" data-rm="${i}">빼기</button></li>`).join("");
    $("#fileList").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { pending.splice(+b.dataset.rm, 1); renderFiles(); check(); }));
  }
  function check() {
    const t = pending.filter((f) => f.parsed && f.parsed.type === "trade"), ind = pending.filter((f) => f.parsed && f.parsed.type === "industry");
    $("#analyzeBtn").disabled = !(t.length === 1 && ind.length === 1);
    if (pending.some((f) => !f.parsed && !f.error)) return;
    if (!pending.length) return status("");
    if (t.length > 1 || ind.length > 1) return status("같은 종류의 보도자료가 두 개예요. 하나만 남겨 주세요.", "warn");
    if (!t.length || !ind.length) return status(`${t.length ? "" : "「수출입 동향」 "}${ind.length ? "" : "「산업활동동향」 "}PDF를 더 올려 주세요.`, "warn");
    const tm = t[0].parsed, im = ind[0].parsed, expect = tm.month === 1 ? 12 : tm.month - 1;
    const id = `${tm.year}-${String(tm.month).padStart(2, "0")}`;
    const warns = [].concat(tm.warnings || [], im.warnings || []);
    status(`${tm.month}월 수출입 동향 + ${im.month}월 산업활동동향 준비 완료.${im.month !== expect ? ` <b>주의:</b> 보통은 ${tm.month}월 수출입과 ${expect}월 산업활동을 함께 봐요.` : ""}${RECORDS[id] ? " 같은 달 기록이 있어 새로 덮어써요." : ""}${warns.length ? `<br>읽기 경고: ${warns.map(esc).join(" / ")}` : ""}`, im.month !== expect || warns.length ? "warn" : "ok");
  }
  async function addFiles(files) {
    const list = [...files].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!list.length) return status("PDF 파일만 올릴 수 있어요.", "warn");
    const entries = list.map((file) => ({ file, parsed: null, error: null }));
    pending = pending.concat(entries); renderFiles();
    status("PDF를 읽고 있어요. 산업활동동향은 쪽수가 많아 10초 정도 걸려요…");
    let pdfjs; try { pdfjs = await loadPdfJs(); } catch (e) { return status(esc(e.message), "warn"); }
    for (const en of entries) {
      try { en.parsed = await KTMParser.parsePdf(pdfjs, new Uint8Array(await en.file.arrayBuffer())); }
      catch (e) { en.error = e.message || "읽지 못했어요"; }
      renderFiles();
    }
    check();
  }
  function analyzeAndSave() {
    const t = pending.find((f) => f.parsed && f.parsed.type === "trade").parsed, ind = pending.find((f) => f.parsed && f.parsed.type === "industry").parsed;
    const id = `${t.year}-${String(t.month).padStart(2, "0")}`;
    const rec = { id, trade: t, industry: ind, files: pending.map((f) => f.file.name), savedAt: new Date().toISOString() };
    try { A.analyze(rec, null, null); } catch (e) { return status(`분석 중 오류가 났어요: ${esc(e.message)}. 보도자료 형식이 바뀌었을 수 있어요.`, "warn"); }
    const local = loadLocal().filter((r) => r.id !== id); local.push(rec);
    if (!saveLocal(local)) return status("브라우저 저장 공간이 부족해요. 기록 관리에서 내보내기 후 오래된 기록을 지워 주세요.", "warn");
    location.href = `?p=${id}`;
  }
  const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  function initUpload() {
    const zone = $("#dropZone"), input = $("#fileInput");
    $("#uploadToggle").addEventListener("click", () => { const u = $("#upload"); u.hidden = !u.hidden; $("#uploadToggle").setAttribute("aria-expanded", String(!u.hidden)); if (!u.hidden) u.scrollIntoView({ block: "start" }); });
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("is-over"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("is-over"); }));
    zone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    $("#analyzeBtn").addEventListener("click", analyzeAndSave);
    $("#exportBtn").addEventListener("click", () => download(`ktm-records-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(loadLocal()), "application/json"));
    $("#importInput").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const arr = JSON.parse(await f.text());
        if (!Array.isArray(arr) || !arr.every((r) => r.id && r.trade && r.industry)) throw new Error("기록 파일 형식이 아니에요.");
        const map = Object.fromEntries(loadLocal().map((r) => [r.id, r])); arr.forEach((r) => { map[r.id] = r; });
        saveLocal(Object.values(map)); location.reload();
      } catch (err) { alert(`가져오지 못했어요: ${err.message}`); }
    });
    $("#seedBtn").addEventListener("click", () => {
      const all = ALL.map((k) => { const { source, ...rest } = RECORDS[k]; return rest; });
      download("seed.js", `/* 저장소에 올리는 기본 기록. 사이트의 ‘기록 관리 → seed.js 만들기’로 만들었어요. */\nwindow.KTM_SEED = ${JSON.stringify(all)};\n`, "text/javascript");
    });
    $("#recordInfo").textContent = `기본 ${(window.KTM_SEED || []).length}개, 내 업로드 ${loadLocal().length}개`;
    $("#recordList").innerHTML = ALL.slice().reverse().map((k) => `<li><a href="?p=${k}">${esc(PERIODS[k] ? PERIODS[k].label : k)}</a> <span class="muted">${RECORDS[k].source === "local" ? "내 업로드" : "기본 기록"}</span>${ERRORS[k] ? ` <span class="neg">분석 실패: ${esc(ERRORS[k])}</span>` : ""}${RECORDS[k].source === "local" ? ` <button type="button" class="link" data-del="${k}">삭제</button>` : ""}</li>`).join("");
    $("#recordList").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm(`${b.dataset.del} 기록을 이 브라우저에서 지울까요?`)) return;
      saveLocal(loadLocal().filter((r) => r.id !== b.dataset.del)); location.href = location.pathname;
    }));
  }

  /* ---------- 시작 ---------- */
  initUpload();
  if (!P) {
    $("#upload").hidden = false;
    document.querySelectorAll("main > section:not(#upload), main > .lede, .nav, .period").forEach((el) => { el.hidden = true; });
    status("아직 기록이 없어요. 보도자료 PDF 2개를 올리면 분석이 시작돼요.");
    return;
  }
  renderSelect();
  render();
  renderSectors();
  renderWorkdays();
  renderChecks();
})();
