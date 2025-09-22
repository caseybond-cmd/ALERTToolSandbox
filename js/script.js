
// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
  // --- STATE & CONFIG ---
  let currentReview = {};
  const form = document.getElementById('assessmentForm');
  const p = (val) => {
    const n = parseFloat(val);
    return isNaN(n) ? NaN : n;
  };

  const CATEGORIES = {
    RED: { text: 'CAT 1: RED', class: 'category-red' },
    AMBER: { text: 'CAT 2: AMBER', class: 'category-amber' },
    GREEN: { text: 'CAT 3: GREEN', class: 'category-green' }
  };

  // --- Flag definitions (editable) ---
  // Critical flags: any = Cat1
  const CRITICAL_PREDICATES = [
    // ADDS MET handled separately (calculated)
    { id: 'vasopressor_recent', label: 'Vasopressor or inotrope within last 24h', test: (d) => !!d.vasopressor_recent },
    { id: 'fio2_high', label: 'FiO2 >= 40% OR HFNP/NIV dependence', test: (d) => {
        const fio2 = p(d.fio2); const device = d.o2_device || '';
        if (!isNaN(fio2) && fio2 >= 40) return true;
        if (['HFNP','NIV'].includes(device)) {
          // If HFNP/NIV but SpO2 still low or device listed, consider critical if SpO2 < 92 or device in use
          if (p(d.spo2) < 92 || device) return true;
        }
        return false;
      }},
    { id: 'lactate_high', label: 'Lactate >= 4 mmol/L OR rapidly rising lactate', test: (d) => {
        if (!isNaN(p(d.lactate)) && p(d.lactate) >= 4) return true;
        return d.lactate_trend === 'worsening' && !isNaN(p(d.lactate)) && p(d.lactate) >= 2.0;
      }},
    { id: 'unresponsive', label: 'Unresponsive / rapidly deteriorating consciousness', test: (d) => (d.consciousness === 'Unresponsive') },
    { id: 'airway_risk', label: 'Active airway risk (recent intubation/failed extubation / inability to protect airway)', test: (d) => d.airway === 'At Risk' || d.airway === 'Tracheostomy' },
    { id: 'met_call', label: 'ADDS/MET call triggered', test: (d, adds) => adds && adds.metCall === true }
  ];

  // Important flags: 1 -> Cat2 ; >=2 -> Cat1 (or after-hours modifier)
  const IMPORTANT_PREDICATES = [
    { id: 'creatinine_delta', label: 'New/worsening renal dysfunction (rise >=26 µmol/L or >=1.5x baseline)', test: (d) => d.creatinine_trend === 'worsening' || (!isNaN(p(d.creatinine)) && !isNaN(p(d.creatinine_baseline)) && (p(d.creatinine) - p(d.creatinine_baseline) >= 26 || p(d.creatinine) >= 1.5 * p(d.creatinine_baseline))) },
    { id: 'hemodynamic_instability', label: 'Significant haemodynamic instability (SBP <90 or persistent HR>140)', test: (d) => (!isNaN(p(d.sbp)) && p(d.sbp) < 90) || (!isNaN(p(d.hr)) && p(d.hr) > 140) },
    { id: 'recent_extubation', label: 'Recent extubation (24-48h) with objective risk features', test: (d) => d.recent_extubation === true || d.recent_extubation === 'yes' },
    { id: 'platelets_low', label: 'Platelets < 50 x10^9/L or active bleeding', test: (d) => !isNaN(p(d.platelets)) && p(d.platelets) < 50 || d.active_bleeding === true },
    { id: 'delirium_mod', label: 'Delirium (moderate-severe) or rapidly worsening mental state', test: (d) => p(d.delirium) >= 2 || d.consciousness === 'Voice' && d.delirium === '1' },
    { id: 'device_infection_risk', label: 'Device/line site concern (CVAD/PIVC site infection or rising inflammatory markers + device)', test: (d) => (d.cvad_present && d.cvad_site_health && d.cvad_site_health !== 'Clean & Healthy') || (d.pivc_1_present && d.pivc_1_site_health && d.pivc_1_site_health !== 'Clean & Healthy') },
    { id: 'oliguria_persistent', label: 'Oliguria persistent (<0.5 mL/kg/hr for >6h) or trend worsening', test: (d) => {
        if (!isNaN(p(d.urine_output_hr)) && !isNaN(p(d.weight)) && p(d.weight)>0) {
          const mlkg = p(d.urine_output_hr) / p(d.weight);
          return mlkg < 0.5 && d.urine_output_trend === 'worsening';
        }
        // If trend indicates persistent oliguria
        return d.urine_output_trend === 'worsening' && !isNaN(p(d.urine_output_hr)) && p(d.urine_output_hr) > 0;
      }},
    { id: 'fio2_rapid_change', label: 'Rapid FiO2 changes (wean then increase) or worsening FiO2 trend', test: (d) => d.fio2_trend === 'worsening' || d.fio2_pattern === 'wean_then_rise' }
  ];

  // --- Initialization ---
  function initializeApp() {
    populateStaticContent();
    setupEventListeners();
    const saved = localStorage.getItem('alertToolState_v_flag_v1');
    if (saved) {
      currentReview = JSON.parse(saved);
      loadReviewData();
    } else {
      updateRiskAssessment();
    }
  }

  // --- Data helpers ---
  function gatherFormData() {
    const data = {};
    form.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return;
      if (el.type === 'checkbox') data[el.id] = el.checked;
      else data[el.id] = el.value;
    });
    document.querySelectorAll('.trend-radio-group').forEach(group => {
      const checked = group.querySelector('input[type="radio"]:checked');
      if (checked) data[group.dataset.trendId] = checked.value;
    });
    // convenience booleans for some fields that may not exist in all forms
    data.vasopressor_recent = data.vasopressor_recent || false;
    return data;
  }

  function saveState() {
    currentReview = gatherFormData();
    localStorage.setItem('alertToolState_v_flag_v1', JSON.stringify(currentReview));
  }

  function loadReviewData(isHandoff = false) {
    Object.keys(currentReview).forEach(key => {
      const el = form.querySelector(`#${key}`);
      if (el) {
        if (el.type === 'checkbox') el.checked = currentReview[key];
        else el.value = currentReview[key];
      } else if (key.endsWith('_trend')) {
        const radios = document.querySelectorAll(`input[name="${key}_radio"]`);
        radios.forEach(r => { if (r.value === currentReview[key]) r.checked = true; });
      }
    });
    updateRiskAssessment();
    // trigger UI updates
    form.querySelectorAll('input[type="date"], input[id*="present"], select[id*="present"], #diet, #cap_refill').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    document.getElementById('pain_score')?.dispatchEvent(new Event('input'));
  }

  function clearForm() {
    form.reset();
    localStorage.removeItem('alertToolState_v_flag_v1');
    currentReview = {};
    updateRiskAssessment();
  }

  // --- ADDS calculation (reused to detect MET triggers, unchanged logic) ---
  function calculateADDS(data) {
    // Use your existing ADDS logic but return object with metCall boolean and reasons.
    let score = 0, metCall = false, metReason = '', reasons = [];
    const getScore = (val, ranges, paramName) => {
      for (const r of ranges) {
        if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
          if (r.score === 'E') return { metCall: true, metReason: r.note || `${paramName} MET` };
          if (r.score > 0) reasons.push(`${paramName} abnormal (${val})`);
          return { score: r.score };
        }
      }
      return { score: 0 };
    };
    const checkParam = (value, ranges, paramName) => {
      if (isNaN(value) || metCall) return;
      const result = getScore(value, ranges, paramName);
      if (result.metCall) { metCall = true; metReason = result.metReason; }
      else { score += result.score; }
    };

    checkParam(p(data.rr), [{min:-Infinity,max:4,score:'E',note:'<=4 => MET'},{min:5,max:8,score:3},{min:9,max:10,score:2},{min:11,max:20,score:0},{min:21,max:24,score:1},{min:25,max:30,score:2},{min:31,max:35,score:3},{min:36,max:Infinity,score:'E',note:'>=36 => MET'}], 'Resp Rate');
    if (data.rr_trend === 'worsening') reasons.push('Worsening Resp Rate trend');

    checkParam(p(data.spo2), [{min:-Infinity,max:84,score:'E',note:'<=84 => MET'},{min:85,max:88,score:3},{min:89,max:90,score:2},{min:91,max:93,score:1},{min:94,max:Infinity,score:0}], 'SpO2');
    if (data.spo2_trend === 'worsening') reasons.push('Worsening SpO2 trend');

    checkParam(p(data.hr), [{min:-Infinity,max:30,score:'E',note:'<=30 => MET'},{min:31,max:40,score:3},{min:41,max:50,score:2},{min:51,max:99,score:0},{min:100,max:109,score:1},{min:110,max:120,score:2},{min:121,max:129,score:1},{min:130,max:139,score:3},{min:140,max:Infinity,score:'E',note:'>=140 => MET'}], 'Heart Rate');
    if (data.hr_trend === 'worsening') reasons.push('Worsening Heart Rate trend');

    checkParam(p(data.sbp), [{min:-Infinity,max:40,score:'E',note:'extreme low -> MET'},{min:41,max:50,score:3},{min:51,max:60,score:2},{min:61,max:70,score:1},{min:71,max:80,score:0},{min:81,max:90,score:3},{min:91,max:100,score:2},{min:101,max:110,score:1},{min:111,max:139,score:0},{min:140,max:180,score:1},{min:181,max:200,score:2},{min:201,max:220,score:3},{min:221,max:Infinity,score:'E',note:'>=221 => MET'}], 'Systolic BP');
    if (data.sbp_trend === 'worsening') reasons.push('Worsening BP trend');

    checkParam(p(data.temp), [{min:-Infinity,max:35,score:3},{min:35.1,max:36.0,score:1},{min:36.1,max:37.5,score:0},{min:37.6,max:38.0,score:1},{min:38.1,max:39.0,score:2},{min:39.1,max:Infinity,score:'E',note:'>=39.1 => MET'}], 'Temperature');
    if (data.temp_trend === 'worsening') reasons.push('Worsening Temperature trend');

    if (data.consciousness === 'Unresponsive') { metCall = true; metReason = 'Unresponsive'; }
    else if (data.consciousness === 'Pain') { score += 2; reasons.push('Responds to Pain'); }
    else if (data.consciousness === 'Voice') { score += 1; reasons.push('Responds to Voice'); }

    if (data.o2_device === 'HFNP') reasons.push('Using High-Flow O₂');
    checkParam(p(data.o2_flow), [{min:0,max:5,score:0},{min:6,max:7,score:1},{min:8,max:9,score:2},{min:10,max:Infinity,score:3}], 'O₂ Flow');
    checkParam(p(data.fio2), [{min:0,max:27,score:0},{min:28,max:39,score:2},{min:40,max:Infinity,score:3}], 'FiO2');
    if (data.o2_flow_trend === 'worsening') reasons.push('Worsening O₂ Flow trend');
    if (data.fio2_trend === 'worsening') reasons.push('Worsening FiO2 trend');

    return { score, metCall, metReason, reasons };
  }

  // --- Core: Flag engine (no numeric scoring) ---
  function evaluateFlags(data) {
    const adds = calculateADDS(data);

    // compute critical flags
    const critical = [];
    CRITICAL_PREDICATES.forEach(pred => {
      try {
        const hit = pred.id === 'met_call' ? pred.test(data, adds) : pred.test(data);
        if (hit) critical.push(pred.label);
      } catch (e) { /* ignore predicate error */ }
    });

    // compute important flags
    const important = [];
    IMPORTANT_PREDICATES.forEach(pred => {
      try {
        if (pred.test(data)) important.push(pred.label);
      } catch (e) { /* ignore */ }
    });

    // special local-finding: after-hours modifier (your local data: 80% of readmissions after-hours)
    const afterHours = !!data.after_hours;

    // Determine category logic:
    // - If any critical -> Cat1
    // - Else if (afterHours && any important) -> Cat1
    // - Else if important count >= 2 -> Cat1
    // - Else if important count == 1 -> Cat2
    // - Else -> Cat3
    let categoryKey = 'GREEN';
    if (critical.length > 0) categoryKey = 'RED';
    else if (afterHours && important.length > 0) categoryKey = 'RED';
    else if (important.length >= 2) categoryKey = 'RED';
    else if (important.length === 1) categoryKey = 'AMBER';
    else categoryKey = 'GREEN';

    // Also compute "worsening trend" promotion: if any important flag has an associated trend 'worsening', promote to RED
    const hasWorsening = Object.keys(data).some(k => k.endsWith('_trend') && data[k] === 'worsening' && k !== 'adds_override_score');
    if (hasWorsening && categoryKey === 'AMBER') categoryKey = 'RED';

    return { categoryKey, critical, important, afterHours, adds, hasWorsening };
  }

  // --- Presentation ---
  function displayResults(result, data) {
    const category = CATEGORIES[result.categoryKey];
    const summaryContainer = document.getElementById('summary-container');
    const footerCategory = document.getElementById('footer-category');
    const footerCriticalCount = document.getElementById('footer-critical-count');
    const footerImportantCount = document.getElementById('footer-important-count');
    const footerRedFlags = document.getElementById('footer-flags-red');
    const footerGreenFlags = document.getElementById('footer-flags-green');
    const stickyFooter = document.getElementById('sticky-footer');

    document.getElementById('footer-location').textContent = `${data.location || 'N/A'} - ${data.room_number || 'N/A'}`;
    const reason = data.reason_icu || 'No reason entered';
    document.getElementById('footer-reason').textContent = reason.length > 60 ? reason.substring(0, 60) + '...' : reason;

    footerCategory.textContent = category.text;
    footerCriticalCount.textContent = result.critical.length;
    footerImportantCount.textContent = `Important: ${result.important.length}`;

    stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex flex-col z-40 ${category.class}`;
    footerRedFlags.innerHTML = `<span>🚩 ${result.critical.length}</span>`;
    footerGreenFlags.innerHTML = `<span>✅ ${result.important.length}</span>`;

    // Build summary HTML
    const criticalHtml = result.critical.length ? `<ul class="list-disc list-inside text-sm text-gray-700">${result.critical.map(f => `<li>${f}</li>`).join('')}</ul>` : '<div class="text-sm text-gray-500">None</div>';
    const importantHtml = result.important.length ? `<ul class="list-disc list-inside text-sm text-gray-700">${result.important.map(f => `<li>${f}</li>`).join('')}</ul>` : '<div class="text-sm text-gray-500">None</div>';
    const afterHoursHtml = result.afterHours ? '<div class="mt-2 text-sm text-yellow-700 font-semibold">After-hours discharge — local modifier applied</div>' : '';

    // ADDS reasons if present
    const addsReasons = (result.adds && result.adds.reasons && result.adds.reasons.length) ? `<div class="mt-2 text-sm text-gray-700"><strong>ADDS reasons:</strong><ul class="list-disc list-inside">${result.adds.reasons.map(r => `<li>${r}</li>`).join('')}</ul></div>` : '';

    const plan = generateActionPlan(result.categoryKey, result.critical, result.important);

    summaryContainer.innerHTML = `
      <div class="summary-category ${category.class}">${category.text}</div>
      ${afterHoursHtml}
      ${addsReasons}
      <div class="summary-flags-container mt-4"><div><h4 class="flag-list-red">Critical Flags (${result.critical.length}):</h4>${criticalHtml}</div><div><h4 class="flag-list-green">Important Flags (${result.important.length}):</h4>${importantHtml}</div></div>
      <div class="summary-plan mt-4"><h4>Recommended Action Plan:</h4><p class="text-sm">${plan}</p></div>
    `;
  }

  // --- Action plan generator (concise, editable) ---
  function generateActionPlan(categoryKey, criticalFlags, importantFlags) {
    switch (categoryKey) {
      case 'RED':
        let redPlan = 'Cat 1: Daily senior review for 72 hrs. Escalate immediately to ICU liaison/medical team if any deterioration.';
        if (criticalFlags.some(f => f.toLowerCase().includes('lactate'))) redPlan += ' Repeat lactate as clinically indicated (e.g., within 6 hrs).';
        if (criticalFlags.some(f => f.toLowerCase().includes('fio2'))) redPlan += ' Review respiratory support and consider review by respiratory/ICU.';
        if (importantFlags.some(f => f.toLowerCase().includes('creatinine'))) redPlan += ' Consider renal review and repeat serum creatinine.';
        return redPlan;
      case 'AMBER':
        return 'Cat 2: Enhanced ward monitoring q24–48 hrs for 72 hrs; nurse-led observations and early MDT review if any trend worsens.';
      default:
        return 'Cat 3: Routine ward care. Single check within 24 hrs and include DMR notes.';
    }
  }

  // --- DMR summary (keeps your prior format but uses flags) ---
  function generateDMRSummary() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    const uopSummary = computeUOPSummary(data);
    const bloodsSummary = [
      {id:'creatinine',name:'Cr'}, {id:'lactate',name:'Lac'}, {id:'hb',name:'Hb'},
      {id:'platelets',name:'Plt'}, {id:'albumin',name:'Alb'}, {id:'crp',name:'CRP'}
    ].map(b => {
      const val = data[b.id] || '--', trend = data[`${b.id}_trend`], arrow = trend === 'improving' ? '↑' : trend === 'worsening' ? '↓' : '→';
      return `${b.name} ${val}${trend ? `(${arrow})` : ''}`;
    }).join(', ');

    const devicesSummary = [];
    if (data.pivc_1_present) devicesSummary.push(`PIVC1: ${data.pivc_1_site_health || 'N/A'} (Dwell ${document.getElementById('pivc_1_dwell_time')?.textContent || 'N/A'}d)`);
    if (data.cvad_present) devicesSummary.push(`CVAD: ${data.cvad_type || 'N/A'} ${data.cvad_site_health || ''}`);
    if (data.idc_present) devicesSummary.push('IDC present');
    if (devicesSummary.length === 0) devicesSummary.push('None');

    const categoryText = CATEGORIES[result.categoryKey].text;

    const summary = `
ALERT CNS ${data.review_type || 'post'} on ward ${data.location || ''} 
LOS: ${data.icu_los || 'N/A'} days
${categoryText}

Patient ID: ${data.patient_id || 'N/A'} | Age: ${data.age || 'N/A'}

REASON FOR ICU: ${data.reason_icu || 'N/A'}

ICU SUMMARY: ${data.icu_summary || 'N/A'}

A: Airway: ${data.airway || 'N/A'}
B: RR ${data.rr || 'N/A'}, SpO2 ${data.spo2 || 'N/A'} on ${data.o2_device || 'N/A'} (FiO2 ${data.fio2 || 'N/A'}%)
C: HR ${data.hr || 'N/A'}, BP ${data.sbp || 'N/A'}/${data.dbp || 'N/A'}, CRT ${data.cap_refill || 'N/A'}, UO: ${uopSummary}
D: Consciousness: ${data.consciousness || 'N/A'}, Delirium: ${data.delirium || '0'}, Pain: ${data.pain_score || 'N/A'}/10
E: Temp ${data.temp || 'N/A'}°C, Diet: ${data.diet || 'N/A'}

DEVICES:
- ${devicesSummary.join('\n- ')}

BLOODS:
${bloodsSummary}

Flags:
- Critical: ${result.critical.length ? result.critical.join('; ') : 'None'}
- Important: ${result.important.length ? result.important.join('; ') : 'None'}
- After-hours: ${result.afterHours ? 'Yes' : 'No'}

IMP:
${data.clinical_impression || ''}

Plan:
${data.clinical_plan || generateActionPlan(result.categoryKey, result.critical, result.important)}
`.trim();

    document.getElementById('emrSummary').value = summary;
  }

  function computeUOPSummary(data) {
    const weight = p(data.weight);
    const uop_hr = p(data.urine_output_hr);
    if (!isNaN(weight) && weight > 0 && !isNaN(uop_hr)) {
      const mlkg = (uop_hr / weight).toFixed(2);
      return `${uop_hr} mL/hr (${mlkg} mL/kg/hr)`;
    } else if (!isNaN(uop_hr)) {
      return `${uop_hr} mL/hr`;
    }
    return 'N/A';
  }

  // --- Core orchestrator ---
  function updateRiskAssessment() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    displayResults(result, data);
    saveState();
    generateDMRSummary();
  }

  // --- Event wiring & UI helpers (retain your existing UI behavior) ---
  function setupEventListeners() {
    const toggleReviewBtn = document.getElementById('toggle-full-review-btn');
    let isQuickView = false;
    toggleReviewBtn?.addEventListener('click', () => {
      isQuickView = !isQuickView;
      toggleReviewBtn.textContent = isQuickView ? 'Expand to Full Review' : 'Collapse to Quick Score';
      document.querySelectorAll('.full-review-item').forEach(el => el.style.display = isQuickView ? 'none' : '');
    });

    document.getElementById('useHandoffKeyBtn')?.addEventListener('click', () => {
      const pasteContainer = document.getElementById('pasteContainer');
      pasteContainer.style.display = pasteContainer.style.display === 'block' ? 'none' : 'block';
    });

    document.getElementById('loadPastedDataBtn')?.addEventListener('click', () => {
      const pasted = document.getElementById('pasteDataInput').value;
      if (!pasted) return;
      try {
        currentReview = JSON.parse(atob(pasted));
        loadReviewData(true);
        document.getElementById('pasteContainer').style.display = 'none';
        document.getElementById('pasteDataInput').value = '';
      } catch (e) { alert('Invalid handoff key.'); }
    });

    document.getElementById('startOverBtn')?.addEventListener('click', () => {
      if (confirm('Are you sure? This will clear all data.')) clearForm();
    });

    form.addEventListener('input', updateRiskAssessment);
    form.addEventListener('change', updateRiskAssessment);

    document.getElementById('copySummaryButton')?.addEventListener('click', () => {
      const summaryEl = document.getElementById('emrSummary');
      summaryEl.select();
      summaryEl.setSelectionRange(0, 99999);
      document.execCommand('copy');
      alert('DMR Summary Copied to Clipboard!');
    });

    document.getElementById('getHandoffKeyBtn')?.addEventListener('click', () => {
      const data = gatherFormData();
      const handoffFields = ['review_type','location','room_number','patient_id','stepdown_date','weight','age','admission_type','icu_los','after_hours','reason_icu','icu_summary','pmh','severe_comorbidities','creatinine','creatinine_trend','lactate','lactate_trend','platelets','platelets_trend','hb','hb_trend','fio2','fio2_trend'];
      const handoffData = {};
      handoffFields.forEach(id => { if (data.hasOwnProperty(id)) handoffData[id] = data[id]; });
      const key = btoa(JSON.stringify(handoffData));
      navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
    });

    // show/hide O2 flow and FiO2 containers (same as original)
    const o2DeviceEl = document.getElementById('o2_device');
    if (o2DeviceEl) {
      o2DeviceEl.addEventListener('change', (e) => {
        const device = e.target.value;
        document.getElementById('o2_flow_container').classList.toggle('hidden', !['NP', 'HFNP', 'NIV'].includes(device));
        document.getElementById('fio2_container').classList.toggle('hidden', !['HFNP', 'NIV'].includes(device));
        document.getElementById('peep_ps_container').classList.toggle('hidden', device !== 'NIV');
      });
    }

    // other UI toggles copied from your original file
    const assessmentContainer = document.getElementById('assessment-section');
    assessmentContainer?.addEventListener('change', (e) => {
      const handlers = {
        'diet': () => { document.getElementById('diet_other_container')?.classList.toggle('hidden', e.target.value !== 'Other (specify)'); },
        'cap_refill': () => { document.getElementById('crt_details_container')?.classList.toggle('hidden', e.target.value !== '>3s'); },
      };
      if (handlers[e.target.id]) handlers[e.target.id]();
    });

    assessmentContainer?.addEventListener('input', (e) => {
      if (e.target.id === 'pain_score') {
        const val = p(e.target.value);
        document.getElementById('pain_interventions_container')?.classList.toggle('hidden', isNaN(val) || val <= 0);
      }
    });

    // device dwell time calculator (same idea as original)
    const devicesContainer = document.getElementById('devices-section');
    const calculateDwellTime = (startDate, displayElId) => {
      const displayEl = document.getElementById(displayElId);
      if (!startDate || !displayEl) { if (displayEl) displayEl.textContent = 'N/A'; return; }
      const start = new Date(startDate);
      const today = new Date();
      const diffTime = Math.abs(today - start);
      const diffDays = Math.ceil(diffTime / (1000*60*60*24));
      displayEl.textContent = diffDays;
    };
    devicesContainer?.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id.endsWith('_present')) {
        const detailsId = id.replace('_present','_details_container');
        document.getElementById(detailsId)?.classList.toggle('hidden', !e.target.checked);
      }
      if (id.endsWith('_commencement_date')) {
        const dwellId = id.replace('_commencement_date','_dwell_time');
        calculateDwellTime(e.target.value,dwellId);
      }
    });
  }

  // --- UI population (reuses your dynamic form structure) ---
 function populateStaticContent() {
        const createBloodInput = (label, id) => {
            let specialHtml = '';
            if (id === 'glucose') {
                return `<div class="blood-score-item"><label class="font-medium text-sm">${label}:</label><label class="text-sm flex items-center mt-1"><input type="checkbox" id="glucose_control" class="input-checkbox !h-5 !w-5">Poorly Controlled</label></div>`;
            }
             if (id === 'k' || id === 'mg') {
                specialHtml = `<div id="${id}_replacement_container" class="hidden mt-2 full-review-item"><label class="text-xs">Replacement/Action:<textarea id="${id}_replacement" rows="1" class="input-field"></textarea></label></div>`;
            }
            return `<div class="blood-score-item"><label class="font-medium text-sm">${label}:<input type="number" step="0.1" id="${id}" class="input-field" placeholder="Current"></label><div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Improving"><input type="radio" name="${id}_trend_radio" value="improving"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Worsening"><input type="radio" name="${id}_trend_radio" value="worsening"><span>↓</span></label></div>${specialHtml}</div>`;
        };
        const createTrendButtons = (id) => `<div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Improving"><input type="radio" name="${id}_trend_radio" value="improving"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Worsening"><input type="radio" name="${id}_trend_radio" value="worsening"><span>↓</span></label></div>`;
            
document.querySelector('#patient-details-section').innerHTML = `<details class="form-section desktop-only" open><summary>Patient & Review Details</summary><div class="form-section-content"><div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm"><label>Review Type:<select id="review_type" class="input-field"><option value="post">Post-ICU stepdown review</option><option value="pre">Pre-ICU stepdown review</option></select></label><div class="grid grid-cols-2 gap-4"><label>Location (Ward):<select id="location" class="input-field"><option value="" disabled selected>Select a Ward</option><optgroup label="Towers"><option>3A</option><option>3B</option><option>3C</option><option>3D</option><option>4A</option><option>4B</option><option>4C</option><option>4D</option><option>5A</option><option>5B</option><option>5C</option><option>5D</option><option>6A</option><option>6B</option><option>6C</option><option>6D</option><option>7A</option><option>7B</option><option>7C</option><option>7D</option><option>CCU</option></optgroup><optgroup label="Medihotel"><option>Medihotel 5</option><option>Medihotel 6</option><option>Medihotel 7</option><option>Medihotel 8</option></optgroup><optgroup label="SRS"><option>SRS 1A</option><option>SRS 2A</option><option>SRS A</option><option>SRS B</option></optgroup><optgroup label="Mental Health"><option>Mental Health Adult</option><option>Mental Health Youth</option></optgroup></select></label><label>Room No.:<input type="text" id="room_number" class="input-field"></label></div><label class="full-review-item">Patient ID (Initials + URN):<input type="text" id="patient_id" class="input-field"></label><label class="full-review-item">Stepdown Date:<input type="date" id="stepdown_date" class="input-field"></label><label>Weight (kg):<input type="number" id="weight" class="input-field" placeholder="e.g., 75"></label><label>Age:<input type="number" id="age" class="input-field" placeholder="Years"></label><label>Admission Type:<select id="admission_type" class="input-field"><option value="0">Elective Surgical</option><option value="1">Emergency Surgical</option><option value="2">Medical/ED</option></select></label><label>ICU LOS (days):<input type="number" id="icu_los" class="input-field" placeholder="Days"></label><label class="flex items-center pt-6 full-review-item"><input type="checkbox" id="after_hours" class="input-checkbox"> After-Hours Discharge</label></div></div></details>`;
        document.querySelector('#bloods-section').innerHTML = `<details class="form-section" open><summary>Scorable Blood Panel</summary><div class="form-section-content"><div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">${createBloodInput('Creatinine (µmol/L)', 'creatinine')}${createBloodInput('Lactate (mmol/L)', 'lactate')}${createBloodInput('Hb (g/L)', 'hb')}${createBloodInput('Platelets (x10⁹/L)', 'platelets')}${createBloodInput('Albumin (g/L)', 'albumin')}${createBloodInput('CRP (mg/L)', 'crp')}${createBloodInput('Glucose', 'glucose')}${createBloodInput('K+ (mmol/L)', 'k')}${createBloodInput('Mg++ (mmol/L)', 'mg')}</div></div></details>`;
        
        document.getElementById('assessment-section').innerHTML = `<details class="form-section" open><summary>A-E Assessment & Context</summary><div class="form-section-content">
            <h3 class="assessment-section-title">Core Vitals (ADDS Entry)</h3>
            <div class="assessment-grid" style="align-items: end;">
                <div><label>Resp Rate:</label><div class="flex items-center gap-2"><input type="number" id="rr" class="input-field">${createTrendButtons('rr')}</div></div>
                <div><label>SpO2 (%):</label><div class="flex items-center gap-2"><input type="number" id="spo2" class="input-field">${createTrendButtons('spo2')}</div></div>
                <div><label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><div id="o2_flow_container" class="hidden flex items-center gap-2"><label class="text-xs w-full">Flow (L/min):<input type="number" id="o2_flow" class="input-field"></label>${createTrendButtons('o2_flow')}</div><div id="fio2_container" class="hidden flex items-center gap-2"><label class="text-xs w-full">FiO2 (%):<input type="number" id="fio2" class="input-field"></label>${createTrendButtons('fio2')}</div><div id="peep_ps_container" class="hidden grid grid-cols-2 gap-2"><label class="text-xs">PEEP:<input type="number" id="peep" class="input-field"></label><label class="text-xs">PS:<input type="number" id="ps" class="input-field"></label></div></div>
                <div><label>Heart Rate:</label><div class="flex items-center gap-2"><input type="number" id="hr" class="input-field">${createTrendButtons('hr')}</div></div>
                <div><label>Systolic BP:</label><div class="flex items-center gap-2"><input type="number" id="sbp" class="input-field">${createTrendButtons('sbp')}</div></div>
                <label>Diastolic BP:<input type="number" id="dbp" class="input-field"></label>
                <div><label>Temperature (°C):</label><div class="flex items-center gap-2"><input type="number" step="0.1" id="temp" class="input-field">${createTrendButtons('temp')}</div></div>
                <label>Consciousness:<select id="consciousness" class="input-field"><option value="Alert">Alert</option><option value="Voice">Voice</option><option value="Pain">Pain</option><option value="Unresponsive">Unresponsive</option></select></label>
                <div class="lg:col-span-1">
                    <label>Pain Score (0-10):<input type="number" id="pain_score" class="input-field" min="0" max="10"></label>
                    <div id="pain_interventions_container" class="hidden mt-2 space-y-2 full-review-item">
                        <label>Analgesia Regimen:<textarea id="analgesia_regimen" rows="2" class="input-field"></textarea></label>
                        <div id="aps_referral_container" class="hidden"><label class="flex items-center"><input type="checkbox" id="aps_referral" class="input-checkbox">APS Referral</label></div>
                    </div>
                </div>
            </div>
            <div class="mt-4 p-4 border rounded-lg full-review-item"><label class="font-medium text-sm">Vital Sign Modifications (MODS):</label><textarea id="mods_details" class="input-field" rows="2" placeholder="e.g., Target HR < 110, SBP > 90..."></textarea><div class="flex items-center mt-2"><input type="checkbox" id="adds_override_checkbox" class="input-checkbox"><label for="adds_override_checkbox" class="text-sm">Manually Override ADDS Score</label></div><div id="adds_override_score_container" class="hidden mt-2"><label class="text-sm">Override ADDS Score:<input type="number" id="adds_override_score" class="input-field w-24"></label></div></div>
            <div class="mt-6 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center relative"><div id="met-alert-container" class="met-alert absolute top-2 right-2"></div><span class="text-sm font-medium text-gray-500">ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>
            
            <div class="mt-6">
                <h3 class="assessment-section-title">Assessment Details</h3>
                <div class="assessment-grid">
                    <label>Airway:<select id="airway" class="input-field"><option>Patent</option><option>At Risk</option><option>Tracheostomy</option><option>Laryngectomy</option></select></label>
                    <div><label>Cap Refill:<select id="cap_refill" class="input-field"><option value="<3s">< 3 sec</option><option value=">3s">> 3 sec</option></select></label><div id="crt_details_container" class="hidden mt-2 full-review-item"><label class="text-xs">Details:<textarea id="crt_details" class="input-field" rows="1"></textarea></label></div></div>
                    <div class="grid grid-cols-2 gap-2 items-end"><label>Urine Output (last hr, mL):<input type="number" id="urine_output_hr" class="input-field"></label><label>mL/kg/hr:<input type="text" id="uop_ml_kg_hr_display" class="input-field bg-gray-100" readonly></label></div>
                    <label>Delirium:<select id="delirium" class="input-field"><option value="0">None</option><option value="1">Mild</option><option value="2">Mod-Severe</option></select></label>
                    <label>Mobility:<select id="mobility" class="input-field"><option>Independent</option><option>Supervision/Standby Assist</option><option>Requires Physical Assistance</option><option>Bedbound/Immobile</option></select></label>
                    <label>Frailty Score (CFS):<input type="number" id="frailty_score" class="input-field" min="1" max="9"></label>
                    <div class="full-review-item"><label>Bowels:<select id="bowels" class="input-field"><option>Normal</option><option>Formed</option><option>Diarrhoea</option><option>BNO</option></select></label></div>
                    <label class="full-review-item">Bowels Last Opened:<input type="date" id="bowels_last_opened" class="input-field"></label>
                    <div class="full-review-item"><label>Diet:<select id="diet" class="input-field"><option>Tolerating Full Diet</option><option>Tolerating Light Diet</option><option>Clear fluids</option><option>Nourishing fluids</option><option>Nausea / Vomiting</option><option>NBM</option><option>Other (specify)</option></select></label><div id="diet_other_container" class="hidden mt-2"><label>Specify Diet:<textarea id="diet_other" class="input-field" rows="1"></textarea></label></div></div>
                </div>
            </div>
        </div></details>`;
        
        document.getElementById('devices-section').innerHTML = `<details class="form-section"><summary>Devices</summary><div class="form-section-content"><div class="space-y-4">
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="pivc_1_present" class="input-checkbox">PIVC 1</label><div id="pivc_1_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><div class="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center"><label class="text-sm">Commencement Date:<input type="date" id="pivc_1_commencement_date" class="input-field"></label><label class="text-sm">Gauge:<select id="pivc_1_gauge" class="input-field"><option>24G</option><option>22G</option><option>20G</option><option>18G</option><option>16G</option></select></label><label class="text-sm">Site Health:<select id="pivc_1_site_health" class="input-field"><option>Clean & Healthy</option><option>Redness/Swelling</option><option>Signs of Infection</option><option>Occluded/Poor Function</option></select></label><div class="text-sm">Dwell Time: <span id="pivc_1_dwell_time" class="font-bold">N/A</span> days</div></div></div></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="pivc_2_present" class="input-checkbox">PIVC 2</label><div id="pivc_2_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><div class="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center"><label class="text-sm">Commencement Date:<input type="date" id="pivc_2_commencement_date" class="input-field"></label><label class="text-sm">Gauge:<select id="pivc_2_gauge" class="input-field"><option>24G</option><option>22G</option><option>20G</option><option>18G</option><option>16G</option></select></label><label class="text-sm">Site Health:<select id="pivc_2_site_health" class="input-field"><option>Clean & Healthy</option><option>Redness/Swelling</option><option>Signs of Infection</option><option>Occluded/Poor Function</option></select></label><div class="text-sm">Dwell Time: <span id="pivc_2_dwell_time" class="font-bold">N/A</span> days</div></div></div></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="cvad_present" class="input-checkbox">CVAD</label><div id="cvad_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center"><label class="text-sm">Type:<select id="cvad_type" class="input-field"><option>CVC</option><option>PICC</option><option>Vascath</option></select></label><label class="text-sm">Commencement Date:<input type="date" id="cvad_commencement_date" class="input-field"></label><div class="text-sm">Dwell Time: <span id="cvad_dwell_time" class="font-bold">N/A</span> days</div><label class="text-sm sm:col-span-2">Site Health:<select id="cvad_site_health" class="input-field"><option>Clean & Healthy</option><option>Redness/Swelling</option><option>Signs of Infection</option><option>Occluded/Poor Function</option></select></label></div></div></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="idc_present" class="input-checkbox">IDC</label><div id="idc_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><div class="grid grid-cols-1 sm:grid-cols-3 gap-4"><label class="text-sm">Commencement Date:<input type="date" id="idc_commencement_date" class="input-field"></label><div class="text-sm">Dwell Time: <span id="idc_dwell_time" class="font-bold">N/A</span> days</div></div></div></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="ng_tube_present" class="input-checkbox">NG Tube</label></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="nj_tube_present" class="input-checkbox">NJ Tube</label></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="drains_present" class="input-checkbox">Drains</label><div id="drains_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><label class="text-sm">24hr Output (mL):<input type="number" id="drain_output_24hr" class="input-field"></label><label class="text-sm">Cumulative Output (mL):<input type="number" id="drain_output_cumulative" class="input-field"></label></div></div></div>
                <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="wounds_present" class="input-checkbox">Wounds</label><div id="wounds_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2 full-review-item"><label class="text-sm">Description:<textarea id="wound_description" rows="2" class="input-field"></textarea></label></div></div>
                <div class="device-item full-review-item"><label class="flex items-center font-medium"><input type="checkbox" id="other_device_present" class="input-checkbox">Other Device</label><div id="other_device_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2"><label class="text-sm">Details:<textarea id="other_device_details" rows="2" class="input-field"></textarea></label></div></div>
            </div></div></details>`;
        
        document.getElementById('context-section').innerHTML = `<details class="form-section"><summary>Context & Overrides</summary><div class="form-section-content"><div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label class="font-medium text-sm">Ward Placement/Staffing (Reducer):</label><select id="ward_staffing" class="input-field"><option value="0">1:4+ Standard</option><option value="-0.5">1:3</option><option value="-1">1:2</option><option value="-2">1:1</option><option value="-1">Monitored Bed</option></select></div>
                <div class="sm:col-span-2 full-review-item"><label class="font-medium text-sm">General Notes (for DMR):</label><textarea id="general_notes" class="input-field" rows="2" placeholder="Note any other relevant context for the DMR summary..."></textarea></div>
                <div class="sm:col-span-2 full-review-item">
                    <label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Category Upgrade - Clinical Concern</label>
                    <textarea id="override_reason" class="input-field mt-2" placeholder="Reason for upgrade..."></textarea>
                </div>
                 <div class="sm:col-span-2 full-review-item">
                    <label class="flex items-center"><input type="checkbox" id="manual_downgrade" class="input-checkbox"> Manual Category Downgrade</label>
                    <div id="downgrade_details_container" class="hidden mt-2">
                        <label>New Category:<select id="manual_downgrade_category" class="input-field mb-2"><option value="AMBER">Amber</option><option value="GREEN">Green</option></select></label>
                        <textarea id="downgrade_reason" class="input-field" placeholder="Reason for downgrade is mandatory..."></textarea>
                    </div>
                </div>
            </div></div></details>`;
    }
        
    initializeApp();
});
// --- SCRIPT END ---
