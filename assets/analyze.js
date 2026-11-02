/*
 * 분석 엔진
 * 파서가 읽은 두 보도자료(수출입 동향 + 산업활동동향)로 화면에 필요한 모든 값을 만듭니다.
 * - 분야별 신호와 흐름 판정, 판정 설명
 * - 가격·물량 분해
 * - 다음 보도자료 체크리스트 (측정 가능한 지표로 저장)
 * - 지난 기록의 체크리스트 채점, 지난 수치 수정 탐지
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KTMAnalyze = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 숫자 도우미 ---------- */
  const fmt = (v, d = 1) => v == null || isNaN(v) ? "–" : Number(v).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (v, d = 1) => v == null || isNaN(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), d);
  const round1 = (v) => Math.round(v * 10) / 10;
  const roundHalf = (v) => Math.round(v * 2) / 2;
  const last = (a) => a && a.length ? a[a.length - 1] : null;
  const pctChange = (a, b) => a == null || b == null || !a ? null : (b / a - 1) * 100;

  /* ---------- 가격·물량 분해 ---------- */
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
    if (cp < 0 && cq > 0) return v >= 0 ? `단가 하락(${signed(cp)}%p)을 물량 증가(${signed(cq)}%p)가 메움` : "물량은 늘었지만 단가 하락이 더 커 금액 감소";
    return "가격과 물량이 모두 감소";
  }

  /* ---------- 흐름 판정 ---------- */
  const CATS = [["export", "수출", "일평균 환산"], ["price", "가격·단가", ""], ["volume", "물량·생산", ""], ["ship", "출하·판매", ""], ["stock", "재고 부담", "재고−출하"], ["invest", "투자·수주", ""]];
  const KIND_RANK = { diverge: 0, hold: 1, mostly: 2, same: 3 };
  const wdFactor = (P) => P.workdays && P.workdays.prev && P.workdays.curr ? P.workdays.prev / P.workdays.curr : 1;
  const adjExport = (v, P) => ((1 + v / 100) * wdFactor(P) - 1) * 100;
  function tone(cat, v) {
    if (v == null || isNaN(v)) return null;
    const x = cat === "stock" ? -v : v;
    return Math.abs(x) < 2 ? 0 : x > 0 ? 1 : -1;
  }
  function judge(P, id) {
    const A = P.alignment && P.alignment[id];
    if (!A) return null;
    const first = {};
    A.signals.forEach((s) => { if (!s.ref && !first[s.cat]) first[s.cat] = s; });
    const cells = {};
    CATS.forEach(([c]) => {
      const s = first[c]; if (!s) return;
      const val = c === "export" ? adjExport(s.value, P) : s.value;
      cells[c] = { s, val, t: tone(c, val) };
    });
    const e = cells.export ? cells.export.t : 0;
    const others = CATS.map(([c]) => c).filter((c) => c !== "export" && cells[c] && cells[c].t !== 0);
    const agree = others.filter((c) => cells[c].t === e).length;
    let kind, status;
    if (!e || others.length < 2) { kind = "hold"; status = "판단 유보"; }
    else if (agree === others.length) { kind = "same"; status = "같은 방향"; }
    else if (agree / others.length >= 0.6) { kind = "mostly"; status = "대체로 같은 방향"; }
    else { kind = "diverge"; status = "엇갈림"; }
    const flags = [];
    if (cells.price && cells.volume && cells.price.t > 0 && cells.volume.t <= 0) flags.push("가격 주도");
    if (A.signals.some((s) => s.cat === "stock" && !s.ref && tone("stock", s.value) < 0)) flags.push("재고 부담");
    if (cells.export && tone("export", cells.export.s.value) !== cells.export.t) flags.push("조업일수 효과");
    return { kind, status, flags, cells, e, agree, n: others.length, A };
  }

  /* ---------- 분야 정의 ---------- */
  // items: 수출입동향 20대 품목명, industry: 산업활동동향 업종명
  const SECTORS = [
    { id: "semi", name: "반도체", items: ["반도체"], industry: ["반도체", "전자부품"], prices: ["ddr5", "nand", "ddr4"], index: "semi" },
    { id: "computer", name: "컴퓨터·SSD", items: ["컴퓨터"], industry: ["컴퓨터"], prices: [] },
    { id: "mobile", name: "무선통신·디스플레이", items: ["무선통신기기", "디스플레이"], industry: ["통신·방송장비", "전자부품"], prices: [] },
    { id: "auto", name: "자동차", items: ["자동차", "자동차부품"], industry: ["자동차"], prices: [], index: "auto" },
    { id: "ship", name: "선박", items: ["선박"], industry: ["기타운송장비"], prices: [] },
    { id: "energy", name: "석유제품·석유화학", items: ["석유제품", "석유화학"], industry: ["석유정제", "화학제품"], prices: ["dubai", "products"] },
    { id: "battery", name: "이차전지", items: ["이차전지"], industry: ["전기장비"], prices: ["lithium", "nickel"] },
    { id: "materials", name: "철강·비철금속", items: ["철강", "비철금속"], industry: ["1차금속", "금속가공"], prices: [] },
    { id: "machinery", name: "일반기계·전기기기", items: ["일반기계", "전기기기"], industry: ["기계장비", "전기장비"], prices: [] },
    { id: "consumer", name: "소비재·바이오", items: ["화장품", "바이오헬스", "농수산식품", "섬유", "생활용품", "가전"], industry: ["식료품", "의약품", "영상·음향기기", "섬유제품", "의복·모피"], prices: [] }
  ];

  /* ---------- 메인: 기록 하나를 화면용 기간 데이터로 ---------- */
  function analyze(rec, prevRec, prevPeriod) {
    const T = rec.trade, I = rec.industry;
    const y = T.year, m = T.month, yy = String(y).slice(2), im = I.month;
    const TM = `${m}월`, IM = `${im}월`;
    const months = T.months || [];
    const exportMonthly = T.exportMonthlyExact || T.exportMonthly || [];
    const items = T.items || {};
    const it = (name) => items[name] ? { cur: items[name].monthly[12] / 100, prev: items[name].monthly[0] / 100, yoy: items[name].yoy[12], monthly: items[name].monthly, yoys: items[name].yoy } : null;
    const blk = (name) => (T.blocks || {})[name] || null;
    const ir = (name) => (I.industryRows || {})[name] || null;
    const main = (k) => I.main && I.main[k] ? I.main[k].cur : null;
    const notes = [];

    // 조업일수 (수출액 ÷ 일평균)
    const daily = T.exportDaily || [];
    const prevDays = daily[0] ? roundHalf(exportMonthly[0] / daily[0]) : null;
    const currDays = daily[12] ? roundHalf(exportMonthly[12] / daily[12]) : null;
    const P = { id: rec.id, workdays: { year: y, month: m, prev: prevDays, curr: currDays } };

    // 가격 시계열
    const prices = {};
    if (T.memory) {
      prices.ddr5 = { title: "DDR5 16Gb 고정가격", unit: "달러", labels: T.memory.labels, values: T.memory.ddr5, note: T.memory.ddr5Yoy != null ? `${TM}은 전년동월비 ${signed(T.memory.ddr5Yoy)}%` : "" };
      prices.nand = { title: "NAND 128Gb 고정가격", unit: "달러", labels: T.memory.labels, values: T.memory.nand, note: T.memory.nandYoy != null ? `${TM}은 전년동월비 ${signed(T.memory.nandYoy)}%` : "" };
    }
    if (T.ddr4) prices.ddr4 = { title: "DDR4 8Gb 고정가격", unit: "달러", labels: T.ddr4.labels, values: T.ddr4.values, note: `${T.ddr4.labels[0]} 대비 ${fmt(last(T.ddr4.values) / T.ddr4.values[0], 1)}배` };
    if (T.dubai) {
      const lab = (T.rawLabels || []).slice(-3);
      prices.dubai = { title: "두바이유", unit: "달러/배럴", labels: lab.length === 3 ? lab : ["전년 동월", "전월", "당월"], values: [T.dubai.prevYear, T.dubai.prevMonth, T.dubai.cur], note: `${TM}은 전년동월비 ${signed(T.dubai.yoy)}%, 전월비 ${signed(T.dubai.mom)}%` };
    }
    if (T.oilProducts) prices.products = { title: "국제 휘발유·경유", unit: "달러/배럴", labels: T.oilProducts.crude.labels, multi: [{ name: "휘발유", values: T.oilProducts.gasoline.values }, { name: "경유", values: T.oilProducts.diesel.values }, { name: "원유", values: T.oilProducts.crude.values }] };
    if (T.lithium) prices.lithium = { title: "리튬", unit: "달러/kg", labels: T.lithium.labels, values: T.lithium.values, note: `1년 새 ${signed(pctChange(T.lithium.values[0], last(T.lithium.values)), 0)}%` };
    if (T.nickel) prices.nickel = { title: "니켈", unit: "달러/톤", labels: T.nickel.labels, values: T.nickel.values, note: `1년 새 ${signed(pctChange(T.nickel.values[0], last(T.nickel.values)), 0)}%` };

    // 수입 품목
    const importItem = (name) => (T.importItems || []).find((x) => x.name === name);

    // 반도체 수출 증감률을 산업활동 기준월에 맞춤
    const monthIdx = (label) => months.findIndex((x) => x.replace(/^’\d{2}\./, "") === String(label).replace(/p$/, "").replace(/^’\d{2}\./, ""));
    const idxLabels = (I.mfgIndex && I.mfgIndex.labels) || [];
    const semiExpAtIndex = idxLabels.map((l) => { const k = monthIdx(l); return k >= 0 && items["반도체"] ? items["반도체"].yoy[k] : null; });
    const autoExpAtIndex = idxLabels.map((l) => { const k = monthIdx(l); return k >= 0 && items["자동차"] ? items["자동차"].yoy[k] : null; });
    const imIdx = monthIdx(String(im));
    const semiExpIM = imIdx >= 0 && items["반도체"] ? items["반도체"].yoy[imIdx] : null;

    // 가격·물량 분해
    const decomposition = [];
    if (T.export && T.exportVolumeYoy) decomposition.push({ key: "total-export", name: "전체 수출", month: TM, sector: null, value: T.export.yoy, price: null, volume: last(T.exportVolumeYoy), basis: "물량은 통관 중량(톤) 기준" });
    if (T.import && T.importVolumeYoy) decomposition.push({ key: "total-import", name: "전체 수입", month: TM, sector: null, value: T.import.yoy, price: null, volume: last(T.importVolumeYoy), basis: "물량은 통관 중량(톤) 기준" });
    if (semiExpIM != null && ir("반도체")) decomposition.push({ key: "semi", name: "반도체 수출", month: IM, sector: "semi", value: semiExpIM, price: null, volume: ir("반도체").prod[1], proxy: true, basis: `물량 대신 같은 달(${IM}) 반도체 생산지수 사용` });
    if (T.petro) decomposition.push({ key: "petro", name: "석유제품 수출", month: TM, sector: "energy", value: T.petro.yoy, price: T.petro.unitYoy, volume: T.petro.volumeYoy, basis: "" });
    if (T.petchem) decomposition.push({ key: "petchem", name: "석유화학 수출", month: TM, sector: "energy", value: T.petchem.yoy, price: T.petchem.unitYoy, volume: T.petchem.volumeYoy, basis: "" });
    if (T.energyItems && T.energyItems.crude && T.crudeUnit && T.crudeVolume) decomposition.push({ key: "crude", name: "원유 수입", month: TM, sector: "energy", value: T.energyItems.crude.yoy, price: T.crudeUnit.yoy, volume: T.crudeVolume.yoy, basis: "도입단가·도입물량 기준" });
    const steelB = blk("철강");
    if (steelB && steelB.unitPrice && it("철강")) decomposition.push({ key: "steel", name: "철강 수출", month: TM, sector: "materials", value: it("철강").yoy, price: steelB.unitPrice.yoy, volume: null, basis: `단가는 ${m}.1~25일 기준, 물량은 역산` });

    // 분야별 신호
    const alignment = {};
    const sectors = [];
    const sig = (cat, label, month, value, extra = {}) => value == null || isNaN(value) ? null : Object.assign({ cat, label, month, value: round1(value) }, extra);
    const rowSigs = (name, opts = {}) => {
      const r = ir(name); if (!r) return [];
      const out = [];
      if (opts.prod !== false) out.push(sig("volume", `${name} 생산`, IM, r.prod[1], { note: `전월비 ${signed(r.prod[0])}%` }));
      if (opts.ship !== false) out.push(sig("ship", `${name} 출하`, IM, r.ship[1], { note: `전월비 ${signed(r.ship[0])}%` }));
      if (opts.stock !== false && r.inv[1] != null && r.ship[1] != null) out.push(sig("stock", `${name} 재고−출하`, IM, r.inv[1] - r.ship[1], { note: `재고 ${signed(r.inv[1])}% vs 출하 ${signed(r.ship[1])}%. 재고 전월비 ${signed(r.inv[0])}%`, industry: name }));
      return out;
    };
    const ex = (name, label) => { const x = it(name); return x ? sig("export", label || `${name} 수출`, TM, x.yoy) : null; };

    for (const S of SECTORS) {
      let signals = [];
      const lit = (n) => it(n);
      switch (S.id) {
        case "semi":
          signals = [ex("반도체"),
            T.memory ? sig("price", "DDR5 16Gb 고정가격", TM, T.memory.ddr5Yoy != null ? T.memory.ddr5Yoy : pctChange(T.memory.ddr5[0], last(T.memory.ddr5)), { note: T.memory.ddr5Yoy != null ? "전년동월비" : `${T.memory.labels[0]} 대비` }) : null,
            ...rowSigs("반도체"),
            I.invest ? sig("invest", "설비투자 기계류", IM, I.invest.machYoy) : null,
            importItem("반도체장비") ? sig("invest", "반도체장비 수입", TM, importItem("반도체장비").yoy) : null];
          break;
        case "computer": {
          const ssd = (blk("컴퓨터") || { breakdown: [] }).breakdown.find((b) => /SSD/.test(b.name));
          signals = [ex("컴퓨터"), ssd ? sig("export", "SSD 수출", TM, ssd.yoy) : null, ...rowSigs("컴퓨터")];
          break;
        }
        case "mobile":
          signals = [ex("무선통신기기"), ex("디스플레이"), ...rowSigs("통신·방송장비"), ...rowSigs("전자부품", { prod: false })];
          break;
        case "auto":
          signals = [ex("자동차"), ...rowSigs("자동차"), sig("ship", "내구재 소매판매", IM, main("내구재_yoy"), { note: "승용차 등" }),
            I.invest ? sig("invest", "설비투자 운송장비", IM, I.invest.transYoy, { ref: true, note: "자동차·선박·항공기를 함께 담은 지표라 판정에서 제외" }) : null];
          break;
        case "ship": {
          const b = blk("선박"), x = it("선박");
          const adj = b && b.offshoreBase && x && x.prev > b.offshoreBase ? (x.cur / (x.prev - b.offshoreBase) - 1) * 100 : null;
          signals = [adj != null ? sig("export", "선박 수출(해양플랜트 기저 제외, 추정)", TM, adj, { note: `전년 ${fmt(x.prev)}억 − 해양플랜트 ${fmt(b.offshoreBase)}억 기준` }) : null,
            ex("선박", adj != null ? "선박 수출(원래)" : null), ...rowSigs("기타운송장비"),
            I.invest ? sig("invest", "설비투자 운송장비", IM, I.invest.transYoy, { ref: true, note: "국내 기업의 운송장비 구매 투자. 판정에서 제외" }) : null];
          break;
        }
        case "energy":
          signals = [ex("석유제품"),
            T.petro ? sig("price", "석유제품 수출단가", TM, T.petro.unitYoy) : null,
            T.petro ? sig("volume", "석유제품 수출물량", TM, T.petro.volumeYoy) : null,
            ...rowSigs("석유정제", { prod: false }),
            ex("석유화학"),
            T.petchem ? sig("price", "석유화학 수출단가", TM, T.petchem.unitYoy) : null,
            T.petchem ? sig("volume", "석유화학 수출물량", TM, T.petchem.volumeYoy) : null,
            ir("석유정제") ? sig("volume", "석유정제 생산", IM, ir("석유정제").prod[1]) : null,
            ...rowSigs("화학제품", { prod: false })];
          break;
        case "battery": {
          const b = blk("이차전지") || { breakdown: [] };
          signals = [ex("이차전지"), ...b.breakdown.map((x) => sig("export", `${x.name.replace(/리튬이온배터리$/, "")} 리튬이온 수출`, TM, x.yoy)),
            T.lithium ? sig("price", "리튬 가격", TM, pctChange(T.lithium.values[0], last(T.lithium.values)), { note: `${fmt(T.lithium.values[0])} → ${fmt(last(T.lithium.values))}달러/kg` }) : null,
            ...rowSigs("전기장비", { prod: false })];
          break;
        }
        case "materials": {
          const x = it("철강"), up = steelB && steelB.unitPrice;
          const vol = x && up ? ((1 + x.yoy / 100) / (1 + up.yoy / 100) - 1) * 100 : null;
          signals = [ex("철강"), up ? sig("price", "철강 수출단가", TM, up.yoy, { note: `${fmt(up.from, 0)} → ${fmt(up.to, 0)}달러/톤` }) : null,
            vol != null ? sig("volume", "철강 수출물량(역산)", TM, vol, { note: P.workdays.prev !== P.workdays.curr ? `조업일수 감안 시 약 ${signed(adjExport(vol, P))}%` : "" }) : null,
            ...rowSigs("1차금속"), ex("비철금속")];
          break;
        }
        case "machinery":
          signals = [ex("일반기계"), ...rowSigs("기계장비"), sig("invest", "국내기계수주", IM, main("기계수주_yoy")),
            I.invest ? sig("invest", "설비투자 기계류", IM, I.invest.machYoy) : null, ex("전기기기"), ...rowSigs("전기장비", { prod: false, ship: false })];
          break;
        case "consumer": {
          const xs = S.items.map(lit).filter(Boolean);
          const cur = xs.reduce((a, x) => a + x.cur, 0), prev = xs.reduce((a, x) => a + x.prev, 0);
          signals = [sig("export", "소비재 6개 품목 합계 수출", TM, (cur / prev - 1) * 100), ...S.items.map((n) => ex(n)),
            ...rowSigs("식료품"), ir("의약품") ? sig("ship", "의약품 출하", IM, ir("의약품").ship[1], { note: `생산은 ${signed(ir("의약품").prod[1])}%` }) : null,
            sig("ship", "소매판매", IM, main("소매판매_yoy"), { note: `내구재 ${signed(main("내구재_yoy"))}%` }), ...rowSigs("영상·음향기기", { prod: false, ship: false })];
          break;
        }
      }
      signals = signals.filter(Boolean);
      alignment[S.id] = { signals };

      // 분야 화면 데이터
      const exportsArr = S.items.map((n) => { const x = it(n); return x ? { name: n, cur: x.cur, yoy: x.yoy, prev: x.prev, rank: "", monthly: x.monthly } : null; }).filter(Boolean);
      const blocks = S.items.map((n) => blk(n)).filter(Boolean);
      const lead = blocks.length ? blocks.map((b) => (S.items.length > 1 ? `${b.name}: ` : "") + b.text).join("\n") : "";
      const breakdown = [].concat(...blocks.map((b) => b.breakdown.map((x) => ({ name: x.name.replace(/리튬이온배터리$/, " 리튬이온"), from: x.from, to: x.to, yoy: x.yoy }))));
      if (S.id === "energy") {
        if (T.petro) breakdown.push({ name: "석유제품 물량(만 톤)", from: Math.round(T.petro.volume / (1 + T.petro.volumeYoy / 100)), to: T.petro.volume, yoy: T.petro.volumeYoy, unit: "만 톤" });
        if (T.petchem) breakdown.push({ name: "석유화학 물량(만 톤)", from: Math.round(T.petchem.volume / (1 + T.petchem.volumeYoy / 100)), to: T.petchem.volume, yoy: T.petchem.volumeYoy, unit: "만 톤" });
      }
      const regions = [].concat(...blocks.map((b) => b.regions.map((r) => ({ name: S.items.length > 1 ? `${r.name}(${b.name})` : r.name, value: r.value, yoy: r.yoy })))).slice(0, 6);
      sectors.push({ id: S.id, name: S.name, lead, exports: exportsArr, breakdown, industry: S.industry, prices: S.prices.filter((k) => prices[k]), regions, points: [], workday: "" });
    }
    P.alignment = alignment;

    // 판정 설명과 확인할 점
    sectors.forEach((s) => {
      const j = judge(P, s.id); if (!j) return;
      const A = alignment[s.id];
      const label = (c) => { const x = j.cells[c]; const nm = x.s.label.replace(" 재고−출하", ""); return c === "stock" ? (x.val >= 0 ? `${nm} 재고(출하보다 ${fmt(x.val)}%p 빠르게 증가)` : `${nm} 재고(출하가 ${fmt(-x.val)}%p 더 빠름)`) : `${x.s.label}(${signed(x.val)}%)`; };
      const cats = CATS.map(([c]) => c).filter((c) => c !== "export" && j.cells[c]);
      const same = cats.filter((c) => j.cells[c].t === j.e && j.e), opp = cats.filter((c) => j.cells[c].t && j.cells[c].t !== j.e), flat = cats.filter((c) => j.cells[c].t === 0);
      const ex0 = j.cells.export;
      const parts = [];
      if (ex0) parts.push(`${ex0.s.label}: ${P.workdays.prev !== P.workdays.curr ? `조업일수를 감안하면 ${signed(ex0.val)}%(원래 ${signed(ex0.s.value)}%)` : `${signed(ex0.s.value)}%`}.`);
      if (same.length) parts.push(`같은 방향: ${same.map(label).join(", ")}.`);
      if (opp.length) parts.push(`반대 방향: ${opp.map(label).join(", ")}.`);
      if (flat.length) parts.push(`보합: ${flat.map(label).join(", ")}.`);
      if (j.flags.includes("가격 주도")) parts.push(`단가는 ${signed(j.cells.price.val)}% 올랐지만 물량·생산은 ${signed(j.cells.volume.val)}%여서 금액 증가의 대부분이 가격에서 나왔습니다.`);
      A.verdict = parts.join(" ");
      const w = [];
      if (j.flags.includes("재고 부담")) w.push("다음 산업활동동향에서 재고−출하 차가 줄어드는지");
      if (j.flags.includes("가격 주도")) w.push("가격이 꺾일 때 물량·생산이 받쳐 주는지");
      if (j.kind === "diverge") w.push("산업 지표가 수출 방향을 따라오는지");
      if (!w.length) w.push("같은 방향이 다음 달에도 유지되는지");
      A.watch = w.join(", ") + " 확인해야 합니다.";
      const ex1 = s.exports[0];
      if (ex1 && P.workdays.prev && P.workdays.prev !== P.workdays.curr) s.workday = `조업일 ${fmt(P.workdays.prev)} → ${fmt(P.workdays.curr)}일. 일평균으로 환산하면 ${ex1.name} 수출 증감률은 ${signed(adjExport(ex1.yoy, P))}%입니다.`;
      // 요점: 세부 품목, 산업 지표 한 줄
      const pts = [];
      s.breakdown.slice(0, 4).forEach((b) => pts.push(`${b.name} ${fmt(b.from, b.unit ? 0 : 1)} → ${fmt(b.to, b.unit ? 0 : 1)}${b.unit ? "만 톤" : "억 달러"}(${signed(b.yoy)}%)`));
      s.industry.forEach((n) => { const r = ir(n); if (r) pts.push(`${IM} ${n}: 생산 ${signed(r.prod[1])}%, 출하 ${signed(r.ship[1])}%${r.inv[1] != null ? `, 재고 ${signed(r.inv[1])}%` : ""} (전년동월비)`); });
      s.points = pts;
    });

    // 산업활동 요약 표
    const topMovers = () => {
      const rows = Object.entries(I.industryRows || {}).filter(([n]) => !/광공업|제조업|광업|전기·가스업|전자·통신/.test(n) && ir(n).prod[0] != null);
      rows.sort((a, b) => b[1].prod[0] - a[1].prod[0]);
      const up = rows.slice(0, 2).filter((r) => r[1].prod[0] > 0).map(([n, r]) => `${n}(${signed(r.prod[0])}%)`);
      const dn = rows.slice(-2).reverse().filter((r) => r[1].prod[0] < 0).map(([n, r]) => `${n}(${signed(r.prod[0])}%)`);
      return [up.length ? `증가: ${up.join(", ")}` : "", dn.length ? `감소: ${dn.join(", ")}` : ""].filter(Boolean).join(" / ");
    };
    const mm = (k) => I.main[k] || {};
    const headline = [
      ["전산업생산", "전산업", ""], ["광공업생산", "광공업", topMovers()], ["제조업생산", "제조업생산", ""], ["서비스업생산", "서비스업", ""],
      ["소매판매", "소매판매", `내구재 전년비 ${signed(main("내구재_yoy"))}%`],
      ["설비투자", "설비투자", I.invest ? `기계류 ${signed(I.invest.machMom)}%, 운송장비 ${signed(I.invest.transMom)}% (전월비)` : ""],
      ["건설기성", "건설기성", ""]
    ].map(([name, k, note]) => ({ name, mom: (mm(k + "_mom")).cur, yoy: (mm(k + "_yoy")).cur, note })).filter((h) => h.mom != null || h.yoy != null);
    const util = mm("가동률");
    const extra = [
      util.cur != null ? { name: "제조업 평균가동률", value: `${fmt(util.cur)}%`, change: `전월비 ${signed(util.cur - util.prev)}%p` } : null,
      ir("제조업") ? { name: "제조업 재고", value: `${signed(ir("제조업").inv[0])}%`, change: `전년동월비 ${signed(main("재고_yoy"))}%` } : null,
      main("기계수주_yoy") != null ? { name: "국내기계수주", value: `${signed(main("기계수주_yoy"))}%`, change: "전년동월비" } : null,
      main("건설수주_yoy") != null ? { name: "건설수주(경상)", value: `${signed(main("건설수주_yoy"))}%`, change: "전년동월비" } : null,
      main("동행순환_diff") != null ? { name: "동행지수 순환변동치", value: `${signed(main("동행순환_diff"))}p`, change: "전월차" } : null,
      main("선행순환_diff") != null ? { name: "선행지수 순환변동치", value: `${signed(main("선행순환_diff"))}p`, change: "전월차" } : null
    ].filter(Boolean);

    const industryRows = {};
    Object.entries(I.industryRows || {}).forEach(([n, r]) => { industryRows[n] = [r.prod[0], r.prod[1], r.ship[0], r.ship[1], r.inv[0], r.inv[1]]; });

    // 지역
    const regionsOut = ["중국", "미국", "아세안", "EU(27)", "일본", "중남미", "인도", "중동", "CIS"].map((n) => {
      const r = (T.regions || {})[n]; if (!r) return null;
      const bal = (T.regionBalance || {})[n];
      return { name: n, value: r.monthly[12] / 100, yoy: r.yoy[12], balance: bal ? last(bal) : null };
    }).filter(Boolean);

    // 요약 문장
    const totalD = decomposition.find((d) => d.key === "total-export");
    const dT = totalD ? decompose(totalD) : null;
    const semi = it("반도체");
    const semiShare = semi && T.export ? semi.cur / T.export.value * 100 : null;
    const nonSemi = semi && T.export ? ((T.export.value - semi.cur) / (exportMonthly[0] - semi.prev) - 1) * 100 : null;
    const up = (v) => v >= 0 ? "늘었" : "줄었";
    const hero = T.export ? `${TM} 수출은 <b>${fmt(T.export.value, 0)}억 달러</b>로 1년 전보다 <b>${fmt(Math.abs(T.export.yoy))}%</b> ${up(T.export.yoy)}습니다. ` +
      (dT ? (dT.cq < 0 ? `수출 물량은 <b>${fmt(Math.abs(dT.q))}%</b> 줄어 금액 증가는 사실상 모두 가격에서 나왔습니다.` : `수출 물량은 <b>${fmt(dT.q)}%</b> 늘었고, 금액 증가의 ${fmt(dT.cp / dT.v * 100, 0)}%가 가격, ${fmt(dT.cq / dT.v * 100, 0)}%가 물량입니다.`) : "") : "";

    const judged = sectors.map((s) => ({ s, j: judge(P, s.id) })).filter((x) => x.j);
    const takeaways = [];
    if (dT) takeaways.push(`<strong>${dT.cq < 0 ? "금액은 가격이 끌어올렸습니다." : dT.cp > dT.cq ? "가격이 물량보다 크게 기여했습니다." : "물량이 금액 증가를 이끌었습니다."}</strong> ${TM} 수출 금액 ${signed(dT.v)}% = 가격 ${signed(dT.cp)}%p + 물량 ${signed(dT.cq)}%p.`);
    if (semi) takeaways.push(`<strong>반도체가 수출의 ${fmt(semiShare)}%입니다.</strong> 반도체 수출 ${signed(semi.yoy)}%, 반도체를 뺀 수출은 ${signed(nonSemi)}%.${ir("반도체") ? ` ${IM} 반도체 생산은 ${signed(ir("반도체").prod[1])}%, 재고는 ${signed(ir("반도체").inv[1])}%입니다.` : ""}`);
    const div = judged.filter((x) => x.j.kind === "diverge").map((x) => x.s.name), sameS = judged.filter((x) => x.j.kind === "same").map((x) => x.s.name);
    takeaways.push(`<strong>흐름 점검: 같은 방향 ${sameS.length}개, 엇갈림 ${div.length}개 분야.</strong> ${sameS.length ? `같은 방향: ${sameS.join(", ")}. ` : ""}${div.length ? `엇갈림: ${div.join(", ")}.` : ""}`);
    const stockS = [];
    judged.forEach((x) => { const st = P.alignment[x.s.id].signals.filter((g) => g.cat === "stock" && g.value >= 10).sort((a, b) => b.value - a.value)[0]; const nm = st && `${st.label.replace(" 재고−출하", "")}(${fmt(st.value)}%p)`; if (st && !stockS.includes(nm)) stockS.push(nm); });
    if (stockS.length) takeaways.push(`<strong>재고가 출하보다 10%p 넘게 빨리 느는 업종이 ${stockS.length}개입니다.</strong> ${stockS.join(", ")}.`);
    if (headline.length) {
      const inv = headline.find((h) => h.name === "설비투자"), ret = headline.find((h) => h.name === "소매판매");
      takeaways.push(`<strong>${IM} 투자와 소비.</strong> 설비투자 전월비 ${signed(inv && inv.mom)}%, 전년비 ${signed(inv && inv.yoy)}%${main("기계수주_yoy") != null ? `, 국내기계수주 ${signed(main("기계수주_yoy"))}%` : ""}. 소매판매 전월비 ${signed(ret && ret.mom)}%, 전년비 ${signed(ret && ret.yoy)}%.`);
    }
    if (T.energy && T.regionBalance && T.regionBalance["중동"]) takeaways.push(`<strong>에너지 수입 ${fmt(T.energy.value)}억 달러(${signed(T.energy.yoy)}%).</strong> ${T.dubai ? `두바이유 ${fmt(T.dubai.cur)}달러(${signed(T.dubai.yoy)}%), ` : ""}중동 무역수지 ${signed(last(T.regionBalance["중동"]), 0)}억 달러.`);

    // 화면 문구
    const wdDiff = P.workdays.prev != null ? P.workdays.curr - P.workdays.prev : 0;
    const texts = {
      workdaysIntro: wdDiff ? `${TM} 조업일수는 지난해 ${fmt(P.workdays.prev)}일에서 올해 ${fmt(P.workdays.curr)}일로 ${fmt(Math.abs(wdDiff))}일 ${wdDiff > 0 ? "늘었" : "줄었"}습니다. 그래서 총액 증가율(${signed(T.export.yoy)}%)과 일평균 증가율(${signed(T.export.dailyYoy)}%)이 다릅니다.` : `${TM} 조업일수는 지난해와 같은 ${fmt(P.workdays.curr)}일이라 총액 증가율을 그대로 비교해도 됩니다.`,
      pricesIntro: dT ? `${TM} 수출 금액 ${signed(dT.v)}%는 가격 ${signed(dT.cp)}%p와 물량 ${signed(dT.cq)}%p로 나뉩니다. 금액 증가율과 물량·생산 증가율의 차이가 가격 효과입니다.` : "",
      semiGapCaption: semiExpIM != null && ir("반도체") ? `${IM} 반도체 수출 ${signed(semiExpIM)}%, 생산지수 ${signed(ir("반도체").prod[1])}%. 두 선의 간격이 클수록 수출 증가가 물량보다 가격에서 나왔다는 뜻입니다.` : "",
      fxCaption: T.fx && T.exportKrwYoy ? `${TM} 환율 ${fmt(last(T.fx))}원(전년 동월 ${fmt(T.fx[0])}원). 원화 기준 수출 증가율은 ${signed(last(T.exportKrwYoy))}%로 달러 기준(${signed(T.export.yoy)}%)과 ${Math.abs(last(T.exportKrwYoy) - T.export.yoy) < 1 ? "비슷합니다" : last(T.exportKrwYoy) < T.export.yoy ? "보다 낮습니다" : "보다 높습니다"}.` : ""
    };

    Object.assign(P, {
      label: `${m}월 수출입 · ${im}월 산업활동`,
      labels: { tradeMonth: TM, industryMonth: IM, prevTradeMonth: `’${String(y - 1).slice(2)}.${m}`, curTradeMonth: `’${yy}.${m}`, monthRange: `’${String(y - 1).slice(2)}.${m}~’${yy}.${m}`, regionBasis: `${m}.1~25일 누계 기준, 전년동기비`, ytd: `1~${m}월` },
      hero, texts, takeaways,
      meta: { tradeTitle: `${y}년 ${m}월 수출입 동향`, tradeIssuer: "산업통상부", tradeDate: T.releaseDate, industryTitle: `${I.year}년 ${im}월 산업활동동향`, industryIssuer: "국가데이터처", industryDate: I.releaseDate },
      months,
      trade: {
        export: T.export, import: T.import, balance: { value: T.balance ? T.balance.value : last(T.balanceMonthly), streak: T.balanceStreak },
        ytd: T.ytd ? Object.assign({}, T.ytd, { note: T.ytd.export < 10000 ? `연 1조 달러까지 ${fmt(10000 - T.ytd.export, 0)}억 달러` : "연 1조 달러 돌파" }) : null,
        exportMonthly, exportYoy: T.exportYoy, exportDaily: T.exportDaily, importMonthly: T.importMonthly, importYoy: T.importYoy, importDaily: T.importDaily,
        balanceMonthly: T.balanceMonthly, exportVolumeYoy: T.exportVolumeYoy, importVolumeYoy: T.importVolumeYoy, fx: T.fx, exportKrw: T.exportKrw, exportKrwYoy: T.exportKrwYoy,
        imports: { energy: T.energy, nonEnergy: T.nonEnergy, items: T.importItems || [] },
        regions: regionsOut
      },
      industry: {
        month: `${I.year}년 ${im}월`, headline, extra, summary: (I.summary || []).slice(0, 4).map((s) => s.replace(/\*+/g, "").replace(/\s+생산$/, "").trim()),
        indexLabels: idxLabels, semiIndex: I.mfgIndex.semi, semiIndexYoy: I.mfgIndex.semiYoy, semiExportYoy: semiExpAtIndex,
        autoIndex: I.mfgIndex.auto, autoIndexYoy: I.mfgIndex.autoYoy, autoExportYoy: autoExpAtIndex
      },
      industryRows, sectors, prices, decomposition,
      tradeRegionBlocks: T.regionBlocks || {},
      nextReleases: { trade: { title: `${m === 12 ? y + 1 : y}년 ${m === 12 ? 1 : m + 1}월 수출입 동향`, date: "다음 달 1일 전후" }, industry: { title: `${im === 12 ? I.year + 1 : I.year}년 ${im === 12 ? 1 : im + 1}월 산업활동동향`, date: "다음 달 말일 전후" } }
    });

    // 체크리스트
    P.checklist = buildChecklist(P, rec);
    // 지난 기록 대비
    if (prevRec && prevPeriod) {
      P.followups = scoreChecklist(prevPeriod.checklist || [], P, rec);
      P.revisions = findRevisions(prevRec, rec);
    }

    // 유의사항
    P.notes = [
      `수출입 실적은 ${T.releaseDate} 배포 통관기준 잠정치이며 연간통계 확정 시까지 정정될 수 있습니다.`,
      `지역별 세부 품목 수치는 ${m}.1~25일 누계 기준입니다.`,
      `산업활동동향의 최근 수치는 잠정치(p)입니다. 전월비는 계절조정계열, 전년동월비는 원계열 기준입니다.`,
      `산업 지표는 ${IM}, 수출은 ${TM} 기준이라 한 달 시차가 있습니다.`,
      "수출 품목 분류(MTI)와 산업 분류(KSIC)는 범위가 달라 같은 이름이라도 직접 비교에 한계가 있습니다.",
      "조업일수는 보도자료의 수출액 ÷ 일평균 수출액으로 역산하고 0.5일 단위로 반올림했습니다.",
      "가격·물량 기여도는 (1+금액) = (1+단가)×(1+물량)을 로그로 분해한 값입니다. 물량은 통관 중량(톤) 기준입니다.",
      "판정·설명·체크리스트는 PDF에서 읽은 숫자로 자동 생성한 것입니다. 숫자는 원문 PDF와 대조해 확인하세요."
    ];
    if (I.month !== (m === 1 ? 12 : m - 1)) P.notes.unshift(`주의: 산업활동동향(${IM})이 수출입 동향(${TM})의 직전 달이 아닙니다. 두 자료의 기준월을 확인하세요.`);
    (T.warnings || []).concat(I.warnings || []).forEach((w) => P.notes.push(`읽기 경고: ${w}`));
    return P;
  }

  /* ---------- 체크리스트 (측정 지표 포함) ---------- */
  function buildChecklist(P, rec) {
    const T = rec.trade, list = [];
    const IM = P.labels.industryMonth, TM = P.labels.tradeMonth;
    P.sectors.forEach((s) => {
      const j = judge(P, s.id); if (!j) return;
      const sigs = P.alignment[s.id].signals.filter((x) => !x.ref);
      const stBig = sigs.filter((x) => x.cat === "stock" && x.value >= 5).sort((a, b) => b.value - a.value)[0];
      if (j.flags.includes("재고 부담") && stBig && !list.some((c) => c.metric && c.metric.label === stBig.label)) {
        const st = stBig;
        list.push({ id: `${s.id}-stock`, sector: s.id, release: "industry", title: `${st.industry} 재고가 출하보다 빨리 느는 흐름이 멈추는가`,
          rule: `재고−출하 증가율 차(현재 ${fmt(st.value)}%p)가 2%p 이하로 내려오면 해소, 줄어들면 부분, 커지면 악화`, now: `${IM} ${st.note.split(". ")[0]}`,
          where: `산업활동동향 업종별 생산·출하·재고 표(${st.industry})`, metric: { type: "signal", sector: s.id, label: st.label, value: st.value, good: "down", target: 2 } });
      }
      if (j.flags.includes("가격 주도")) {
        const v = j.cells.volume.s;
        list.push({ id: `${s.id}-volume`, sector: s.id, release: v.month === IM ? "industry" : "trade", title: `${s.name}: 물량·생산이 가격을 따라오는가`,
          rule: `${v.label} 증감률(현재 ${signed(v.value)}%)이 +2%를 넘으면 해소, 높아지면 부분, 낮아지면 악화`, now: `${v.label} ${signed(v.value)}%, ${j.cells.price.s.label} ${signed(j.cells.price.s.value)}%`,
          where: v.month === IM ? "산업활동동향 업종별 표" : "수출입동향 품목별 상세", metric: { type: "signal", sector: s.id, label: v.label, value: v.value, good: "up", target: 2 } });
      }
      if (j.kind === "diverge") {
        list.push({ id: `${s.id}-align`, sector: s.id, release: "both", title: `${s.name}: 산업 지표가 수출과 같은 방향으로 맞춰지는가`,
          rule: "흐름 판정이 ‘대체로 같은 방향’ 이상이 되면 해소, 그대로면 지속", now: `현재 판정 ‘${j.status}’ (수출과 같은 방향 ${j.agree}/${j.n}개 신호)`,
          where: "이 사이트의 흐름 점검", metric: { type: "kind", sector: s.id, value: KIND_RANK[j.kind], good: "up", target: 2 } });
      }
    });
    const p = P.prices;
    if (p.nand) list.push({ id: "nand", sector: "semi", release: "trade", title: "NAND 고정가격이 계속 오르는가", rule: `NAND 128Gb가 ${fmt(last(p.nand.values), 2)}달러보다 오르면 해소, 같으면 지속, 내리면 악화`, now: `DDR5 ${fmt(last(p.ddr5.values))}달러, NAND ${fmt(last(p.nand.values), 2)}달러`, where: "수출입동향 1쪽 메모리 고정가격", metric: { type: "price", key: "nand", value: last(p.nand.values), good: "up" } });
    if (p.ddr5) list.push({ id: "ddr5", sector: "semi", release: "trade", title: "DDR5 고정가격이 계속 오르는가", rule: `DDR5 16Gb가 ${fmt(last(p.ddr5.values))}달러보다 오르면 해소, 같으면 지속, 내리면 악화`, now: `DDR5 ${fmt(last(p.ddr5.values))}달러`, where: "수출입동향 1쪽 메모리 고정가격", metric: { type: "price", key: "ddr5", value: last(p.ddr5.values), good: "up" } });
    const semiS = P.sectors.find((s) => s.id === "semi");
    if (semiS && semiS.exports[0] && P.workdays.curr) { const d = semiS.exports[0].cur / P.workdays.curr; list.push({ id: "semi-daily", sector: "semi", release: "trade", title: "반도체 일평균 수출이 늘어나는가", rule: `다음 달 반도체 수출 ÷ 조업일수가 ${fmt(d)}억 달러보다 크면 해소, 비슷하면 지속, 작으면 악화`, now: `${TM} 반도체 일평균 ${fmt(d)}억 달러`, where: "수출입동향 20대 품목 표와 일평균 수출", metric: { type: "semiDaily", value: d, good: "up" } }); }
    if (T.dubai) list.push({ id: "dubai", sector: "energy", release: "trade", title: "유가 부담이 줄어드는가", rule: `두바이유가 ${fmt(T.dubai.cur)}달러보다 5% 넘게 내리면 해소, 비슷하면 지속, 오르면 악화`, now: `두바이유 ${fmt(T.dubai.cur)}달러(${signed(T.dubai.yoy)}%)`, where: "수출입동향 원유 도입단가 표", metric: { type: "price", key: "dubai", value: T.dubai.cur, good: "down", rel: 5 } });
    const me = P.trade.regions.find((r) => r.name === "중동");
    if (me && me.balance != null) list.push({ id: "mideast", sector: null, release: "trade", title: "중동 무역수지 적자가 줄어드는가", rule: `중동 수지가 ${signed(me.balance, 0)}억 달러보다 개선되면 해소, 비슷하면 지속, 나빠지면 악화`, now: `${TM} 중동 수지 ${signed(me.balance, 0)}억 달러`, where: "수출입동향 국가별 무역수지", metric: { type: "region", key: "중동", value: me.balance, good: "up", tol: 3 } });
    if (P.trade.ytd && P.trade.ytd.export < 10000) list.push({ id: "trillion", sector: null, release: "trade", title: "연 수출 1조 달러를 넘는가", rule: `누적 수출이 10,000억 달러를 넘으면 해소 (남은 금액 ${fmt(10000 - P.trade.ytd.export, 0)}억 달러)`, now: `${P.labels.ytd} 누적 ${fmt(P.trade.ytd.export, 0)}억 달러`, where: "수출입동향 1쪽 누적 수출", metric: { type: "ytd", value: P.trade.ytd.export, good: "up", target: 10000 } });
    list.push({ id: "workdays", sector: null, release: "both", title: "조업일수 차이부터 확인", rule: "다음 달 일평균 수출 증감률과 총액 증감률이 크게 다르면 조업일수 차이가 큰 달입니다. 산업활동 전년비도 같은 영향을 받으니 전월비와 함께 보세요", now: `${TM} 조업일 ${fmt(P.workdays.prev)} → ${fmt(P.workdays.curr)}일`, where: "수출입동향 일평균 수출" });
    list.push({ id: "revisions", sector: null, release: "both", title: "지난 수치가 수정됐는가", rule: "다음 보도자료의 전월 수치가 이번 값과 다르면 판정을 다시 확인 (이 사이트가 자동으로 비교합니다)", now: `${TM} 수출 ${fmt(P.trade.export.value)}억 달러, ${IM} 광공업생산 ${signed(rec.industry.main["광공업_mom"] && rec.industry.main["광공업_mom"].cur)}%`, where: "다음 보도자료의 전월 수치" });
    return list;
  }

  function metricValue(m, P, rec) {
    if (!m) return null;
    if (m.type === "signal") { const s = (P.alignment[m.sector] || { signals: [] }).signals.find((x) => x.label === m.label); return s ? s.value : null; }
    if (m.type === "kind") { const j = judge(P, m.sector); return j ? KIND_RANK[j.kind] : null; }
    if (m.type === "price") return P.prices[m.key] ? (m.key === "dubai" ? P.prices.dubai.values[2] : last(P.prices[m.key].values)) : null;
    if (m.type === "semiDaily") { const s = P.sectors.find((x) => x.id === "semi"); return s && s.exports[0] ? s.exports[0].cur / P.workdays.curr : null; }
    if (m.type === "region") { const r = P.trade.regions.find((x) => x.name === m.key); return r ? r.balance : null; }
    if (m.type === "ytd") return P.trade.ytd ? P.trade.ytd.export : null;
    return null;
  }
  const KIND_NAME = ["엇갈림", "판단 유보", "대체로 같은 방향", "같은 방향"];
  function scoreChecklist(prevList, P, rec) {
    return prevList.filter((c) => c.metric).map((c) => {
      const m = c.metric, nv = metricValue(m, P, rec), ov = m.value;
      if (nv == null) return { prevId: c.id, status: "확인 불가", evidence: "이번 자료에서 같은 지표를 찾지 못했습니다." };
      const tol = m.tol != null ? m.tol : m.type === "price" ? Math.max(Math.abs(ov) * (m.rel ? m.rel / 100 : 0.002), 0.01) : m.type === "kind" ? 0.5 : m.type === "semiDaily" ? Math.abs(ov) * 0.03 : Math.max(1, Math.abs(ov) * 0.05);
      let status;
      const better = m.good === "down" ? ov - nv : nv - ov;
      const reached = m.target != null && (m.good === "down" ? nv <= m.target : nv >= m.target);
      if (reached) status = "해소";
      else if (better > tol) status = m.target != null ? "부분" : "해소";
      else if (better < -tol) status = "악화";
      else status = "지속";
      const show = (v) => m.type === "kind" ? KIND_NAME[v] : m.type === "price" ? `${fmt(v, 2)}` : m.type === "ytd" || m.type === "region" ? fmt(v, 0) : m.type === "semiDaily" ? `${fmt(v)}억 달러` : `${signed(v)}${/재고−출하/.test(m.label || "") ? "%p" : "%"}`;
      const name = m.type === "signal" ? m.label : m.type === "kind" ? "흐름 판정" : m.type === "price" ? (P.prices[m.key] || {}).title || m.key : m.type === "semiDaily" ? "반도체 일평균 수출" : m.type === "region" ? `${m.key} 무역수지(억 달러)` : "누적 수출(억 달러)";
      return { prevId: c.id, status, evidence: `${name}: ${show(ov)} → ${show(nv)}`, metric: m, newValue: nv };
    });
  }

  /* ---------- 지난 수치 수정 탐지 ---------- */
  function findRevisions(prevRec, rec) {
    const out = [];
    const PT = prevRec.trade, T = rec.trade, PI = prevRec.industry, I = rec.industry;
    const pm = `${PT.month}월`;
    const cmp = (item, before, after, d, unit, source) => { if (before == null || after == null) return; if (Math.abs(before - after) >= (d === 0 ? 1 : 0.1) - 1e-9) out.push({ item, before: `${fmt(before, d)}${unit}`, after: `${fmt(after, d)}${unit}`, source }); };
    const tSrc = `${T.month}월 수출입동향`, iSrc = `${I.month}월 산업활동동향`;
    if (PT.month === (T.month === 1 ? 12 : T.month - 1)) {
      const pe = PT.exportMonthlyExact || PT.exportMonthly, ce = T.exportMonthlyExact || T.exportMonthly;
      cmp(`${pm} 수출액`, last(pe), ce[11], 1, "억 달러", tSrc);
      cmp(`${pm} 수출 증감률`, last(PT.exportYoy), T.exportYoy[11], 1, "%", tSrc);
      cmp(`${pm} 무역수지`, last(PT.balanceMonthly), T.balanceMonthly[11], 0, "억 달러", tSrc);
      Object.keys(T.items || {}).forEach((n) => { const a = PT.items[n], b = T.items[n]; if (a && b) { cmp(`${pm} ${n} 수출`, last(a.monthly) / 100, b.monthly[11] / 100, 1, "억 달러", tSrc); } });
    }
    if (PI.month === (I.month === 1 ? 12 : I.month - 1)) {
      const im = `${PI.month}월`;
      const names = { "광공업_mom": "광공업생산 전월비", "광공업_yoy": "광공업생산 전년비", "전산업_mom": "전산업생산 전월비", "서비스업_mom": "서비스업생산 전월비", "소매판매_mom": "소매판매 전월비", "소매판매_yoy": "소매판매 전년비", "설비투자_mom": "설비투자 전월비", "설비투자_yoy": "설비투자 전년비", "기계수주_yoy": "국내기계수주 전년비", "가동률": "제조업 평균가동률", "재고_yoy": "제조업 재고 전년비" };
      Object.entries(names).forEach(([k, label]) => { const a = PI.main[k], b = I.main[k]; if (a && b) cmp(`${im} ${label}`, a.cur, b.prev, 1, "%", iSrc); });
      const ai = PI.mfgIndex, bi = I.mfgIndex;
      if (ai && bi && bi.semiYoy.length >= 2) { cmp(`${im} 반도체 생산(전년비)`, last(ai.semiYoy), bi.semiYoy[bi.semiYoy.length - 2], 1, "%", iSrc); cmp(`${im} 자동차 생산(전년비)`, last(ai.autoYoy), bi.autoYoy[bi.autoYoy.length - 2], 1, "%", iSrc); }
    }
    return out;
  }

  return { analyze, decompose, decompReading, judge, tone, adjExport, wdFactor, CATS, KIND_RANK, SECTORS, fmt, signed };
});
