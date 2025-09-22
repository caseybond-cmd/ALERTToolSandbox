// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
  // --- STATE & CONFIG ---
  let currentReview = {};
  let pivcCounter = 0;
  let drainCounter = 0;
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
  const CRITICAL_PREDICATES = [
    { id: 'vasopressor_recent', label: 'Vasopressor or inotrope within last 24h', test: (d) => !!d.vasopressor_recent },
    { id: 'fio2_high', label: 'FiO2 >= 40% OR HFNP/NIV dependence', test: (d) => {
        const fio2 = p(d.fio2); const device = d.o2_device || '';
        if (!isNaN(fio2) && fio2 >= 40) return true;
        if (['HFNP','NIV'].includes(device)) {
          if (p(d.spo2) < 92 || device) return true;
        }
        return false;
      }},
    { id: 'lactate_high', label: 'Lactate >= 4 mmol/L OR rapidly rising lactate', test: (d) => {
        if (!isNaN(p(d.lactate)) && p(d.lactate) >= 4) return true;
        return d.lactate_trend === 'decreasing' && !isNaN(p(d.lactate)) && p(d.lactate) >= 2.0;
      }},
    { id: 'unresponsive', label: 'Unresponsive / rapidly deteriorating consciousness', test: (d) => (d.consciousness === 'Unresponsive') },
    { id: 'airway_risk', label: 'Active airway risk (recent intubation/failed extubation / inability to protect airway)', test: (d) => d.airway === 'At Risk' || d.airway === 'Tracheostomy' },
    { id: 'met_call', label: 'ADDS/MET call triggered', test: (d, adds) => adds && adds.metCall === true }
  ];

  const IMPORTANT_PREDICATES = [
    { id: 'creatinine_delta', label: 'New/worsening renal dysfunction (rise >=26 µmol/L or >=1.5x baseline)', test: (d) => d.creatinine_trend === 'increasing' || (!isNaN(p(d.creatinine)) && !isNaN(p(d.creatinine_baseline)) && (p(d.creatinine) - p(d.creatinine_baseline) >= 26 || p(d.creatinine) >= 1.5 * p(d.creatinine_baseline))) },
    { id: 'hemodynamic_instability', label: 'Significant haemodynamic instability (SBP <90 or persistent HR>140)', test: (d) => (!isNaN(p(d.sbp)) && p(d.sbp) < 90) || (!isNaN(p(d.hr)) && p(d.hr) > 140) },
    { id: 'recent_extubation', label: 'Recent extubation (24-48h) with objective risk features', test: (d) => d.recent_extubation === true || d.recent_extubation === 'yes' },
    { id: 'platelets_low', label: 'Platelets < 50 x10^9/L or active bleeding', test: (d) => !isNaN(p(d.platelets)) && p(d.platelets) < 50 || d.active_bleeding === true },
    { id: 'delirium_mod', label: 'Delirium (moderate-severe) or rapidly worsening mental state', test: (d) => p(d.delirium) >= 2 || d.consciousness === 'Voice' && d.delirium === '1' },
    { id: 'device_infection_risk', label: 'Device/line site concern (CVAD/PIVC site infection or rising inflammatory markers + device)', test: (d) => (d.cvad_present && d.cvad_site_health && d.cvad_site_health !== 'Clean & Healthy') || (d.pivc_1_present && d.pivc_1_site_health && d.pivc_1_site_health !== 'Clean & Healthy') },
    { id: 'oliguria_persistent', label: 'Oliguria persistent (<0.5 mL/kg/hr for >6h) or trend worsening', test: (d) => {
        if (!isNaN(p(d.urine_output_hr)) && !isNaN(p(d.weight)) && p(d.weight)>0) {
          const mlkg = p(d.urine_output_hr) / p(d.weight);
          return mlkg < 0.5 && d.urine_output_trend === 'increasing';
        }
        return d.urine_output_trend === 'increasing' && !isNaN(p(d.urine_output_hr)) && p(d.urine_output_hr) > 0;
      }},
    { id: 'fio2_rapid_change', label: 'Rapid FiO2 changes (wean then increase) or worsening FiO2 trend', test: (d) => d.fio2_trend === 'increasing' || d.fio2_pattern === 'wean_then_rise' }
  ];

  // --- Initialization ---
  function initializeApp() {
    populateStaticContent();
    setupEventListeners();
    updateLocationOptions(); // Initial population
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

    // Gather dynamic PIVC data
    data.pivcs = [];
    document.querySelectorAll('.pivc-entry').forEach(entry => {
        const pivcData = {
            id: entry.dataset.id,
            commencement_date: entry.querySelector(`[id^="pivc_commencement_date_"]`)?.value,
            gauge: entry.querySelector(`[id^="pivc_gauge_"]`)?.value,
            site_health: entry.querySelector(`[id^="pivc_site_health_"]`)?.value,
            score: entry.querySelector(`[id^="pivc_score_"]`)?.value,
        };
        data.pivcs.push(pivcData);
    });

    // Gather dynamic Drain data
    data.drains = [];
    document.querySelectorAll('.drain-entry').forEach(entry => {
        const drainData = {
            id: entry.dataset.id,
            output_24hr: entry.querySelector(`[id^="drain_output_24hr_"]`)?.value,
            cumulative: entry.querySelector(`[id^="drain_output_cumulative_"]`)?.value,
        };
        data.drains.push(drainData);
    });
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

    // Repopulate dynamic fields
    if (currentReview.pivcs) {
        document.getElementById('pivc-container').innerHTML = '';
        currentReview.pivcs.forEach(pivcData => addPivc(pivcData));
    }
    if (currentReview.drains) {
        document.getElementById('drains-container').innerHTML = '';
        currentReview.drains.forEach(drainData => addDrain(drainData));
    }

    updateRiskAssessment();
    form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  }

  function clearForm() {
    form.reset();
    localStorage.removeItem('alertToolState_v_flag_v1');
    currentReview = {};
    document.getElementById('pivc-container').innerHTML = '';
    document.getElementById('drains-container').innerHTML = '';
    pivcCounter = 0;
    drainCounter = 0;
    updateRiskAssessment();
  }

  // --- ADDS calculation ---
  function calculateADDS(data) {
    let score = 0, metCall = false, metReason = '', reasons = [];
    const getScore = (val, ranges) => {
      for (const r of ranges) {
        if ((r.min === -Infinity || val >= r.min) && (r.max === Infinity || val <= r.max)) {
          if (r.score === 'E') return { metCall: true, metReason: r.note };
          return { score: r.score };
        }
      }
      return { score: 0 };
    };
    const checkParam = (value, ranges, paramName) => {
      if (isNaN(value) || metCall) return;
      const result = getScore(value, ranges);
      if (result.metCall) { metCall = true; metReason = result.metReason; }
      else {
        score += result.score;
        if (result.score > 0) reasons.push(`${paramName} abnormal (${value})`);
       }
    };
    
    checkParam(p(data.rr), [{min:-Infinity,max:4,score:'E',note:'<=4 => MET'},{min:5,max:8,score:3},{min:9,max:10,score:2},{min:11,max:20,score:0},{min:21,max:24,score:1},{min:25,max:30,score:2},{min:31,max:35,score:3},{min:36,max:Infinity,score:'E',note:'>=36 => MET'}], 'Resp Rate');
    checkParam(p(data.spo2), [{min:-Infinity,max:84,score:'E',note:'<=84 => MET'},{min:85,max:88,score:3},{min:89,max:90,score:2},{min:91,max:93,score:1},{min:94,max:Infinity,score:0}], 'SpO2');
    checkParam(p(data.hr), [{min:-Infinity,max:30,score:'E',note:'<=30 => MET'},{min:31,max:40,score:3},{min:41,max:50,score:2},{min:51,max:99,score:0},{min:100,max:109,score:1},{min:110,max:120,score:2},{min:121,max:129,score:1},{min:130,max:139,score:3},{min:140,max:Infinity,score:'E',note:'>=140 => MET'}], 'Heart Rate');
    checkParam(p(data.sbp), [{min:-Infinity,max:40,score:'E',note:'extreme low -> MET'},{min:41,max:50,score:3},{min:51,max:60,score:2},{min:61,max:70,score:1},{min:71,max:80,score:0},{min:81,max:90,score:3},{min:91,max:100,score:2},{min:101,max:110,score:1},{min:111,max:139,score:0},{min:140,max:180,score:1},{min:181,max:200,score:2},{min:201,max:220,score:3},{min:221,max:Infinity,score:'E',note:'>=221 => MET'}], 'Systolic BP');
    checkParam(p(data.temp), [{min:-Infinity,max:35,score:3},{min:35.1,max:36.0,score:1},{min:36.1,max:37.5,score:0},{min:37.6,max:38.0,score:1},{min:38.1,max:39.0,score:2},{min:39.1,max:Infinity,score:'E',note:'>=39.1 => MET'}], 'Temperature');

    if (data.consciousness === 'Unresponsive') { metCall = true; metReason = 'Unresponsive'; }
    else if (data.consciousness === 'Pain') { score += 2; reasons.push('Responds to Pain'); }
    else if (data.consciousness === 'Voice') { score += 1; reasons.push('Responds to Voice'); }

    if (data.o2_device === 'HFNP') { score += 1; reasons.push('Using High-Flow O₂'); }
    checkParam(p(data.o2_flow), [{min:0,max:5,score:0},{min:6,max:7,score:1},{min:8,max:9,score:2},{min:10,max:Infinity,score:3}], 'O₂ Flow');
    checkParam(p(data.fio2), [{min:0,max:27,score:0},{min:28,max:39,score:2},{min:40,max:Infinity,score:3}], 'FiO2');
    
    document.getElementById('finalADDSScore').textContent = metCall ? 'MET' : score;
    return { score, metCall, metReason, reasons };
  }

  // --- Core: Flag engine ---
  function evaluateFlags(data) {
    const adds = calculateADDS(data);
    const critical = CRITICAL_PREDICATES.map(p => p.test(data, adds) ? p.label : null).filter(Boolean);
    const important = IMPORTANT_PREDICATES.map(p => p.test(data) ? p.label : null).filter(Boolean);
    const afterHours = !!data.after_hours;

    let categoryKey = 'GREEN';
    if (critical.length > 0) categoryKey = 'RED';
    else if (afterHours && important.length > 0) categoryKey = 'RED';
    else if (important.length >= 2) categoryKey = 'RED';
    else if (important.length === 1) categoryKey = 'AMBER';

    // Apply Staffing Reducer
    if (categoryKey === 'AMBER' && p(data.ward_staffing) <= -1) {
        categoryKey = 'GREEN';
        important.push("Category reduced due to staffing (e.g. 1:1)");
    }

    // Apply Manual Overrides LAST
    if (data.manual_override && data.override_reason) {
        categoryKey = 'RED';
    } else if (data.manual_downgrade && data.downgrade_reason && data.manual_downgrade_category) {
        categoryKey = data.manual_downgrade_category;
    }

    return { categoryKey, critical, important, afterHours, adds };
  }
  
  // --- Presentation ---
  function displayResults(result, data) {
    const category = CATEGORIES[result.categoryKey];
    const summaryContainer = document.getElementById('summary-container');
    const footerCategory = document.getElementById('footer-category');
    const footerCriticalCount = document.getElementById('footer-critical-count');
    const footerImportantCount = document.getElementById('footer-important-count');
    const stickyFooter = document.getElementById('sticky-footer');

    document.getElementById('footer-location').textContent = `${data.location || ''} ${data.location === 'Other' ? '('+data.location_other+')' : ''} - ${data.room_number || ''}`;
    document.getElementById('footer-reason').textContent = data.reason_icu || 'No reason entered';
    footerCategory.textContent = category.text;
    footerCriticalCount.textContent = result.critical.length;
    footerImportantCount.textContent = `Important: ${result.important.length}`;
    stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex flex-col z-40 ${category.class}`;
    document.getElementById('footer-flags-red').innerHTML = `<span>🚩 ${result.critical.length}</span>`;
    document.getElementById('footer-flags-green').innerHTML = `<span>✅ ${result.important.length}</span>`;

    const criticalHtml = result.critical.length ? `<ul class="list-disc list-inside text-sm text-gray-700">${result.critical.map(f => `<li>${f}</li>`).join('')}</ul>` : '<div class="text-sm text-gray-500">None</div>';
    const importantHtml = result.important.length ? `<ul class="list-disc list-inside text-sm text-gray-700">${result.important.map(f => `<li>${f}</li>`).join('')}</ul>` : '<div class="text-sm text-gray-500">None</div>';
    const plan = generateActionPlan(result.categoryKey);

    summaryContainer.innerHTML = `
      <div class="summary-category ${category.class}">${category.text}</div>
      ${result.afterHours ? '<div class="mt-2 text-sm text-yellow-700 font-semibold">After-hours discharge — modifier applied</div>' : ''}
      <div class="summary-flags-container mt-4"><div><h4 class="flag-list-red">Critical Flags (${result.critical.length}):</h4>${criticalHtml}</div><div><h4 class="flag-list-green">Important Flags (${result.important.length}):</h4>${importantHtml}</div></div>
      <div class="summary-plan mt-4"><h4>Recommended Action Plan:</h4><p class="text-sm">${plan}</p></div>
    `;
  }

  function generateActionPlan(categoryKey) {
    switch (categoryKey) {
      case 'RED': return 'Cat 1: Daily senior review for 72 hrs. Escalate immediately to ICU liaison/medical team if any deterioration.';
      case 'AMBER': return 'Cat 2: Enhanced ward monitoring q24–48 hrs for 72 hrs; nurse-led observations and early MDT review if any trend worsens.';
      default: return 'Cat 3: Routine ward care. Single check within 24 hrs and include DMR notes.';
    }
  }

  // --- DMR summary ---
  function generateDMRSummary() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    
    const bloodsSummary = ['creatinine','lactate','hb','platelets','albumin','crp']
        .map(id => ({ id, val: data[id], trend: data[`${id}_trend`] }))
        .filter(b => b.val)
        .map(b => {
            const name = b.id.charAt(0).toUpperCase() + b.id.slice(1);
            const arrow = b.trend === 'increasing' ? '↑' : b.trend === 'decreasing' ? '↓' : '→';
            return `${name.substring(0,3)} ${b.val}${b.trend ? `(${arrow})` : ''}`;
        }).join(', ');
    
    const devices = [];
    if (data.pivcs) data.pivcs.forEach((p, i) => devices.push(`PIVC #${i+1}: ${p.gauge}, Score ${p.score || ''}, Health: ${p.site_health || ''}`));
    if (data.drains) data.drains.forEach((d, i) => devices.push(`Drain #${i+1}: ${d.output_24hr || ''}mL/24hr`));
    if (data.cvad_present) devices.push('CVAD Present');
    if (data.idc_present) devices.push('IDC Present');
    if (data.enteral_tube_present) devices.push(`Enteral Tube: ${data.enteral_tube_type} ${data.enteral_tube_type === 'Other' ? '('+data.enteral_tube_other+')' : ''}`);
    if (data.epicardial_wires_present) devices.push('Epicardial Pacing Wires');
    
    const categoryText = CATEGORIES[result.categoryKey].text;
    const a = `Airway: ${data.airway || ''}`;
    const b = `RR ${data.rr || ''}, SpO2 ${data.spo2 || ''} on ${data.o2_device || ''} ${data.fio2 ? '(FiO2 ' + data.fio2 + '%)' : ''}`;
    const c = `HR ${data.hr || ''}, BP ${data.sbp || ''}/${data.dbp || ''}, CRT ${data.cap_refill || ''}, UO: ${computeUOPSummary(data) || ''}`;
    const d = `Consciousness: ${data.consciousness || ''}, Delirium: ${data.delirium !== '0' ? data.delirium : ''}, Pain: ${data.pain_score || ''}/10`;
    const e = `Temp ${data.temp || ''}°C`;

    const summary = `
ALERT CNS ${data.review_type || ''} on ward ${data.location || ''} ${data.location === 'Other' ? '('+data.location_other+')' : ''} 
LOS: ${data.icu_los || ''} days
${categoryText}

REASON FOR ICU: ${data.reason_icu || ''}

ICU SUMMARY: ${data.icu_summary || ''}

PMH: ${data.pmh || ''}

ADDS: ${result.adds.metCall ? 'MET' : result.adds.score}
A: ${a.trim()}
B: ${b.trim()}
C: ${c.trim()}
D: ${d.trim()}
E: ${e.trim()}

DEVICES:
- ${devices.length ? devices.join('\n- ') : 'None'}

BLOODS:
${bloodsSummary}

Flags:
- Critical: ${result.critical.length ? result.critical.join('; ') : 'None'}
- Important: ${result.important.length ? result.important.join('; ') : 'None'}

IMP:
${data.clinical_impression || ''}

Plan:
${data.clinical_plan || generateActionPlan(result.categoryKey)}
`.trim().replace(/\n\s*\n/g, '\n'); // remove blank lines

    document.getElementById('emrSummary').value = summary;
  }

  function computeUOPSummary(data) {
    const weight = p(data.weight);
    const uop_hr = p(data.urine_output_hr);
    if (!isNaN(uop_hr)) {
        let summary = `${uop_hr} mL/hr`;
        if (!isNaN(weight) && weight > 0) {
            summary += ` (${(uop_hr / weight).toFixed(2)} mL/kg/hr)`;
        }
        return summary;
    }
    return '';
  }

  // --- Core orchestrator ---
  function updateRiskAssessment() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    displayResults(result, data);
    saveState();
    generateDMRSummary();
  }

  // --- Event wiring & UI helpers ---
  function setupEventListeners() {
    form.addEventListener('input', updateRiskAssessment);
    form.addEventListener('change', updateRiskAssessment);
    document.getElementById('startOverBtn')?.addEventListener('click', () => { if (confirm('Are you sure? This will clear all data.')) clearForm(); });
    document.getElementById('copySummaryButton')?.addEventListener('click', () => {
      const summaryEl = document.getElementById('emrSummary');
      summaryEl.select();
      document.execCommand('copy');
      alert('DMR Summary Copied!');
    });
    document.getElementById('review_type').addEventListener('change', updateLocationOptions);
    document.getElementById('location').addEventListener('change', () => {
        const otherContainer = document.getElementById('location_other_container');
        if (otherContainer) {
            otherContainer.classList.toggle('hidden', document.getElementById('location').value !== 'Other');
        }
    });
  }

  function updateLocationOptions() {
      const reviewType = document.getElementById('review_type').value;
      const locationSelect = document.getElementById('location');
      const otherContainer = document.getElementById('location_other_container');
      let options = '';

      if (reviewType === 'pre') {
          options = ['ICU Pod 1', 'ICU Pod 2', 'ICU Pod 3', 'ICU Pod 4'].map(w => `<option>${w}</option>`).join('');
          if(otherContainer) otherContainer.classList.add('hidden');
      } else {
          const wards = ['3A','3B','3C','3D','4A','4B','4C','4D','5A','5B','5C','5D','6A','6B','6C','6D','7A','7B','7C','7D','CCU','SSU'];
          options = `<option value="" disabled selected>Select a Ward</option>` + wards.map(w => `<option>${w}</option>`).join('') + `<option value="Other">Other (Specify)</option>`;
      }
      locationSelect.innerHTML = options;
  }

  function addPivc(data = {}) {
      const container = document.getElementById('pivc-container');
      const entry = document.createElement('div');
      const id = pivcCounter++;
      entry.className = 'pivc-entry mt-2 ml-6 pl-4 border-l-2 space-y-2 relative';
      entry.dataset.id = id;
      entry.innerHTML = `
        <button type="button" class="remove-btn absolute -left-8 top-1" onclick="this.parentElement.remove()">X</button>
        <div class="grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
            <label class="text-sm">Commencement:<input type="date" id="pivc_commencement_date_${id}" class="input-field" value="${data.commencement_date || ''}"></label>
            <label class="text-sm">Gauge:<select id="pivc_gauge_${id}" class="input-field">
                <option ${data.gauge === '24G (Yellow)' ? 'selected' : ''}>24G (Yellow)</option>
                <option ${data.gauge === '22G (Blue)' ? 'selected' : ''}>22G (Blue)</option>
                <option ${data.gauge === '20G (Pink)' ? 'selected' : ''}>20G (Pink)</option>
                <option ${data.gauge === '18G (Green)' ? 'selected' : ''}>18G (Green)</option>
                <option ${data.gauge === '16G (Grey)' ? 'selected' : ''}>16G (Grey)</option>
            </select></label>
            <label class="text-sm">Site Health:<select id="pivc_site_health_${id}" class="input-field">
                <option ${data.site_health === 'Clean & Healthy' ? 'selected' : ''}>Clean & Healthy</option>
                <option ${data.site_health === 'Redness/Swelling' ? 'selected' : ''}>Redness/Swelling</option>
                <option ${data.site_health === 'Signs of Infection' ? 'selected' : ''}>Signs of Infection</option>
                <option ${data.site_health === 'Occluded/Poor Function' ? 'selected' : ''}>Occluded/Poor Function</option>
            </select></label>
            <label class="text-sm">VIP Score:<input type="number" id="pivc_score_${id}" class="input-field" value="${data.score || ''}"></label>
            <div class="text-sm">Dwell: <span id="pivc_dwell_time_${id}" class="font-bold">N/A</span> days</div>
        </div>
      `;
      container.appendChild(entry);
  }

  function addDrain(data = {}) {
      const container = document.getElementById('drains-container');
      const entry = document.createElement('div');
      const id = drainCounter++;
      entry.className = 'drain-entry mt-2 ml-6 pl-4 border-l-2 space-y-2 relative';
      entry.dataset.id = id;
      entry.innerHTML = `
          <button type="button" class="remove-btn absolute -left-8 top-1" onclick="this.parentElement.remove()">X</button>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label class="text-sm">24hr Output (mL):<input type="number" id="drain_output_24hr_${id}" class="input-field" value="${data.output_24hr || ''}"></label>
              <label class="text-sm">Cumulative Output (mL):<input type="number" id="drain_output_cumulative_${id}" class="input-field" value="${data.cumulative || ''}"></label>
          </div>
      `;
      container.appendChild(entry);
  }

  // --- UI population (Dynamic Form Structure) ---
 function populateStaticContent() {
    const createBloodInput = (label, id) => {
        const trendButtons = `<div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Increasing"><input type="radio" name="${id}_trend_radio" value="increasing"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Decreasing"><input type="radio" name="${id}_trend_radio" value="decreasing"><span>↓</span></label></div>`;
        return `<div class="blood-score-item"><label class="font-medium text-sm">${label}:<input type="number" step="0.1" id="${id}" class="input-field"></label>${trendButtons}</div>`;
    };
    const createTrendButtons = (id) => `<div class="trend-radio-group full-review-item" data-trend-id="${id}_trend"><label title="Increasing"><input type="radio" name="${id}_trend_radio" value="increasing"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Decreasing"><input type="radio" name="${id}_trend_radio" value="decreasing"><span>↓</span></label></div>`;

    document.getElementById('patient-details-section').innerHTML = `<details class="form-section" open><summary>Patient & Review Details</summary><div class="form-section-content grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <label>Review Type:<select id="review_type" class="input-field"><option value="post">Post-ICU stepdown review</option><option value="pre">Pre-ICU stepdown review</option></select></label>
        <div class="grid grid-cols-2 gap-4"><label>Location:<select id="location" class="input-field"></select></label><div id="location_other_container" class="hidden"><label>Specify:<input type="text" id="location_other" class="input-field"></label></div></div>
        <label>Room No.:<input type="text" id="room_number" class="input-field"></label>
        <label>Weight (kg):<input type="number" id="weight" class="input-field"></label>
        <label>Age:<input type="number" id="age" class="input-field"></label>
        <label>ICU LOS (days):<input type="number" id="icu_los" class="input-field"></label>
        <label class="flex items-center pt-6"><input type="checkbox" id="after_hours" class="input-checkbox"> After-Hours Discharge</label>
    </div></details>`;

    document.getElementById('context-section').innerHTML = `<details class="form-section"><summary>Context & Plan</summary><div class="form-section-content space-y-4">
        <label class="font-medium text-sm">Reason for ICU Admission:<textarea id="reason_icu" class="input-field" rows="2"></textarea></label>
        <label class="font-medium text-sm">ICU Summary:<textarea id="icu_summary" class="input-field" rows="3"></textarea></label>
        <label class="font-medium text-sm">Past Medical History (PMH):<textarea id="pmh" class="input-field" rows="2"></textarea></label>
        <hr/>
        <div><label class="font-medium text-sm">Impression (IMP):</label><textarea id="clinical_impression" rows="3" class="input-field"></textarea></div>
        <div><label class="font-medium text-sm">Plan:</label><textarea id="clinical_plan" rows="4" class="input-field"></textarea></div>
        <hr/>
        <div><label class="font-medium text-sm">Ward Placement/Staffing (Reducer):</label><select id="ward_staffing" class="input-field"><option value="0">1:4+ Standard</option><option value="-1">1:2 / 1:3</option><option value="-2">1:1 / Monitored Bed</option></select></div>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Category Upgrade</label><textarea id="override_reason" class="input-field" placeholder="Reason for upgrade..."></textarea></div>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_downgrade" class="input-checkbox"> Manual Category Downgrade</label><div class="grid grid-cols-2 gap-4"><select id="manual_downgrade_category" class="input-field"><option value="AMBER">Amber</option><option value="GREEN">Green</option></select><textarea id="downgrade_reason" class="input-field" placeholder="Reason for downgrade..."></textarea></div></div>
    </div></details>`;

    document.getElementById('bloods-section').innerHTML = `<details class="form-section" open><summary>Blood Panel</summary><div class="form-section-content grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        ${createBloodInput('Creatinine (µmol/L)', 'creatinine')}${createBloodInput('Lactate (mmol/L)', 'lactate')}${createBloodInput('Hb (g/L)', 'hb')}${createBloodInput('Platelets (x10⁹/L)', 'platelets')}${createBloodInput('Albumin (g/L)', 'albumin')}${createBloodInput('CRP (mg/L)', 'crp')}
    </div></details>`;
        
    document.getElementById('assessment-section').innerHTML = `<details class="form-section" open><summary>A-E Assessment</summary><div class="form-section-content">
        <div class="mt-6 mb-4 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center"><span class="text-sm font-medium text-gray-500">ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>
        <div class="assessment-grid" style="align-items: end;">
            <div><label>Resp Rate:</label><div class="flex items-center gap-2"><input type="number" id="rr" class="input-field">${createTrendButtons('rr')}</div></div>
            <div><label>SpO2 (%):</label><div class="flex items-center gap-2"><input type="number" id="spo2" class="input-field">${createTrendButtons('spo2')}</div></div>
            <div><label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><div id="fio2_container" class="hidden flex items-center gap-2"><label class="text-xs w-full">FiO2 (%):<input type="number" id="fio2" class="input-field"></label>${createTrendButtons('fio2')}</div></div>
            <div><label>Heart Rate:</label><div class="flex items-center gap-2"><input type="number" id="hr" class="input-field">${createTrendButtons('hr')}</div></div>
            <label>Systolic BP:<input type="number" id="sbp" class="input-field"></label>
            <label>Diastolic BP:<input type="number" id="dbp" class="input-field"></label>
            <div><label>Temperature (°C):</label><div class="flex items-center gap-2"><input type="number" step="0.1" id="temp" class="input-field">${createTrendButtons('temp')}</div></div>
            <label>Consciousness:<select id="consciousness" class="input-field"><option value="Alert">Alert</option><option value="Voice">Voice</option><option value="Pain">Pain</option><option value="Unresponsive">Unresponsive</option></select></label>
            <label>Urine Output (last hr, mL):<input type="number" id="urine_output_hr" class="input-field"></label>
        </div>
    </div></details>`;
        
    document.getElementById('devices-section').innerHTML = `<details class="form-section"><summary>Devices</summary><div class="form-section-content space-y-4">
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="cvad_present" class="input-checkbox">CVAD</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="idc_present" class="input-checkbox">IDC</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="epicardial_wires_present" class="input-checkbox">Epicardial Pacing Wires</label></div>
        <div class="device-item">
            <label class="flex items-center font-medium"><input type="checkbox" id="enteral_tube_present" class="input-checkbox">Enteral Tube</label>
            <div id="enteral_tube_details_container" class="hidden mt-2 ml-6 pl-4 border-l-2 space-y-2"><div class="grid grid-cols-2 gap-4"><select id="enteral_tube_type" class="input-field"><option>NG</option><option>NJ</option><option>PEG</option><option>PEJ</option><option>Other</option></select><input type="text" id="enteral_tube_other" class="input-field hidden" placeholder="Specify..."></div></div>
        </div>
        <hr/>
        <div class="device-item">
            <div class="flex justify-between items-center"><h4 class="font-medium">PIVCs</h4><button type="button" id="add-pivc-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add PIVC</button></div>
            <div id="pivc-container"></div>
        </div>
        <hr/>
        <div class="device-item">
            <div class="flex justify-between items-center"><h4 class="font-medium">Drains</h4><button type="button" id="add-drain-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add Drain</button></div>
            <div id="drains-container"></div>
        </div>
    </div></details>`;

    // Add event listeners for dynamic elements
    document.getElementById('add-pivc-btn').addEventListener('click', () => addPivc());
    document.getElementById('add-drain-btn').addEventListener('click', () => addDrain());
    form.addEventListener('change', (e) => { // Using event delegation
        if (e.target.id === 'enteral_tube_present') {
            document.getElementById('enteral_tube_details_container').classList.toggle('hidden', !e.target.checked);
        } else if (e.target.id === 'enteral_tube_type') {
            document.getElementById('enteral_tube_other').classList.toggle('hidden', e.target.value !== 'Other');
        }
    });
 }
        
    initializeApp();
});
// --- SCRIPT END ---
