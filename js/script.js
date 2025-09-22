// js/script.js
// Full script implementing:
// - ADDS per provided table (with MET triggers)
// - Flag-only engine (Critical / Important)
// - Urine mL/kg/hr calculation
// - Analgesia copied into DMR next to pain
// - Handoff key includes icuReason, icuSummary, pmh
// - Defensive: missing inputs are tolerated

(function () {
  'use strict';

  // ---------- Helpers ----------
  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const safeVal = (id) => {
    const el = document.getElementById(id);
    if (!el) return undefined;
    if (el.type === 'checkbox') return el.checked;
    return el.value === undefined || el.value === null ? '' : el.value;
  };

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // ---------- Gather data from DOM ----------
  function gatherFormData() {
    // List all fields we use (missing fields are OK)
    const data = {
      // patient/context
      review_type: safeVal('review_type'),
      location: safeVal('location'),
      room_number: safeVal('room_number'),
      patient_id: safeVal('patient_id'),
      stepdown_date: safeVal('stepdown_date'),
      weight: toNum(safeVal('weight')), // kg
      age: toNum(safeVal('age')),
      admission_type: safeVal('admission_type'),
      icu_los: toNum(safeVal('icu_los')),
      after_hours: !!(safeVal('after_hours') === true || safeVal('after_hours') === 'true' || safeVal('after_hours') === 'on'),
      reason_icu: safeVal('reason_icu'),
      icuReason: safeVal('icuReason'), // new field
      icuSummary: safeVal('icuSummary'),
      pmh: safeVal('pmh'),

      // bloods / labs
      creatinine: toNum(safeVal('creatinine')),
      creatinine_baseline: toNum(safeVal('creatinineBaseline') || safeVal('creatinine_baseline')),
      lactate: toNum(safeVal('lactate')),
      lactate_trend: safeVal('lactate_trend'),
      hb: toNum(safeVal('hb') || safeVal('haemoglobin')),
      platelets: toNum(safeVal('platelets')),
      crp: toNum(safeVal('crp')),
      glucose: toNum(safeVal('glucose')),

      // A-E / vitals
      rr: toNum(safeVal('respiratoryRate') || safeVal('rr') ),
      rr_trend: safeVal('rr_trend'),
      spo2: toNum(safeVal('spo2')),
      spo2_trend: safeVal('spo2_trend'),
      o2_device: safeVal('o2Device') || safeVal('o2_device'),
      o2_flow: toNum(safeVal('o2Flow') || safeVal('o2_flow')),
      fio2: toNum(safeVal('fio2')),
      fio2_trend: safeVal('fio2_trend'),
      fio2_pattern: safeVal('fio2_pattern'), // e.g., 'wean_then_rise' if you capture it
      hr: toNum(safeVal('heartRate') || safeVal('hr')),
      hr_trend: safeVal('hr_trend'),
      sbp: toNum(safeVal('systolicBP') || safeVal('sbp')),
      sbp_trend: safeVal('sbp_trend'),
      temp: toNum(safeVal('temperature') || safeVal('temp')),
      temp_trend: safeVal('temp_trend'),
      consciousness: safeVal('consciousness'),
      delirium: toNum(safeVal('delirium') || safeVal('delirium_score') || 0),
      cap_refill: safeVal('cap_refill'),

      // fluids / urine
      urineOutput: toNum(safeVal('urineOutput') || safeVal('urine_output') || safeVal('uop_ml_per_hr')),
      urine_output_trend: safeVal('urine_output_trend'),

      // devices
      cvad_present: !!(safeVal('cvad_present') === true || safeVal('cvad_present') === 'true' || safeVal('cvad_present') === 'on'),
      cvad_site_health: safeVal('cvad_site_health'),
      pivc_1_present: !!(safeVal('pivc_1_present') === true || safeVal('pivc_1_present') === 'true' || safeVal('pivc_1_present') === 'on'),
      pivc_1_site_health: safeVal('pivc_1_site_health'),
      idc_present: !!(safeVal('idc_present') === true || safeVal('idc_present') === 'true' || safeVal('idc_present') === 'on'),
      recent_extubation: !!(safeVal('recent_extubation') === true || safeVal('recent_extubation') === 'true' || safeVal('recent_extubation') === 'on'),
      airway: safeVal('airway'),

      // other
      vasopressor_recent: !!(safeVal('vasopressor_recent') === true || safeVal('vasopressor_recent') === 'true' || safeVal('vasopressor_recent') === 'on'),
      active_bleeding: !!(safeVal('active_bleeding') === true || safeVal('active_bleeding') === 'true' || safeVal('active_bleeding') === 'on'),
      pain_score: toNum(safeVal('painScore') || safeVal('pain_score')),
      analgesiaRegimen: safeVal('analgesiaRegimen'),

      // misc / trend markers you may provide
      fio2_was_weaned_then_risen: safeVal('fio2_pattern') === 'wean_then_rise' || safeVal('fio2_pattern') === 'wean-then-rise',
      // clinician override fields (optional)
      manual_upgrade: !!(safeVal('manual_upgrade') === true || safeVal('manual_upgrade') === 'true'),
      manual_downgrade: !!(safeVal('manual_downgrade') === true || safeVal('manual_downgrade') === 'true')
    };

    return data;
  }

  // ---------- ADDS calculation (strict to supplied table) ----------
  // returns { score: number, metCall: boolean, metReasons: [], breakdown: {} }
  function calculateADDSFromData(d) {
    let score = 0;
    const metReasons = [];
    const breakdown = {};

    // Resp Rate
    if (!Number.isNaN(d.rr)) {
      if (d.rr <= 4) { metReasons.push(`RR ${d.rr} <=4 (MET)`); breakdown.rr = 'MET'; }
      else if (d.rr >= 36) { metReasons.push(`RR ${d.rr} >=36 (MET)`); breakdown.rr = 'MET'; }
      else if (d.rr >= 5 && d.rr <= 8) { score += 3; breakdown.rr = 3; }
      else if (d.rr >= 9 && d.rr <= 10) { score += 2; breakdown.rr = 2; }
      else if (d.rr >= 11 && d.rr <= 20) { score += 0; breakdown.rr = 0; }
      else if (d.rr >= 21 && d.rr <= 24) { score += 1; breakdown.rr = 1; }
      else if (d.rr >= 25 && d.rr <= 30) { score += 2; breakdown.rr = 2; }
      else if (d.rr >= 31 && d.rr <= 35) { score += 3; breakdown.rr = 3; }
    }

    // SpO2
    if (!Number.isNaN(d.spo2)) {
      if (d.spo2 <= 84) { metReasons.push(`SpO2 ${d.spo2} <=84 (MET)`); breakdown.spo2 = 'MET'; }
      else if (d.spo2 >= 85 && d.spo2 <= 88) { score += 3; breakdown.spo2 = 3; }
      else if (d.spo2 >= 89 && d.spo2 <= 90) { score += 2; breakdown.spo2 = 2; }
      else if (d.spo2 >= 91 && d.spo2 <= 93) { score += 1; breakdown.spo2 = 1; }
      else if (d.spo2 >= 94) { score += 0; breakdown.spo2 = 0; }
    }

    // O2 Flow Rate
    if (!Number.isNaN(d.o2_flow)) {
      if (d.o2_flow >= 10) { score += 3; breakdown.o2_flow = 3; }
      else if (d.o2_flow >= 8) { score += 2; breakdown.o2_flow = 2; }
      else if (d.o2_flow >= 6) { score += 1; breakdown.o2_flow = 1; }
      else { score += 0; breakdown.o2_flow = 0; }
    }

    // O2 Device / FiO2 mapping
    // Priority: if fio2 numeric present use mapping; else if device indicates high-flow, add 1 per table
    if (!Number.isNaN(d.fio2)) {
      // apply the mapping you asked for (21-28 =1; 29-40 =2; >40 =3)
      if (d.fio2 >= 40) { score += 3; breakdown.fio2 = 3; }
      else if (d.fio2 >= 29) { score += 2; breakdown.fio2 = 2; }
      else if (d.fio2 >= 21) { score += 1; breakdown.fio2 = 1; }
      // if fio2 <21 or NaN, ignore
    } else {
      // map HF devices to +1 (any high-flow device)
      const dev = (d.o2_device || '').toString().toLowerCase();
      if (dev.includes('hf') || dev.includes('hfnp') || dev.includes('high-flow') || dev.includes('high flow') || dev.includes('nhf')) {
        score += 1;
        breakdown.o2_device = 1;
      }
    }

    // Heart Rate
    if (!Number.isNaN(d.hr)) {
      if (d.hr <= 30) { metReasons.push(`HR ${d.hr} <=30 (MET)`); breakdown.hr = 'MET'; }
      else if (d.hr >= 140) { metReasons.push(`HR ${d.hr} >=140 (MET)`); breakdown.hr = 'MET'; }
      else if (d.hr >= 31 && d.hr <= 40) { score += 3; breakdown.hr = 3; }
      else if (d.hr >= 41 && d.hr <= 50) { score += 2; breakdown.hr = 2; }
      else if (d.hr >= 51 && d.hr <= 99) { score += 0; breakdown.hr = 0; }
      else if (d.hr >= 100 && d.hr <= 109) { score += 1; breakdown.hr = 1; }
      else if (d.hr >= 110 && d.hr <= 120) { score += 2; breakdown.hr = 2; }
      else if (d.hr >= 121 && d.hr <= 129) { score += 1; breakdown.hr = 1; }
      else if (d.hr >= 130 && d.hr <= 139) { score += 3; breakdown.hr = 3; }
    }

    // Systolic BP
    if (!Number.isNaN(d.sbp)) {
      if (d.sbp <= 40) { metReasons.push(`SBP ${d.sbp} extreme low (MET)`); breakdown.sbp = 'MET'; }
      else if (d.sbp >= 221) { metReasons.push(`SBP ${d.sbp} >=221 (MET)`); breakdown.sbp = 'MET'; }
      else if (d.sbp >= 41 && d.sbp <= 50) { score += 3; breakdown.sbp = 3; }
      else if (d.sbp >= 51 && d.sbp <= 60) { score += 2; breakdown.sbp = 2; }
      else if (d.sbp >= 61 && d.sbp <= 70) { score += 1; breakdown.sbp = 1; }
      else if (d.sbp >= 71 && d.sbp <= 80) { score += 0; breakdown.sbp = 0; }
      else if (d.sbp >= 81 && d.sbp <= 90) { score += 3; breakdown.sbp = 3; }
      else if (d.sbp >= 91 && d.sbp <= 100) { score += 2; breakdown.sbp = 2; }
      else if (d.sbp >= 101 && d.sbp <= 110) { score += 1; breakdown.sbp = 1; }
      else if (d.sbp >= 111 && d.sbp <= 139) { score += 0; breakdown.sbp = 0; }
      else if (d.sbp >= 140 && d.sbp <= 180) { score += 1; breakdown.sbp = 1; }
      else if (d.sbp >= 181 && d.sbp <= 200) { score += 2; breakdown.sbp = 2; }
      else if (d.sbp >= 201 && d.sbp <= 220) { score += 3; breakdown.sbp = 3; }
    }

    // Temperature
    if (!Number.isNaN(d.temp)) {
      if (d.temp >= 39.1) { metReasons.push(`Temp ${d.temp} >=39.1 (MET)`); breakdown.temp = 'MET'; }
      else if (d.temp <= 35) { score += 3; breakdown.temp = 3; }
      else if (d.temp >= 35.1 && d.temp <= 36.0) { score += 1; breakdown.temp = 1; }
      else if (d.temp >= 36.1 && d.temp <= 37.5) { score += 0; breakdown.temp = 0; }
      else if (d.temp >= 37.6 && d.temp <= 38.0) { score += 1; breakdown.temp = 1; }
      else if (d.temp >= 38.1 && d.temp <= 39.0) { score += 2; breakdown.temp = 2; }
    }

    // Consciousness
    const c = (d.consciousness || '').toString().toLowerCase();
    if (c) {
      if (c === 'alert') { breakdown.consciousness = 0; score += 0; }
      else if (c === 'voice') { breakdown.consciousness = 1; score += 1; }
      else if (c === 'pain') { breakdown.consciousness = 2; score += 2; }
      else if (c === 'unresponsive') { metReasons.push('Unresponsive (MET)'); breakdown.consciousness = 'MET'; }
    }

    // Return structure
    return {
      score: score,
      metCall: metReasons.length > 0,
      metReasons,
      breakdown
    };
  }

  // ---------- Urine output mL/kg/hr ----------
  function urineMlPerKgPerHr(d) {
    if (!Number.isNaN(d.urineOutput) && !Number.isNaN(d.weight) && d.weight > 0) {
      const mlkg = d.urineOutput / d.weight;
      return round2(mlkg);
    }
    return null;
  }

  // ---------- Flag engine (Critical / Important) ----------
  function evaluateFlags(data) {
    // compute ADDS first
    const adds = calculateADDSFromData(data);

    const critical = [];
    const important = [];

    // CRITICAL predicates (any -> Cat1)
    // 1. ADDS MET trigger
    if (adds.metCall) critical.push('ADDS MET trigger: ' + (adds.metReasons.join('; ') || 'reasons'));
    // 2. Vasopressor/inotrope within last 24h
    if (data.vasopressor_recent) critical.push('Recent vasopressor/inotrope use');
    // 3. FiO2 >= 40% or device HFNP/NIV with low sats
    if (!Number.isNaN(data.fio2) && data.fio2 >= 40) critical.push(`FiO2 ${data.fio2}% >=40%`);
    const dev = (data.o2_device || '').toString().toLowerCase();
    if (dev.includes('hf') || dev.includes('niv') || dev.includes('high-flow')) {
      // treat HF/NIV as critical if SpO2 target not met or if device is in use
      if (Number.isNaN(data.spo2) || data.spo2 < 92) critical.push(`High-flow / NIV in use with SpO2 ${data.spo2 || 'N/A'}`);
      else critical.push('High-flow / NIV in use');
    }
    // 4. Lactate >=4 or rising rapidly
    if (!Number.isNaN(data.lactate) && data.lactate >= 4) critical.push(`Lactate ${data.lactate} >=4`);
    if (data.lactate_trend === 'worsening' && !Number.isNaN(data.lactate) && data.lactate >= 2) critical.push('Rising lactate (worsening trend)');
    // 5. Unresponsive / failing to protect airway
    if ((data.consciousness || '').toString().toLowerCase() === 'unresponsive') critical.push('Unresponsive / airway risk');
    if ((data.airway || '').toString().toLowerCase() === 'at risk') critical.push('Airway at risk');

    // IMPORTANT predicates
    // New/worsening renal dysfunction: creatinine rise >=26 µmol/L or >=1.5x baseline
    if (!Number.isNaN(data.creatinine)) {
      if (!Number.isNaN(data.creatinine_baseline) && (data.creatinine - data.creatinine_baseline >= 26 || data.creatinine >= 1.5 * data.creatinine_baseline)) {
        important.push('Rising creatinine / new renal dysfunction');
      } else if (data.creatinine_trend === 'worsening') {
        important.push('Creatinine trend worsening');
      }
    }
    // Hemodynamic instability
    if (!Number.isNaN(data.sbp) && data.sbp < 90) important.push('SBP <90 (hemodynamic instability)');
    if (!Number.isNaN(data.hr) && data.hr > 140) important.push('HR >140 (hemodynamic instability)');

    // Recent extubation within 24-48h with objective risk features
    if (data.recent_extubation) important.push('Recent extubation (24-48h) with risk features');

    // Platelets <50 or active bleeding
    if (!Number.isNaN(data.platelets) && data.platelets < 50) important.push('Platelets <50');
    if (data.active_bleeding) important.push('Active bleeding');

    // Delirium moderate-severe
    if (!Number.isNaN(data.delirium) && data.delirium >= 2) important.push('Delirium (mod-severe)');

    // Device / line infection risk
    if (data.cvad_present && data.cvad_site_health && data.cvad_site_health.toLowerCase() !== 'clean & healthy') important.push('CVAD site concern');
    if (data.pivc_1_present && data.pivc_1_site_health && data.pivc_1_site_health.toLowerCase() !== 'clean & healthy') important.push('PIVC site concern');

    // Oliguria: mL/kg/hr <0.5 with persistent/worsening trend
    const mlkg = urineMlPerKgPerHr(data);
    if (mlkg !== null && mlkg < 0.5 && (data.urine_output_trend === 'worsening' || data.urine_output_trend === 'persistent')) {
      important.push(`Oliguria ${mlkg} mL/kg/hr (persistent/worsening)`);
    } else if (mlkg !== null && mlkg < 0.5) {
      // single low reading -> still an important flag
      important.push(`Oliguria ${mlkg} mL/kg/hr`);
    }

    // FiO2 rapid change (wean then rise) OR worsening fio2 trend
    if (data.fio2_was_weaned_then_risen || data.fio2_trend === 'worsening') important.push('Rapid/unstable FiO2 changes');

    // Pain high despite analgesia could be an important flag
    if (!Number.isNaN(data.pain_score) && data.pain_score >= 7) important.push('Pain score 7-10 despite treatment');

    // After-hours is a strong modifier (per your local data)
    const afterHours = !!data.after_hours;

    // Category assignment (flag-only)
    // - Any critical -> RED
    // - Else if afterHours && any important -> RED
    // - Else if important count >=2 -> RED
    // - Else if important count === 1 -> AMBER
    // - Else GREEN
    let category = 'GREEN';
    if (critical.length > 0) category = 'RED';
    else if (afterHours && important.length > 0) category = 'RED';
    else if (important.length >= 2) category = 'RED';
    else if (important.length === 1) category = 'AMBER';
    else category = 'GREEN';

    // If any worsening trend present and category is AMBER, promote to RED
    const anyWorseTrend = Object.keys(data).some(k => k.endsWith('_trend') && data[k] === 'worsening');
    if (anyWorseTrend && category === 'AMBER') category = 'RED';

    return {
      category,
      critical,
      important,
      afterHours,
      adds // include ADDS details
    };
  }

  // ---------- DMR generation ----------
  function generateDMRText(data, evalResult) {
    const adds = evalResult.adds || { score: 0, metCall: false, metReasons: [], breakdown: {} };
    const mlkg = urineMlPerKgPerHr(data);
    const analgesia = data.analgesiaRegimen || '';
    const pain = Number.isFinite(data.pain_score) ? data.pain_score : 'N/A';

    // Bloods summary compact
    const bloods = [
      `Cr: ${Number.isFinite(data.creatinine) ? data.creatinine : '--'}`,
      `Lac: ${Number.isFinite(data.lactate) ? data.lactate : '--'}`,
      `Hb: ${Number.isFinite(data.hb) ? data.hb : '--'}`,
      `Plt: ${Number.isFinite(data.platelets) ? data.platelets : '--'}`,
      `CRP: ${Number.isFinite(data.crp) ? data.crp : '--'}`
    ].join(', ');

    const devicesSummary = [];
    if (data.pivc_1_present) devicesSummary.push(`PIVC1: ${data.pivc_1_site_health || 'present'}`);
    if (data.cvad_present) devicesSummary.push(`CVAD: ${data.cvad_site_health || 'present'}`);
    if (data.idc_present) devicesSummary.push('IDC present');
    if (devicesSummary.length === 0) devicesSummary.push('None');

    const criticalList = evalResult.critical.length ? evalResult.critical.join('; ') : 'None';
    const importantList = evalResult.important.length ? evalResult.important.join('; ') : 'None';

    // Compose DMR
    const lines = [];
    lines.push(`ALERT CNS ${data.review_type || 'post'} on ward ${data.location || ''}`);
    lines.push(`LOS: ${Number.isFinite(data.icu_los) ? data.icu_los : 'N/A'} days`);
    lines.push(`${evalResult.category}`);
    lines.push('');
    lines.push(`Patient ID: ${data.patient_id || 'N/A'} | Age: ${Number.isFinite(data.age) ? data.age : 'N/A'}`);
    lines.push('');
    // ICU fields
    if (data.icuReason) lines.push(`ICU Admission Reason: ${data.icuReason}`);
    if (data.icuSummary) lines.push(`ICU Summary: ${data.icuSummary}`);
    if (data.pmh) lines.push(`PMH: ${data.pmh}`);
    lines.push('');
    lines.push(`REASON FOR ICU: ${data.reason_icu || 'N/A'}`);
    lines.push('');
    lines.push(`A: Airway: ${data.airway || 'N/A'}`);
    lines.push(`B: RR ${Number.isFinite(data.rr) ? data.rr : 'N/A'}, SpO2 ${Number.isFinite(data.spo2) ? data.spo2 : 'N/A'} on ${data.o2_device || 'N/A'} (FiO2 ${Number.isFinite(data.fio2) ? data.fio2 + '%' : 'N/A'})`);
    lines.push(`C: HR ${Number.isFinite(data.hr) ? data.hr : 'N/A'}, BP ${Number.isFinite(data.sbp) ? data.sbp : 'N/A'}, CRT ${data.cap_refill || 'N/A'}, UO: ${mlkg !== null ? mlkg + ' mL/kg/hr' : 'N/A'}`);
    lines.push(`D: Consciousness: ${data.consciousness || 'N/A'}, Delirium: ${Number.isFinite(data.delirium) ? data.delirium : '0'}, Pain: ${pain}/10${analgesia ? ' (Analgesia: ' + analgesia + ')' : ''}`);
    lines.push(`E: Temp ${Number.isFinite(data.temp) ? data.temp + '°C' : 'N/A'}, Diet: ${safeVal('diet') || 'N/A'}`);
    lines.push('');
    lines.push(`DEVICES:`);
    devicesSummary.forEach(s => lines.push(`- ${s}`));
    lines.push('');
    lines.push(`BLOODS: ${bloods}`);
    lines.push('');
    lines.push(`Flags:`);
    lines.push(`- Critical: ${criticalList}`);
    lines.push(`- Important: ${importantList}`);
    lines.push(`- After-hours: ${data.after_hours ? 'Yes' : 'No'}`);
    lines.push('');
    lines.push(`ADDS score: ${adds.score} ${adds.metCall ? ' (MET triggered: ' + adds.metReasons.join('; ') + ')' : ''}`);
    lines.push('');
    lines.push(`IMP: ${safeVal('clinical_impression') || ''}`);
    lines.push('');
    lines.push(`Plan: ${safeVal('clinical_plan') || ''}`);

    return lines.join('\n');
  }

  // ---------- Handoff key generation ----------
  function generateHandoffKey() {
    const d = gatherFormData();
    // Selective handoff fields (include ICU fields)
    const handoffFields = [
      'review_type','location','room_number','patient_id','stepdown_date','weight','age','admission_type','icu_los','after_hours',
      'reason_icu','icuReason','icuSummary','pmh',
      'creatinine','creatinine_baseline','lactate','platelets','hb','crp',
      'fio2','o2_device','o2_flow','spo2','respiratoryRate','hr','systolicBP'
    ];
    const out = {};
    handoffFields.forEach(k => { if (d[k] !== undefined) out[k] = d[k]; });
    try {
      const key = btoa(JSON.stringify(out));
      return key;
    } catch (e) {
      console.error('Handoff encode failed', e);
      return null;
    }
  }

  // ---------- UI wiring ----------
  function updateAll() {
    const data = gatherFormData();
    const evalResult = evaluateFlags(data);
    // render summary to summary container if it exists
    const summaryEl = document.getElementById('summary-container');
    if (summaryEl) {
      // Build a brief html summary
      const catClass = evalResult.category === 'RED' ? 'category-red' : evalResult.category === 'AMBER' ? 'category-amber' : 'category-green';
      summaryEl.innerHTML = `
        <div class="summary-category ${catClass}">${evalResult.category}</div>
        <div style="margin-top:8px"><strong>Critical (${evalResult.critical.length}):</strong> ${evalResult.critical.length ? evalResult.critical.join('; ') : 'None'}</div>
        <div style="margin-top:6px"><strong>Important (${evalResult.important.length}):</strong> ${evalResult.important.length ? evalResult.important.join('; ') : 'None'}</div>
        <div style="margin-top:6px; font-size:0.9rem;"><strong>ADDS:</strong> ${evalResult.adds.score} ${evalResult.adds.metCall ? '(MET: '+evalResult.adds.metReasons.join('; ')+')' : ''}</div>
      `;
    }

    // Fill DMR textarea if present
    const emrEl = document.getElementById('emrSummary') || document.getElementById('dmrOutput');
    if (emrEl) {
      emrEl.value = generateDMRText(data, evalResult);
    }

    // Update footer (if sticky elements exist)
    const footerCategory = document.getElementById('footer-category');
    const footerCriticalCount = document.getElementById('footer-critical-count');
    const footerImportantCount = document.getElementById('footer-important-count');
    const footerFlagsRed = document.getElementById('footer-flags-red');
    const footerFlagsGreen = document.getElementById('footer-flags-green');

    if (footerCategory) footerCategory.textContent = evalResult.category;
    if (footerCriticalCount) footerCriticalCount.textContent = evalResult.critical.length;
    if (footerImportantCount) footerImportantCount.textContent = `Important: ${evalResult.important.length}`;
    if (footerFlagsRed) footerFlagsRed.innerHTML = `<span>🚩 ${evalResult.critical.length}</span>`;
    if (footerFlagsGreen) footerFlagsGreen.innerHTML = `<span>✅ ${evalResult.important.length}</span>`;

    // Save current state (simple localStorage snapshot)
    try {
      localStorage.setItem('alertTool_state_v1', JSON.stringify(document.getElementById('assessmentForm') ? new FormData(document.getElementById('assessmentForm')) : {}));
    } catch (e) { /* ignore storage errors */ }
  }

  // ---------- Copy DMR / Handoff interactions ----------
  function copyDMRToClipboard() {
    const emrEl = document.getElementById('emrSummary') || document.getElementById('dmrOutput');
    if (!emrEl) return alert('DMR element not found.');
    emrEl.select?.();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(emrEl.value).then(() => alert('DMR copied to clipboard'));
    } else {
      try {
        document.execCommand('copy');
        alert('DMR copied to clipboard (legacy method)');
      } catch (e) {
        alert('Could not copy DMR — please copy manually.');
      }
    }
  }

  function copyHandoffKeyToClipboard() {
    const key = generateHandoffKey();
    if (!key) return alert('Handoff key generation failed');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard'));
    } else {
      alert('Please copy the handoff key: ' + key);
    }
  }

  function pasteHandoffKeyAndLoad() {
    const pasteInput = document.getElementById('pasteDataInput');
    if (!pasteInput) return alert('Paste box not present in UI');
    const raw = pasteInput.value.trim();
    if (!raw) return alert('Paste a base64 handoff key into the box first');
    try {
      const json = JSON.parse(atob(raw));
      // set fields present in JSON back into DOM
      Object.keys(json).forEach(k => {
        const el = document.getElementById(k);
        if (el) {
          if (el.type === 'checkbox') el.checked = json[k] === true || json[k] === 'true';
          else el.value = json[k];
        }
      });
      // hide paste container
      const pc = document.getElementById('pasteContainer');
      if (pc) pc.style.display = 'none';
      updateAll();
      alert('Handoff loaded (some fields may be missing depending on your form)');
    } catch (e) {
      console.error(e);
      alert('Invalid handoff key');
    }
  }

  // ---------- DOM events ----------
  function initEventHandlers() {
    // When any input in the form changes, update evaluation
    const form = document.getElementById('assessmentForm');
    if (form) {
      form.addEventListener('input', updateAll);
      form.addEventListener('change', updateAll);
    } else {
      // fallback: re-evaluate on body input/change
      document.body.addEventListener('input', updateAll);
      document.body.addEventListener('change', updateAll);
    }

    // Buttons
    const copyBtn = document.getElementById('copySummaryButton');
    if (copyBtn) copyBtn.addEventListener('click', copyDMRToClipboard);

    const getHandoffBtn = document.getElementById('getHandoffKeyBtn');
    if (getHandoffBtn) getHandoffBtn.addEventListener('click', copyHandoffKeyToClipboard);

    const useHandoffBtn = document.getElementById('useHandoffKeyBtn');
    if (useHandoffBtn) useHandoffBtn.addEventListener('click', () => {
      const pasteContainer = document.getElementById('pasteContainer');
      if (pasteContainer) pasteContainer.style.display = pasteContainer.style.display === 'block' ? 'none' : 'block';
    });

    const loadPasteBtn = document.getElementById('loadPastedDataBtn');
    if (loadPasteBtn) loadPasteBtn.addEventListener('click', pasteHandoffKeyAndLoad);

    const startOverBtn = document.getElementById('startOverBtn');
    if (startOverBtn) startOverBtn.addEventListener('click', () => {
      if (confirm('Clear form?')) {
        const f = document.getElementById('assessmentForm');
        if (f) f.reset();
        updateAll();
      }
    });
  }

  // ---------- Boot ----------
  function boot() {
    initEventHandlers();
    // initial evaluation
    setTimeout(updateAll, 50);
  }

  // run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // expose some functions for debugging if console open
  window._ALERTTool = {
    gatherFormData,
    calculateADDSFromData,
    evaluateFlags,
    generateDMRText,
    generateHandoffKey
  };

})();
