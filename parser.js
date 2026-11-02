/*
 * 보도자료 PDF 파서
 * - 산업통상부 「OOOO년 OO월 수출입 동향」
 * - 국가데이터처 「OOOO년 OO월 산업활동동향」
 * pdf.js로 읽은 텍스트를 줄 단위로 복원한 뒤, 표와 문장에서 숫자를 뽑아냅니다.
 * 브라우저(window.KTMParser)와 Node(module.exports)에서 같은 코드를 씁니다.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KTMParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- PDF → 줄 ---------- */
  async function pdfToPages(pdfjs, data) {
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        let L = null;
        for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) { if (Math.abs(lines[k].y - it.y) < 2.5) { L = lines[k]; break; } }
        if (L) L.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      const page = lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.s));
      // 띄어쓰기를 살린 문장: 글자 사이 간격이 있으면 공백
      page.smart = lines.map((l) => l.items.reduce((acc, it, k) => {
        if (!k) return it.s;
        const prev = l.items[k - 1];
        return acc + (it.x - (prev.x + prev.w) > 1.2 ? " " : "") + it.s;
      }, ""));
      pages.push(page);
    }
    return pages;
  }

  /* ---------- 공통 유틸 ---------- */
  const compact = (tokens) => tokens.join("").replace(/\s+/g, "");
  const spaced = (tokens) => tokens.join(" ");
  // 줄에서 숫자 추출: △ → 음수, 천단위 쉼표 제거, 괄호 무시
  function nums(str) {
    const s = str.replace(/△\s*/g, "-").replace(/(\d),(?=\d{3})/g, "$1").replace(/[()]/g, " ");
    const m = s.match(/-?\d+(?:\.\d+)?/g);
    return m ? m.map(Number) : [];
  }
  const num = (s) => s == null ? null : Number(String(s).replace(/,/g, "").replace(/△/g, "-").replace(/^\+/, ""));
  const pageText = (page) => page.map(compact).join("\n");
  const findPage = (pages, re, from = 0) => { for (let i = from; i < pages.length; i++) if (re.test(pageText(pages[i]))) return i; return -1; };
  const isNumTok = (t) => /^\(?△?-?[\d,]+(?:\.\d+)?\)?$/.test(t) || t === "-";

  function detectType(pages) {
    const head = pages.slice(0, 2).map(pageText).join("\n");
    if (/수출입동향/.test(head) && /산업통상/.test(head + pageText(pages[3] || []))) return "trade";
    if (/산업활동동향/.test(head)) return "industry";
    if (/수출입동향/.test(head)) return "trade";
    return null;
  }

  // "구분 ‘25.10 11 12 ‘26.1 ..." 형태의 월 라벨
  function monthLabels(tokens) {
    const out = [];
    for (const t of tokens) {
      const m = t.match(/^[‘’']?(\d{2})\.(\d{1,2})$/);
      if (m) out.push(`’${m[1]}.${m[2]}`);
      else if (/^\d{1,2}$/.test(t)) out.push(t);
    }
    return out;
  }

  /* ---------- 수출입 동향 ---------- */
  function parseTrade(pages) {
    const warn = [];
    const all = pages.map(pageText);
    const p1 = all[0].replace(/\n/g, "");
    const r = { type: "trade", warnings: warn };

    let m = p1.match(/(\d{4})년(\d{1,2})월수출입동향/);
    if (!m) throw new Error("수출입 동향 보도자료의 제목(OOOO년 OO월 수출입 동향)을 찾지 못했습니다.");
    r.year = +m[1]; r.month = +m[2];
    m = p1.match(/보도시점(\d{4})\.(\d{1,2})\.(\d{1,2})\./);
    r.releaseDate = m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";

    m = p1.match(/수출은전년동월대비([\d.]+)%(증가|감소)한([\d,.]+)억달러,수입은([\d.]+)%(증가|감소)한([\d,.]+)억달러,무역수지는([\d,.]+)억달러(흑자|적자)/);
    if (m) {
      r.export = { value: num(m[3]), yoy: (m[2] === "감소" ? -1 : 1) * num(m[1]) };
      r.import = { value: num(m[6]), yoy: (m[5] === "감소" ? -1 : 1) * num(m[4]) };
      r.balance = { value: (m[8] === "적자" ? -1 : 1) * num(m[7]) };
    } else warn.push("1쪽 총괄 문장에서 수출·수입·수지를 찾지 못했습니다.");

    m = p1.match(/1~(\d+)월누적수출([\d,]+)억달러\(([+\-△]?[\d.]+)%\),수입([\d,]+)억달러\(([+\-△]?[\d.]+)%\),수지([\d,]+)억달러(흑자|적자)/);
    if (m) r.ytd = { months: +m[1], export: num(m[2]), exportYoy: num(m[3]), import: num(m[4]), importYoy: num(m[5]), balance: (m[7] === "적자" ? -1 : 1) * num(m[6]) };
    else warn.push("1쪽 누적 실적을 찾지 못했습니다.");

    const fullText = all.join("\n");
    const flat = fullText.replace(/\n/g, "");
    // 소수점이 있는 문장을 우선 사용
    const dm = [...flat.matchAll(/일평균수출은([\d.]+)%(증가|감소)한([\d.]+)억달러/g)].sort((a, b) => (b[1].includes(".") ? 1 : 0) - (a[1].includes(".") ? 1 : 0))[0];
    if (dm && r.export) { r.export.daily = num(dm[3]); r.export.dailyYoy = (dm[2] === "감소" ? -1 : 1) * num(dm[1]); }
    m = flat.match(/(\d+)개월연속흑자/);
    r.balanceStreak = m ? +m[1] : null;
    m = flat.match(/비에너지수입은전년동월\(([\d,.]+)억달러\)대비([\d.]+)%(증가|감소)한([\d,.]+)억달러/);
    if (m) r.nonEnergy = { value: num(m[4]), yoy: (m[3] === "감소" ? -1 : 1) * num(m[2]) };
    m = flat.match(/에너지수입\+?([\d.]+)%(증가|감소)한([\d,.]+)억달러/);
    if (m) r.energy = { value: num(m[3]), yoy: (m[2] === "감소" ? -1 : 1) * num(m[1]) };
    // 비에너지 주요 수입 품목
    r.importItems = [];
    const ne = flat.match(/비에너지수입은.{0,80}?-(.{0,200}?)수입증가/);
    if (ne) {
      const re = /([가-힣A-Za-z]+)\(([\d.]+)억달러,([+\-△]?[\d.]+)%\)/g; let x;
      while ((x = re.exec(ne[1]))) r.importItems.push({ name: x[1], value: num(x[2]), yoy: num(x[3]) });
    }

    // --- 월별 표 (수출, 수입, 수지, 원화) ---
    const rowAfter = (pageIdx, labelRe, count = 13) => {
      if (pageIdx < 0) return null;
      for (const line of pages[pageIdx]) {
        if (labelRe.test(compact(line.slice(0, 3)))) {
          const v = nums(spaced(line.filter((t) => !/[가-힣]/.test(t))));
          if (v.length >= count) return v.slice(-count);
        }
      }
      return null;
    };
    const pExp = findPage(pages, /수출동향\(잠정치\)/);
    const pImp = findPage(pages, /수입동향\(잠정치\)/);
    const pBal = findPage(pages, /무역수지동향\(잠정치\)/);
    const pKrw = findPage(pages, /원화표시수출동향/);
    if (pExp >= 0) {
      const hdr = pages[pExp].find((l) => /^구분/.test(compact(l)));
      r.months = hdr ? monthLabels(hdr) : null;
      r.exportMonthly = rowAfter(pExp, /^수출액/);
      r.exportYoy = rowAfter(pExp, /^증감률/);
      r.exportDaily = rowAfter(pExp, /^일평균/);
      // 물량 증감률: '물량' 다음의 '증감률'
      const idx = pages[pExp].findIndex((l) => /^물량/.test(compact(l)));
      if (idx >= 0) { const v = nums(spaced(pages[pExp][idx + 1])); r.exportVolumeYoy = v.slice(-13); }
    }
    if (pKrw >= 0) {
      const L = pages[pKrw];
      const grab = (re) => { const i = L.findIndex((l) => re.test(compact(l))); if (i < 0) return null; for (let k = i; k < i + 3 && k < L.length; k++) { const v = nums(spaced(L[k])); if (v.length >= 13) return v.slice(-13); } return null; };
      r.fx = grab(/^환율/);
      // 수출액(억 달러) 소수점 값: '수출액' 첫 등장 뒤 줄
      const rows = []; L.forEach((l) => { const v = nums(spaced(l)); if (v.length === 13 && !/[가-힣]/.test(compact(l))) rows.push(v); });
      // 순서: 환율, 수출액(억$), 증감률, 수출액(조원), 증감률
      if (rows.length >= 5) { r.fx = rows[0]; r.exportMonthlyExact = rows[1]; r.exportKrw = rows[3]; r.exportKrwYoy = rows[4]; }
    }
    if (pImp >= 0) {
      r.importMonthly = rowAfter(pImp, /^수입액/);
      r.importYoy = rowAfter(pImp, /^증감률/);
      r.importDaily = rowAfter(pImp, /^일평균/);
      const idx = pages[pImp].findIndex((l) => /^물량/.test(compact(l)));
      if (idx >= 0) r.importVolumeYoy = nums(spaced(pages[pImp][idx + 1])).slice(-13);
    }
    if (pBal >= 0) {
      r.balanceMonthly = rowAfter(pBal, /^무역수지/);
      r.regionBalance = {};
      for (const l of pages[pBal]) {
        const c = compact(l); const name = (c.match(/^(중국|미국|일본|ASEAN|EU\(27\)|중동|중남미|CIS|베트남|인도)/) || [])[1];
        if (name) { const v = nums(spaced(l.slice(1))); if (v.length >= 14) r.regionBalance[name === "ASEAN" ? "아세안" : name] = v.slice(-14); }
      }
    }

    // --- 13개월 품목·지역 표 (금액줄 / 증감률줄 / [비중줄]) ---
    const ITEM_NAMES = ["반도체", "자동차", "일반기계", "석유제품", "석유화학", "선박", "철강", "자동차부품", "무선통신기기", "디스플레이", "전기기기", "바이오헬스", "비철금속", "컴퓨터", "농수산식품", "화장품", "섬유", "생활용품", "가전", "이차전지"];
    function parseSeriesTable(startPage, endRe, names, withShare) {
      const out = {};
      if (startPage < 0) return out;
      let cur = null, label = "", stage = 0;
      for (let p = startPage; p < Math.min(pages.length, startPage + 2); p++) {
        for (const line of pages[p]) {
          const c = compact(line);
          if (endRe && endRe.test(c)) return out;
          const hangul = line.filter((t) => /[가-힣A-Za-z]/.test(t) && !isNumTok(t)).join("");
          const numToks = line.filter((t) => isNumTok(t) || t === "(" || t === "△");
          const v = nums(spaced(numToks));
          const paren = /\(/.test(numToks.join(""));
          if (cur && stage === 2 && v.length >= 14) { label += hangul; finish(); continue; } // 비중줄
          if (v.length >= 14 && !paren) { // 금액줄
            if (cur && cur.yoy) finish();
            cur = { amount: v.slice(-14) }; label = hangul; stage = 1;
          } else if (cur && stage === 1 && v.length >= 14 && paren) { cur.yoy = v.slice(-14); label += hangul; stage = withShare ? 2 : 3; if (!withShare) finish(); }
          else if (cur && stage >= 1 && !v.length && hangul) label += hangul;
        }
      }
      if (cur && cur.yoy) finish();
      return out;
      function finish() {
        const clean = label.replace(/[^가-힣A-Za-z()0-9]/g, "");
        const key = names ? names.slice().sort((a, b) => b.length - a.length).find((n) => clean.includes(n)) : label;
        if (key && cur.yoy && !out[key]) out[key] = { total: cur.amount[0], monthly: cur.amount.slice(1), yoy: cur.yoy.slice(1) };
        cur = null; label = ""; stage = 0;
      }
    }
    const pItems = findPage(pages, /20대품목별수출추이/);
    r.items = parseSeriesTable(pItems, /유망품목별수출추이/, ITEM_NAMES, true);
    // 철강제품/철강 표기 차이 보정
    if (Object.keys(r.items).length < 20) warn.push(`20대 품목 표에서 ${Object.keys(r.items).length}개 품목만 읽었습니다.`);
    const pReg = findPage(pages, /주요지역별수출추이/);
    r.regions = parseSeriesTable(pReg, /수입동향/, ["중국", "미국", "일본", "아세안", "EU(27)", "중동", "중남미", "CIS", "베트남", "인도"], false);

    // --- 원자재 표 ---
    const pRaw = findPage(pages, /주요원자재동향/);
    if (pRaw >= 0) {
      const L = pages[pRaw];
      const row = (re) => { const l = L.find((x) => re.test(compact(x))); if (!l) return null; const v = nums(spaced(l.filter((t) => !/[가-힣]/.test(t) || /△/.test(t)))).filter((x, i, a) => true); return v; };
      const hdr = L.find((l) => /^구분/.test(compact(l)));
      r.rawLabels = hdr ? monthLabels(hdr).concat([]) : [];
      const pick = (re) => { const v = row(re); return v && v.length >= 7 ? { y24: v[v.length - 7], y25: v[v.length - 6], prevYear: v[v.length - 5], prevMonth: v[v.length - 4], cur: v[v.length - 3], yoy: v[v.length - 2], mom: v[v.length - 1] } : null; };
      r.energyItems = { crude: pick(/^원유\d/), products: pick(/^석유제품\d/), gas: pick(/^가스\d/), coal: pick(/^석탄\d/), total: pick(/^합계\d/) };
      r.dubai = pick(/^국제유가/);
      r.crudeUnit = pick(/^도입단가/);
      r.crudeVolume = pick(/^도입물량/);
      if (!r.dubai) warn.push("원자재 표에서 국제유가를 찾지 못했습니다.");
    }

    // --- 문장에서 가격·물량 ---
    m = fullText.match(/메모리고정가격추이\(\$,[‘’']?(\d{2})\.(\d{1,2})월((?:→\d{1,2}월)+)\)/);
    if (m) {
      const labels = [`’${m[1]}.${m[2]}`].concat(m[3].split("→").filter(Boolean).map((x) => x.replace("월", "")));
      const after = fullText.slice(fullText.indexOf(m[0]));
      const nm = after.match(/\n[^\n]*?([\d.]+(?:→[\d.]+)+),([\d.]+(?:→[\d.]+)+)/);
      if (nm) r.memory = { labels, ddr5: nm[1].split("→").map(Number), nand: nm[2].split("→").map(Number) };
    }
    if (!r.memory) warn.push("메모리 고정가격 추이를 찾지 못했습니다.");
    {
      const k = flat.indexOf("고정가격및증감률");
      const seg = k >= 0 ? flat.slice(k, k + 300) : "";
      const mm = seg.match(/([\d.]+(?:→[\d.]+)+)\(([+\-△]?[\d.]+)\)\/(?:NAND128G?)?([\d.]+(?:→[\d.]+)+)\(([+\-△]?[\d.]+)\)/);
      if (mm && r.memory) { r.memory.ddr5Yoy = num(mm[2]); r.memory.nandYoy = num(mm[4]); }
    }
    m = fullText.match(/디램고정가격\(DDR48Gb,달러\)/);
    if (m) {
      const i = all.findIndex((t) => t.includes(m[0]));
      const L = pages[i]; const li = L.findIndex((l) => compact(l).includes(m[0]));
      const labs = (L[li - 1] || []).map((t) => t.replace(/[‘’']/g, "’"));
      const vals = compact(L[li]).split(":")[1];
      if (vals) r.ddr4 = { labels: labs.filter((t) => /\d/.test(t)).map((t) => t.replace(/월$/, "")).filter((t) => t !== "월"), values: vals.split("→").map(Number) };
    }
    const prodRe = (name) => new RegExp(`(\\d{1,2})월${name}수출액([\\d.]+)억불\\(([+\\-△]?[\\d.]+)%\\)\\/물량([\\d,]+)만톤\\(([+\\-△]?[\\d.]+)%\\)\\/단가([\\d,]+)\\$\\/톤\\(([+\\-△]?[\\d.]+)%\\)`);
    for (const [key, name] of [["petro", "석유제품"], ["petchem", "석유화학"]]) {
      m = fullText.match(prodRe(name));
      if (m) r[key] = { value: num(m[2]), yoy: num(m[3]), volume: num(m[4]), volumeYoy: num(m[5]), unit: num(m[6]), unitYoy: num(m[7]) };
      else warn.push(`${name} 물량·단가 문장을 찾지 못했습니다.`);
    }

    // --- 품목별 상세 블록 ---
    r.blocks = {};
    const pDet = findPage(pages, /품목별상세수출동향/);
    const pRegDet = pDet >= 0 ? findPage(pages, /지역별상세수출동향/, pDet + 1) : -1;
    const blockText = (from, to) => { const t = []; for (let p = from; p < to && p < pages.length; p++) pages[p].forEach((l, i) => { const c = new String(compact(l)); c.smart = pages[p].smart ? pages[p].smart[i] : spaced(l); t.push(c); }); return t; };
    function splitBlocks(lines) {
      const out = []; let cur = null;
      for (const l of lines) {
        const h = String(l).match(/^□\(([^:：]+)[:：]([+\-△]?[\d.]+)%\)(.*)$/);
        if (h) {
          const sm = (l.smart || "").replace(/^□\s*\([^)]*%\)\s*/, "");
          cur = { name: h[1].replace(/[^가-힣A-Za-z]/g, ""), yoy: num(h[2]), lines: [h[3]], smart: [sm] }; out.push(cur);
        } else if (cur) { cur.lines.push(String(l)); cur.smart.push(l.smart || String(l)); }
      }
      return out;
    }
    if (pDet >= 0) {
      const lines = blockText(pDet, pRegDet > 0 ? pRegDet : pDet + 4);
      for (const b of splitBlocks(lines)) {
        const key = normItem(b.name);
        const narrative = []; const details = [];
        b.lines.forEach((l, i) => { if (/^[*↳]/.test(l) || details.length) details.push(l); else if (!/^\d위|^[①-⑩]+$|^-\d+-$|^[가-힣A-Za-z]{2,8}$/.test(l)) narrative.push(b.smart[i]); });
        const blk = { name: key, yoy: b.yoy, text: cleanNarr(narrative.join(" ")), breakdown: [], regions: [] };
        const dtext = details.join("\n");
        // ↳ A/B 수출액: x → y(z%) / ...
        for (const d of details) {
          const bm = d.match(/^↳(.+?)수출액(?:\/증감률)?(?:\(억달러\))?:(.+)$/);
          if (bm) {
            const names = bm[1].replace(/반도체$/, "").split("/");
            const pairs = [...bm[2].matchAll(/([\d.,]+)→([\d.,]+)\(([+\-△]?[\d.]+)%\)/g)];
            pairs.forEach((p, i) => blk.breakdown.push({ name: (names[i] || names[0]) + (/반도체$/.test(bm[1]) && i < names.length ? "" : ""), from: num(p[1]), to: num(p[2]), yoy: num(p[3]) }));
            if (/메모리\/시스템/.test(bm[1])) { blk.breakdown[0] && (blk.breakdown[0].name = "메모리"); blk.breakdown[1] && (blk.breakdown[1].name = "시스템반도체"); }
          }
          const rm = d.match(/^\*\d+\.1~\d+일수출액\/증감률\(억달러\):(.+)$/);
          if (rm) for (const x of rm[1].matchAll(/\(([^)]+)\)([\d.]+)\(([+\-△]?[\d.]+)%\)/g)) blk.regions.push({ name: regionName(x[1]), value: num(x[2]), yoy: num(x[3]) });
          const um = d.match(/수출단가\(\$\/톤\):\([^)]*\)([\d,]+)→\([^)]*\)([\d,]+)\(([+\-△]?[\d.]+)%\)/);
          if (um) blk.unitPrice = { from: num(um[1]), to: num(um[2]), yoy: num(um[3]) };
          const em = d.match(/^\*.+?수출액\/증감률\(억달러\):\([^)]*\)([\d.]+)\(([+\-△]?[\d.]+)%\)→\([^)]*\)([\d.]+)\(([+\-△]?[\d.]+)%\)/);
          if (em) blk.amount = { prev: num(em[1]), cur: num(em[3]), yoy: num(em[4]) };
        }
        const lm = dtext.match(/리튬가격추이\(\$\/KG\):((?:\([^)]*\)[\d.]+→?)+)/);
        if (lm) r.lithium = seriesFromText(lm[1]);
        const nk = dtext.match(/니켈가격추이\(\$\/Ton\):((?:\([^)]*\)[\d,]+→?)+)/);
        if (nk) r.nickel = seriesFromText(nk[1]);
        const oil = dtext.replace(/\n/g, "").match(/국제원\/휘발\/경유\(\$\/B\):((?:\([^)]*\)[\d.]+→?)+)\/((?:\([^)]*\)[\d.]+→?)+)\/((?:\([^)]*\)[\d.]+→?)+)/);
        if (oil) r.oilProducts = { crude: seriesFromText(oil[1]), gasoline: seriesFromText(oil[2]), diesel: seriesFromText(oil[3]) };
        const base = dtext.match(/해양플랜트\(1기,([\d.]+)억달러\)|해양플랜트\(([\d.]+)억/);
        if (base) blk.offshoreBase = num(base[1] || base[2]);
        r.blocks[key] = blk;
      }
      // 해양플랜트 기저 금액이 서술 문장에 있는 경우
      const sb = r.blocks["선박"]; if (sb && !sb.offshoreBase) { const mm = (sb.text || "").replace(/\s+/g, "").match(/해양플랜트\((?:1기,)?([\d.]+)억달러\)/); if (mm) sb.offshoreBase = num(mm[1]); }
    } else warn.push("품목별 상세 수출 동향을 찾지 못했습니다.");
    if (pRegDet >= 0) {
      r.regionBlocks = {};
      for (const b of splitBlocks(blockText(pRegDet, pRegDet + 3))) {
        const narrative = b.smart.filter((l, i) => !/^[*※]/.test(b.lines[i]) && !/^-\d+-$/.test(b.lines[i]) && !/^\(/.test(b.lines[i]) && !/^[가-힣A-Za-z]{2,8}$/.test(b.lines[i]));
        r.regionBlocks[b.name] = { yoy: b.yoy, text: cleanNarr(narrative.join(" ")) };
      }
    }
    return r;
  }

  function seriesFromText(s) {
    const labels = [], values = [];
    for (const x of s.matchAll(/\(([^)]*)\)([\d.,]+)/g)) { labels.push(x[1].replace(/[‘’'`]/g, "’").replace(/\.$/, "")); values.push(num(x[2])); }
    return { labels, values };
  }
  function cleanNarr(s) {
    return s.split(/\(\s*역대/)[0].replace(/[①-⑩]/g, "").replace(/\s+/g, " ").replace(/\s+([,.)])/g, "$1").replace(/\(\s+/g, "(").trim();
  }
  function regionName(s) {
    const map = { "美": "미국", "中": "중국", "日": "일본", "亞": "아시아", "EU": "EU", "인도": "인도", "중동": "중동", "중남미": "중남미", "CIS": "CIS" };
    return map[s] || s;
  }
  function normItem(n) {
    if (/^컴퓨터/.test(n)) return "컴퓨터";
    if (/^무선통신/.test(n)) return "무선통신기기";
    if (/^차부품|^자동차부품/.test(n)) return "자동차부품";
    if (/^철강/.test(n)) return "철강";
    if (/^섬유/.test(n)) return "섬유";
    return n;
  }

  /* ---------- 산업활동동향 ---------- */
  function parseIndustry(pages) {
    const warn = [];
    const all = pages.map(pageText);
    const p1 = all.slice(0, 2).join("\n");
    const r = { type: "industry", warnings: warn };
    let m = p1.match(/(\d{4})년(\d{1,2})월산업활동동향/);
    if (!m) throw new Error("산업활동동향 보도자료의 제목(OOOO년 OO월 산업활동동향)을 찾지 못했습니다.");
    r.year = +m[1]; r.month = +m[2];
    m = p1.match(/보도시점(\d{4})\.(\d{1,2})\.(\d{1,2})\./);
    r.releaseDate = m ? `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}` : "";

    // 주요지표 표: 마지막 값 = 당월, 그 앞 = 전월(수정치)
    const pMain = findPage(pages, /산업활동주요지표/, 5);
    r.main = {};
    if (pMain >= 0) {
      const L = pages[pMain];
      const pairOrder = ["전산업", "광공업", "제조업생산", "서비스업", "도소매업", "소매판매", "설비투자", "건설기성"];
      let pi = 0, half = 0;
      const set = (key, v) => { if (v.length >= 2) r.main[key] = { cur: v[v.length - 1], prev: v[v.length - 2] }; };
      for (const l of L) {
        const c = compact(l);
        const v = nums(spaced(l.filter((t) => !/^\d\)$/.test(t)))).filter((x) => true);
        const vals = c.includes("(2020=100)") ? [] : v;
        if (/전월\(기\)비/.test(c) && vals.length >= 6 && pi < pairOrder.length) { set(pairOrder[pi] + "_mom", vals); half = 1; continue; }
        if (/동월\(기\)비/.test(c) && vals.length >= 6 && pi < pairOrder.length) { set(pairOrder[pi] + "_yoy", vals); pi++; half = 0; continue; }
        if (/^생?․?출하/.test(c) || /^생․출하/.test(c)) set("출하_yoy", vals);
        else if (/^-?내수/.test(c)) set("내수출하_yoy", vals);
        else if (/^-?수출/.test(c) && vals.length >= 6) set("수출출하_yoy", vals);
        else if (/재고/.test(c) && /업/.test(c)) set("재고_yoy", vals);
        else if (/평균가동률/.test(c)) set("가동률", vals);
        else if (/^생산능력/.test(c)) set("생산능력_yoy", vals);
        else if (/^-?내구재/.test(c)) set("내구재_yoy", vals);
        else if (/국내기계수주/.test(c)) set("기계수주_yoy", vals);
        else if (/건설수주/.test(c)) set("건설수주_yoy", vals);
      }
      const ci = L.filter((l) => /^․?전월차\(p\)/.test(compact(l)));
      if (ci[0]) { const v = nums(spaced(ci[0])); r.main["동행순환_diff"] = { cur: v[v.length - 1], prev: v[v.length - 2] }; }
      if (ci[1]) { const v = nums(spaced(ci[1])); r.main["선행순환_diff"] = { cur: v[v.length - 1], prev: v[v.length - 2] }; }
      // 표의 마지막 열이 당월인지 확인
      const hdr = L.map(compact).find((c) => /연간/.test(c));
      if (hdr && !new RegExp(`${r.month}월$`).test(hdr)) warn.push("주요지표 표의 마지막 열이 당월이 아닐 수 있습니다.");
    } else warn.push("산업활동 주요지표 표를 찾지 못했습니다.");

    // 업종별 생산·출하·재고
    const pInd = findPage(pages, /업종별생산·출하·재고\(/, 5);
    r.industryRows = {};
    if (pInd >= 0) {
      for (const l of pages[pInd]) {
        const c = compact(l);
        if (!/^(\d{2,3}\.|[BCD]\.|총지수)/.test(c)) continue;
        const toks = l.slice(/^(\d{2,3}\.|[BCD]\.)$/.test(l[0]) ? 1 : 0);
        const numIdx = []; toks.forEach((t, i) => { if (/^-?[\d.]+$/.test(t) || t === "-") numIdx.push(i); });
        const tail = numIdx.slice(-9);
        if (tail.length < 9) continue;
        const nameToks = toks.filter((_, i) => !tail.includes(i));
        const name = nameToks.join("").replace(/[․·]/g, "·").replace(/\s+/g, "").replace(/^총지수$/, "광공업");
        const v = tail.map((i) => toks[i] === "-" ? null : Number(toks[i]));
        r.industryRows[name] = { prod: [v[1], v[2]], ship: [v[4], v[5]], inv: [v[7], v[8]] };
      }
      if (!r.industryRows["반도체"]) warn.push("업종별 표에서 반도체 행을 찾지 못했습니다.");
    } else warn.push("업종별 생산·출하·재고 표를 찾지 못했습니다.");

    // 제조업 주요 분류별 생산지수 (원지수 + 전년동월비)
    const pIdx = findPage(pages, /제조업주요분류별생산지수\n?①원지수/, 5);
    const pIdx2 = pIdx >= 0 ? pIdx : findPage(pages, /제조업주요분류별생산지수[\s\S]*①원지수/, 5);
    r.mfgIndex = { labels: [], semi: [], semiYoy: [], auto: [], autoYoy: [] };
    if (pIdx2 >= 0) {
      let on = false;
      for (const l of pages[pIdx2]) {
        const c = compact(l);
        if (l[0] === `${r.year}.` && l[1] === "1") on = true;
        if (!on) continue;
        const toks = l.filter((t) => t !== `${r.year}.`);
        const lab = toks[0];
        if (!/^\d{1,2}p?$/.test(lab)) { if (r.mfgIndex.labels.length) break; continue; }
        const v = toks.slice(1).map(Number);
        if (v.length < 12) continue;
        r.mfgIndex.labels.push(lab === "1" ? `’${String(r.year).slice(2)}.1` : lab);
        r.mfgIndex.semi.push(v[2]); r.mfgIndex.auto.push(v[3]);
        r.mfgIndex.semiYoy.push(v[8]); r.mfgIndex.autoYoy.push(v[9]);
      }
    }
    if (!r.mfgIndex.labels.length) warn.push("반도체·자동차 생산지수 표를 찾지 못했습니다.");

    // 설비투자 기계류·운송장비
    const pInv = all.findIndex((t, i) => i > 5 && /설비투자지수|설비투자는/.test(t) && /-기계류/.test(t) && /-운송장비/.test(t));
    if (pInv >= 0) {
      const L = pages[pInv].filter((l) => /^-?(기계류|운송장비)/.test(compact(l).replace(/^-/, "")) && /^-/.test(compact(l)));
      const take = (l) => { const v = nums(spaced(l)); return v[v.length - 1]; };
      const mach = L.filter((l) => /기계류/.test(compact(l))), trans = L.filter((l) => /운송장비/.test(compact(l)));
      r.invest = { machMom: mach[0] && take(mach[0]), machYoy: mach[1] && take(mach[1]), transMom: trans[0] && take(trans[0]), transYoy: trans[1] && take(trans[1]) };
    } else warn.push("설비투자 기계류·운송장비 표를 찾지 못했습니다.");

    // 요약 문장 (□ 로 시작)
    const pSum = findPage(pages, /산업활동동향\(요약\)/, 2);
    r.summary = [];
    if (pSum >= 0) {
      const t = (pages[pSum].smart || pages[pSum].map(spaced)).join(" ").replace(/\s+/g, " ");
      for (const x of t.split("□").slice(1, 6)) r.summary.push(x.trim().slice(0, 160));
    }
    return r;
  }

  async function parsePdf(pdfjs, data) {
    const pages = await pdfToPages(pdfjs, data);
    const type = detectType(pages);
    if (type === "trade") return parseTrade(pages);
    if (type === "industry") return parseIndustry(pages);
    throw new Error("수출입 동향 또는 산업활동동향 보도자료로 인식하지 못했습니다.");
  }

  return { pdfToPages, parsePdf, parseTrade, parseIndustry, detectType, _nums: nums };
});
