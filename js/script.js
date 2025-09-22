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

  // --- Flag definitions ---
  const CRITICAL_PREDICATES = [
    { id: 'vasopressor_recent', label: 'Vasopressor or inotrope within last 24h', test: (d) => !!d.vasopressor_recent },
    { id: 'fio2_high', label: 'FiO2 >= 40% OR HFNP/NIV dependence', test: (d) => {
        const fio2 = p(d.fio2); const device = d.o2_device || '';
        if (!isNaN(fio2) && fio2 >= 40) return true;
        if (['HFNP','NIV'].includes(device)) {
          const targetSpo2Min = d.mods_enabled ? p(d.target_spo2_min) || 92 : 92;
          if (p(d.spo2) < targetSpo2Min) return true;
        }
        return false;
      }},
    { id: 'lactate_high', label: 'Lactate >= 4 mmol/L OR rapidly increasing lactate', test: (d) => {
        if (!isNaN(p(d.lactate)) && p(d.lactate) >= 4) return true;
        return d.lactate_trend === 'increasing' && !isNaN(p(d.lactate)) && p(d.lactate) >= 2.0;
      }},
    { id: 'unresponsive', label: 'Unresponsive', test: (d) => (d.consciousness === 'Unresponsive') },
    { id: 'airway_risk', label: 'Active airway risk', test: (d) => d.airway === 'At Risk' || d.airway === 'Tracheostomy' },
    { id: 'met_call', label: 'ADDS/MET call triggered', test: (d, adds) => adds && adds.metCall === true }
  ];

  const IMPORTANT_PREDICATES = [
    { id: 'creatinine_delta', label: 'New/worsening renal dysfunction', test: (d) => d.creatinine_trend === 'increasing' },
    { id: 'hemodynamic_instability', label: 'Haemodynamic instability outside targets', test: (d) => {
        const targetSbp = d.mods_enabled ? p(d.target_sbp) || 90 : 90;
        const targetHr = d.mods_enabled ? p(d.target_hr) || 140 : 140;
        return (!isNaN(p(d.sbp)) && p(d.sbp) < targetSbp) || (!isNaN(p(d.hr)) && p(d.hr) > targetHr);
      }},
    { id: 'platelets_low', label: 'Platelets < 50 or active bleeding', test: (d) => !isNaN(p(d.platelets)) && p(d.platelets) < 50 || d.active_bleeding === true },
    { id: 'delirium_mod', label: 'Moderate-severe delirium', test: (d) => p(d.delirium) >= 2 },
    { id: 'device_infection_risk', label: 'Device/line site concern', test: (d) => {
        if (d.cvad_present && d.cvad_site_health && d.cvad_site_health !== 'Clean & Healthy') return true;
        if (d.pivcs) return d.pivcs.some(pivc => pivc.site_health && pivc.site_health !== 'Clean & Healthy');
        return false;
    }},
    { id: 'oliguria_persistent', label: 'Persistent Oliguria (<0.5 mL/kg/hr)', test: (d) => {
        if (!isNaN(p(d.urine_output_hr)) && !isNaN(p(d.weight)) && p(d.weight)>0) {
          const mlkg = p(d.urine_output_hr) / p(d.weight);
          return mlkg < 0.5;
        }
        return false;
      }},
  ];

  function initializeApp() {
    populateStaticContent();
    setupEventListeners();
    const saved = localStorage.getItem('alertToolState_v_flag_v1');
    if (saved) { currentReview = JSON.parse(saved); loadReviewData(); } 
    else { updateRiskAssessment(); }
  }

  function gatherFormData() {
    const data = {};
    form.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return;
      data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    document.querySelectorAll('.trend-radio-group').forEach(group => {
      const checked = group.querySelector('input[type="radio"]:checked');
      if (checked) data[group.dataset.trendId] = checked.value;
    });

    data.pivcs = Array.from(document.querySelectorAll('.pivc-entry')).map(entry => ({
        commencement_date: entry.querySelector(`[id^="pivc_commencement_date_"]`)?.value,
        gauge: entry.querySelector(`[id^="pivc_gauge_"]`)?.value,
        site_health: entry.querySelector(`[id^="pivc_site_health_"]`)?.value,
        score: entry.querySelector(`[id^="pivc_score_"]`)?.value,
    }));
    data.drains = Array.from(document.querySelectorAll('.drain-entry')).map(entry => ({
        output_24hr: entry.querySelector(`[id^="drain_output_24hr_"]`)?.value,
        cumulative: entry.querySelector(`[id^="drain_output_cumulative_"]`)?.value,
    }));
    return data;
  }
  
  function saveState() {
    localStorage.setItem('alertToolState_v_flag_v1', JSON.stringify(gatherFormData()));
  }

  function loadReviewData() {
    Object.keys(currentReview).forEach(key => {
      const el = form.querySelector(`#${key}`);
      if (el) {
        if (el.type === 'checkbox') el.checked = currentReview[key];
        else el.value = currentReview[key];
      } else if (key.endsWith('_trend')) {
        document.querySelector(`input[name="${key}_radio"][value="${currentReview[key]}"]`)?.setAttribute('checked', true);
      }
    });

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
    pivcCounter = 0; drainCounter = 0;
    document.getElementById('pivc-container').innerHTML = '';
    document.getElementById('drains-container').innerHTML = '';
    updateRiskAssessment();
  }

  function calculateADDS(data) {
    let score = 0;
    let metCall = false;
    let metReason = '';

    const checkParam = (value, ranges) => {
        if (isNaN(value) || metCall) return;
        for (const r of ranges) {
            if ((r.min === -Infinity || value >= r.min) && (r.max === Infinity || value <= r.max)) {
                if (r.score === 'E') {
                    metCall = true;
                    metReason = r.note;
                } else {
                    score += r.score;
                }
                return;
            }
        }
    };

    checkParam(p(data.rr), [{min: -Infinity, max: 4, score: 'E', note: '<=4 => MET'},{min: 5, max: 8, score: 3}, {min: 9, max: 10, score: 2},{min: 11, max: 20, score: 0}, {min: 21, max: 24, score: 1},{min: 25, max: 30, score: 2}, {min: 31, max: 35, score: 3},{min: 36, max: Infinity, score: 'E', note: '>=36 => MET'}]);
    checkParam(p(data.spo2), [{min: -Infinity, max: 84, score: 'E', note: '<=84 => MET'},{min: 85, max: 88, score: 3}, {min: 89, max: 90, score: 2},{min: 91, max: 93, score: 1}, {min: 94, max: Infinity, score: 0}]);
    checkParam(p(data.o2_flow), [{min: 0, max: 5, score: 0}, {min: 6, max: 7, score: 1},{min: 8, max: 9, score: 2}, {min: 10, max: Infinity, score: 3}]);
    if (data.o2_device === 'HFNP') { score += 1; }
    checkParam(p(data.fio2), [{min: 28, max: 39, score: 2}, {min: 40, max: Infinity, score: 3}]);
    checkParam(p(data.hr), [{min: -Infinity, max: 30, score: 'E', note: '<=30 => MET'},{min: 31, max: 40, score: 3}, {min: 41, max: 50, score: 2},{min: 51, max: 99, score: 0}, {min: 100, max: 109, score: 1},{min: 110, max: 120, score: 2}, {min: 121, max: 129, score: 1},{min: 130, max: 139, score: 3},{min: 140, max: Infinity, score: 'E', note: '>=140 => MET'}]);
    checkParam(p(data.sbp), [{min: -Infinity, max: 40, score: 'E', note: 'extreme low -> MET'},{min: 41, max: 50, score: 3}, {min: 51, max: 60, score: 2},{min: 61, max: 70, score: 1}, {min: 71, max: 80, score: 0},{min: 81, max: 90, score: 3}, {min: 91, max: 100, score: 2},{min: 101, max: 110, score: 1}, {min: 111, max: 139, score: 0},{min: 140, max: 180, score: 1}, {min: 181, max: 200, score: 2},{min: 201, max: 220, score: 3},{min: 221, max: Infinity, score: 'E', note: '>=221 => MET'}]);
    checkParam(p(data.temp), [{min: -Infinity, max: 35, score: 3}, {min: 35.1, max: 36.0, score: 1},{min: 36.1, max: 37.5, score: 0}, {min: 37.6, max: 38.0, score: 1},{min: 38.1, max: 39.0, score: 2},{min: 39.1, max: Infinity, score: 'E', note: '>=39.1 => MET'}]);
    if (!metCall) {
        switch (data.consciousness) {
            case 'Unresponsive': metCall = true; metReason = 'Unresponsive'; break;
            case 'Pain': score += 2; break;
            case 'Voice': score += 1; break;
        }
    }

    document.getElementById('finalADDSScore').textContent = metCall ? 'MET' : score;
    return { score, metCall, metReason };
  }

  function evaluateFlags(data) {
    const adds = calculateADDS(data);
    const critical = CRITICAL_PREDICATES.map(p => p.test(data, adds) ? p.label : null).filter(Boolean);
    const important = IMPORTANT_PREDICATES.map(p => p.test(data) ? p.label : null).filter(Boolean);
    const afterHours = !!data.after_hours;

    let categoryKey = 'GREEN';
    if (critical.length > 0) categoryKey = 'RED';
    else if ((afterHours && important.length > 0) || important.length >= 2) categoryKey = 'RED';
    else if (important.length === 1) categoryKey = 'AMBER';

    if (data.manual_override && data.override_reason) categoryKey = 'RED';
    else if (data.manual_downgrade && data.downgrade_reason) categoryKey = data.manual_downgrade_category;
    return { categoryKey, critical, important, afterHours, adds };
  }
  
  function displayResults(result, data) {
    const category = CATEGORIES[result.categoryKey];
    document.getElementById('footer-category').textContent = category.text;
    document.getElementById('footer-critical-count').textContent = result.critical.length;
    document.getElementById('footer-important-count').textContent = `Important: ${result.important.length}`;
    document.getElementById('sticky-footer').className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex flex-col z-40 ${category.class}`;
    document.getElementById('summary-container').innerHTML = `<div class="summary-category ${category.class}">${category.text}</div>`;
  }

  function generateDMRSummary() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    
    const devices = [];
    if (data.pivcs.length) data.pivcs.forEach((p, i) => devices.push(`PIVC #${i+1}: ${p.gauge}, Score ${p.score || ''}, Health: ${p.site_health || ''}`));
    if (data.drains.length) data.drains.forEach((d, i) => devices.push(`Drain #${i+1}: ${d.output_24hr || ''}mL/24hr`));
    if (data.cvad_present) devices.push('CVAD Present');
    if (data.idc_present) devices.push('IDC Present');
    if (data.enteral_tube_present) devices.push(`Enteral Tube: ${data.enteral_tube_type} ${data.enteral_tube_type === 'Other' ? '('+data.enteral_tube_other+')' : ''}`);
    if (data.epicardial_wires_present) devices.push('Epicardial Pacing Wires');
    if (data.wounds_present) devices.push('Wounds Present');
    if (data.other_device_present) devices.push(`Other Device: ${data.other_device_details || ''}`);

    let a_e_summary = `ADDS: ${result.adds.metCall ? 'MET' : result.adds.score}\n`;
    a_e_summary += `A: Airway: ${data.airway || ''}\n`;
    a_e_summary += `B: RR ${data.rr || ''}, SpO2 ${data.spo2 || ''} on ${data.o2_device || ''} ${data.fio2 ? '(FiO2 ' + data.fio2 + '%)' : ''}\n`;
    a_e_summary += `C: HR ${data.hr || ''}, BP ${data.sbp || ''}/${data.dbp || ''}, CRT ${data.cap_refill || ''}\n`;
    a_e_summary += `D: Consciousness: ${data.consciousness || ''}, Delirium: ${data.delirium !== '0' ? data.delirium : ''}, Pain: ${data.pain_score || ''}/10`;

    const summary = `
ALERT CNS ${data.review_type || ''} on ward ${data.location || ''}
LOS: ${data.icu_los || ''} days
${CATEGORIES[result.categoryKey].text}

REASON FOR ICU: ${data.reason_icu || ''}
ICU SUMMARY: ${data.icu_summary || ''}
PMH: ${data.pmh || ''}

${a_e_summary.trim()}

DEVICES:
- ${devices.length ? devices.join('\n- ') : 'None'}

IMP:
${data.clinical_impression || ''}

Plan:
${data.clinical_plan || ''}
`.trim().replace(/\n\s*\n/g, '\n');

    document.getElementById('emrSummary').value = summary;
  }

  function updateRiskAssessment() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    displayResults(result, data);
    saveState();
    generateDMRSummary();
  }

  function setupEventListeners() {
    form.addEventListener('input', updateRiskAssessment);
    form.addEventListener('change', updateRiskAssessment);
    document.getElementById('startOverBtn').addEventListener('click', () => { if (confirm('Are you sure? This will clear all data.')) clearForm(); });
    document.getElementById('copySummaryButton').addEventListener('click', () => {
      document.getElementById('emrSummary').select();
      document.execCommand('copy');
      alert('DMR Summary Copied!');
    });
  }

  function addPivc(data = {}) {
      const container = document.getElementById('pivc-container');
      const entry = document.createElement('div');
      entry.className = 'pivc-entry mt-2 pt-2 border-t flex items-start gap-4';
      entry.innerHTML = `
        <div class="flex-grow grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
            <label class="text-sm">Commencement:<input type="date" id="pivc_commencement_date_${pivcCounter}" class="input-field" value="${data.commencement_date || ''}"></label>
            <label class="text-sm">Gauge:<select id="pivc_gauge_${pivcCounter}" class="input-field">
                <option ${data.gauge === '24G (Yellow)' ? 'selected' : ''}>24G (Yellow)</option><option ${data.gauge === '22G (Blue)' ? 'selected' : ''}>22G (Blue)</option><option ${data.gauge === '20G (Pink)' ? 'selected' : ''}>20G (Pink)</option><option ${data.gauge === '18G (Green)' ? 'selected' : ''}>18G (Green)</option><option ${data.gauge === '16G (Grey)' ? 'selected' : ''}>16G (Grey)</option>
            </select></label>
            <label class="text-sm">Site Health:<select id="pivc_site_health_${pivcCounter}" class="input-field"><option>Clean & Healthy</option><option>Redness/Swelling</option><option>Signs of Infection</option><option>Occluded/Poor Function</option></select></label>
            <label class="text-sm">VIP Score:<input type="number" id="pivc_score_${pivcCounter}" class="input-field" value="${data.score || ''}"></label>
            <div class="text-sm">Dwell: <span id="pivc_dwell_time_${pivcCounter}" class="font-bold">N/A</span> days</div>
        </div>
        <button type="button" class="remove-btn mt-1" onclick="this.parentElement.remove()">X</button>
      `;
      pivcCounter++;
      container.appendChild(entry);
  }

  function addDrain(data = {}) {
      const container = document.getElementById('drains-container');
      const entry = document.createElement('div');
      entry.className = 'drain-entry mt-2 pt-2 border-t flex items-start gap-4';
      entry.innerHTML = `
          <div class="flex-grow grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label class="text-sm">24hr Output (mL):<input type="number" id="drain_output_24hr_${drainCounter}" class="input-field" value="${data.output_24hr || ''}"></label>
              <label class="text-sm">Cumulative Output (mL):<input type="number" id="drain_output_cumulative_${drainCounter}" class="input-field" value="${data.cumulative || ''}"></label>
          </div>
          <button type="button" class="remove-btn mt-1" onclick="this.parentElement.remove()">X</button>`;
      drainCounter++;
      container.appendChild(entry);
  }

 function populateStaticContent() {
    const createTrendButtons = (id) => `<div class="trend-radio-group" data-trend-id="${id}_trend"><label title="Increasing"><input type="radio" name="${id}_trend_radio" value="increasing"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Decreasing"><input type="radio" name="${id}_trend_radio" value="decreasing"><span>↓</span></label></div>`;

    document.getElementById('patient-details-section').innerHTML = `<details class="form-section" open><summary>Patient & Review Details</summary><div class="form-section-content grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <label>Review Type:<select id="review_type" class="input-field"><option value="post">Post-ICU stepdown</option><option value="pre">Pre-ICU stepdown</option></select></label>
        <div class="grid grid-cols-2 gap-4"><label>Location:<select id="location" class="input-field"></select></label><div id="location_other_container" class="hidden"><label>Specify:<input type="text" id="location_other" class="input-field"></label></div></div>
        <label>Room No.:<input type="text" id="room_number" class="input-field"></label>
        <label>Stepdown Date:<input type="date" id="stepdown_date" class="input-field"></label>
        <label>Weight (kg):<input type="number" id="weight" class="input-field"></label>
        <label>Age:<input type="number" id="age" class="input-field"></label>
        <label>Admission Type:<select id="admission_type" class="input-field"><option>Elective Surgical</option><option>Emergency Surgical</option><option>Medical/ED</option></select></label>
        <label>ICU LOS (days):<input type="number" id="icu_los" class="input-field"></label>
        <label class="flex items-center pt-6"><input type="checkbox" id="after_hours" class="input-checkbox"> After-Hours Discharge</label>
    </div></details>`;

    document.getElementById('context-section').innerHTML = `<details class="form-section"><summary>Context & Plan</summary><div class="form-section-content space-y-4">
        <label class="font-medium">Reason for ICU Admission:<textarea id="reason_icu" class="input-field" rows="2"></textarea></label>
        <label class="font-medium">ICU Summary:<textarea id="icu_summary" class="input-field" rows="3"></textarea></label>
        <label class="font-medium">Past Medical History (PMH):<textarea id="pmh" class="input-field" rows="2"></textarea></label>
        <hr/>
        <div><label class="font-medium">Impression (IMP):</label><textarea id="clinical_impression" rows="3" class="input-field"></textarea></div>
        <div><label class="font-medium">Plan:</label><textarea id="clinical_plan" rows="4" class="input-field"></textarea></div>
        <hr/>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Category Upgrade</label><textarea id="override_reason" class="input-field" placeholder="Reason for upgrade..."></textarea></div>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_downgrade" class="input-checkbox"> Manual Category Downgrade</label><div class="grid grid-cols-2 gap-4"><select id="manual_downgrade_category" class="input-field"><option value="AMBER">Amber</option><option value="GREEN">Green</option></select><textarea id="downgrade_reason" class="input-field" placeholder="Reason for downgrade..."></textarea></div></div>
    </div></details>`;

    document.getElementById('bloods-section').innerHTML = `<details class="form-section" open><summary>Blood Panel</summary><div class="form-section-content grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div><label class="font-medium text-sm">Creatinine:<input type="number" id="creatinine" class="input-field"></label>${createTrendButtons('creatinine')}</div>
        <div><label class="font-medium text-sm">Lactate:<input type="number" id="lactate" class="input-field"></label>${createTrendButtons('lactate')}</div>
        <div><label class="font-medium text-sm">Hb:<input type="number" id="hb" class="input-field"></label>${createTrendButtons('hb')}</div>
        <div><label class="font-medium text-sm">Platelets:<input type="number" id="platelets" class="input-field"></label>${createTrendButtons('platelets')}</div>
        <div><label class="font-medium text-sm">Albumin:<input type="number" id="albumin" class="input-field"></label>${createTrendButtons('albumin')}</div>
        <div><label class="font-medium text-sm">CRP:<input type="number" id="crp" class="input-field"></label>${createTrendButtons('crp')}</div>
        <div><label class="font-medium text-sm">Glucose:<input type="number" id="glucose" class="input-field"></label>${createTrendButtons('glucose')}</div>
        <div><label class="font-medium text-sm">K+:<input type="number" id="k" class="input-field"></label>${createTrendButtons('k')}</div>
        <div><label class="font-medium text-sm">Mg++:<input type="number" id="mg" class="input-field"></label>${createTrendButtons('mg')}</div>
    </div></details>`;
        
    document.getElementById('assessment-section').innerHTML = `<details class="form-section" open><summary>A-E Assessment</summary><div class="form-section-content">
        <div class="mt-6 mb-4 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center"><span class="text-sm font-medium text-gray-500">ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>
        <div class="assessment-grid" style="align-items: end;">
            <div><label>Airway:<select id="airway" class="input-field"><option>Patent</option><option>At Risk</option><option>Tracheostomy</option></select></label></div>
            <div><label>Resp Rate:</label><div class="flex items-center gap-2"><input type="number" id="rr" class="input-field">${createTrendButtons('rr')}</div></div>
            <div><label>SpO2 (%):</label><div class="flex items-center gap-2"><input type="number" id="spo2" class="input-field">${createTrendButtons('spo2')}</div></div>
            <div><label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><div id="o2_flow_container" class="hidden"><label class="text-xs">Flow (L/min):<input type="number" id="o2_flow" class="input-field"></label></div><div id="fio2_container" class="hidden"><label class="text-xs">FiO2 (%):<input type="number" id="fio2" class="input-field"></label></div></div>
            <div><label>Heart Rate:</label><div class="flex items-center gap-2"><input type="number" id="hr" class="input-field">${createTrendButtons('hr')}</div></div>
            <label>Systolic BP:<input type="number" id="sbp" class="input-field"></label>
            <label>Diastolic BP:<input type="number" id="dbp" class="input-field"></label>
            <div><label>Temperature (°C):</label><div class="flex items-center gap-2"><input type="number" step="0.1" id="temp" class="input-field">${createTrendButtons('temp')}</div></div>
            <label>Consciousness:<select id="consciousness" class="input-field"><option>Alert</option><option>Voice</option><option>Pain</option><option>Unresponsive</option></select></label>
            <label>Cap Refill:<select id="cap_refill" class="input-field"><option value="<3s">< 3 sec</option><option value=">3s">> 3 sec</option></select></label>
            <label>Urine Output (last hr, mL):<input type="number" id="urine_output_hr" class="input-field"></label>
            <label>Delirium:<select id="delirium" class="input-field"><option value="0">None</option><option value="1">Mild</option><option value="2">Mod-Severe</option></select></label>
            <label>Pain Score (0-10):<input type="number" id="pain_score" class="input-field" min="0" max="10"></label>
            <label>Mobility:<select id="mobility" class="input-field"><option>Independent</option><option>Supervision</option><option>Requires Assistance</option><option>Bedbound</option></select></label>
            <label>Frailty (CFS):<input type="number" id="frailty_score" class="input-field" min="1" max="9"></label>
            <label>Bowels:<select id="bowels" class="input-field"><option>Normal</option><option>BNO</option><option>Diarrhoea</option></select></label>
            <label>Diet:<select id="diet" class="input-field"><option>Tolerating Full Diet</option><option>NBM</option><option>Other</option></select></label>
        </div>
        <div class="mt-4 p-4 border rounded-lg"><label class="font-medium text-sm flex items-center"><input type="checkbox" id="mods_enabled" class="input-checkbox">Vital Sign Modifications (MODS) in place</label>
            <div id="mods_details_container" class="hidden mt-2 space-y-2"><div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <label class="text-xs">Target SpO2 Min (%):<input type="number" id="target_spo2_min" class="input-field"></label>
                <label class="text-xs">Target SBP >:<input type="number" id="target_sbp" class="input-field"></label>
                <label class="text-xs">Target HR <:<input type="number" id="target_hr" class="input-field"></label>
            </div><label class="text-xs">Other MODS notes:<textarea id="mods_notes" class="input-field" rows="1"></textarea></label></div>
        </div>
    </div></details>`;
        
    document.getElementById('devices-section').innerHTML = `<details class="form-section"><summary>Devices</summary><div class="form-section-content space-y-4">
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="cvad_present" class="input-checkbox">CVAD</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="idc_present" class="input-checkbox">IDC</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="epicardial_wires_present" class="input-checkbox">Epicardial Pacing Wires</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="wounds_present" class="input-checkbox">Wounds</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="enteral_tube_present" class="input-checkbox">Enteral Tube</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="other_device_present" class="input-checkbox">Other Device</label><div id="other_device_details_container" class="hidden"><textarea id="other_device_details" class="input-field" rows="1"></textarea></div></div>
        <hr/>
        <div class="device-item"><div class="flex justify-between items-center"><h4 class="font-medium">PIVCs</h4><button type="button" id="add-pivc-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add PIVC</button></div><div id="pivc-container"></div></div>
        <hr/>
        <div class="device-item"><div class="flex justify-between items-center"><h4 class="font-medium">Drains</h4><button type="button" id="add-drain-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add Drain</button></div><div id="drains-container"></div></div>
    </div></details>`;

    // Add event listeners for dynamic elements
    document.getElementById('add-pivc-btn').addEventListener('click', () => addPivc());
    document.getElementById('add-drain-btn').addEventListener('click', () => addDrain());
    form.addEventListener('change', (e) => { // Using event delegation
        if (e.target.id === 'o2_device') {
            const device = e.target.value;
            document.getElementById('o2_flow_container').classList.toggle('hidden', !['NP', 'HFNP', 'NIV'].includes(device));
            document.getElementById('fio2_container').classList.toggle('hidden', !['HFNP', 'NIV'].includes(device));
        } else if (e.target.id === 'mods_enabled') {
            document.getElementById('mods_details_container').classList.toggle('hidden', !e.target.checked);
        } else if (e.target.id === 'other_device_present') {
            document.getElementById('other_device_details_container').classList.toggle('hidden', !e.target.checked);
        }
    });
 }
        
    initializeApp();
});
// --- SCRIPT END ---// --- SCRIPT START ---
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

  // --- Flag definitions ---
  const CRITICAL_PREDICATES = [
    { id: 'vasopressor_recent', label: 'Vasopressor or inotrope within last 24h', test: (d) => !!d.vasopressor_recent },
    { id: 'fio2_high', label: 'FiO2 >= 40% OR HFNP/NIV dependence', test: (d) => {
        const fio2 = p(d.fio2); const device = d.o2_device || '';
        if (!isNaN(fio2) && fio2 >= 40) return true;
        if (['HFNP','NIV'].includes(device)) {
          const targetSpo2Min = d.mods_enabled ? p(d.target_spo2_min) || 92 : 92;
          if (p(d.spo2) < targetSpo2Min) return true;
        }
        return false;
      }},
    { id: 'lactate_high', label: 'Lactate >= 4 mmol/L OR rapidly increasing lactate', test: (d) => {
        if (!isNaN(p(d.lactate)) && p(d.lactate) >= 4) return true;
        return d.lactate_trend === 'increasing' && !isNaN(p(d.lactate)) && p(d.lactate) >= 2.0;
      }},
    { id: 'unresponsive', label: 'Unresponsive', test: (d) => (d.consciousness === 'Unresponsive') },
    { id: 'airway_risk', label: 'Active airway risk', test: (d) => d.airway === 'At Risk' || d.airway === 'Tracheostomy' },
    { id: 'met_call', label: 'ADDS/MET call triggered', test: (d, adds) => adds && adds.metCall === true }
  ];

  const IMPORTANT_PREDICATES = [
    { id: 'creatinine_delta', label: 'New/worsening renal dysfunction', test: (d) => d.creatinine_trend === 'increasing' },
    { id: 'hemodynamic_instability', label: 'Haemodynamic instability outside targets', test: (d) => {
        const targetSbp = d.mods_enabled ? p(d.target_sbp) || 90 : 90;
        const targetHr = d.mods_enabled ? p(d.target_hr) || 140 : 140;
        return (!isNaN(p(d.sbp)) && p(d.sbp) < targetSbp) || (!isNaN(p(d.hr)) && p(d.hr) > targetHr);
      }},
    { id: 'platelets_low', label: 'Platelets < 50 or active bleeding', test: (d) => !isNaN(p(d.platelets)) && p(d.platelets) < 50 || d.active_bleeding === true },
    { id: 'delirium_mod', label: 'Moderate-severe delirium', test: (d) => p(d.delirium) >= 2 },
    { id: 'device_infection_risk', label: 'Device/line site concern', test: (d) => {
        if (d.cvad_present && d.cvad_site_health && d.cvad_site_health !== 'Clean & Healthy') return true;
        if (d.pivcs) return d.pivcs.some(pivc => pivc.site_health && pivc.site_health !== 'Clean & Healthy');
        return false;
    }},
    { id: 'oliguria_persistent', label: 'Persistent Oliguria (<0.5 mL/kg/hr)', test: (d) => {
        if (!isNaN(p(d.urine_output_hr)) && !isNaN(p(d.weight)) && p(d.weight)>0) {
          const mlkg = p(d.urine_output_hr) / p(d.weight);
          return mlkg < 0.5;
        }
        return false;
      }},
  ];

  function initializeApp() {
    populateStaticContent();
    setupEventListeners();
    const saved = localStorage.getItem('alertToolState_v_flag_v1');
    if (saved) { currentReview = JSON.parse(saved); loadReviewData(); } 
    else { updateRiskAssessment(); }
  }

  function gatherFormData() {
    const data = {};
    form.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return;
      data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    document.querySelectorAll('.trend-radio-group').forEach(group => {
      const checked = group.querySelector('input[type="radio"]:checked');
      if (checked) data[group.dataset.trendId] = checked.value;
    });

    data.pivcs = Array.from(document.querySelectorAll('.pivc-entry')).map(entry => ({
        commencement_date: entry.querySelector(`[id^="pivc_commencement_date_"]`)?.value,
        gauge: entry.querySelector(`[id^="pivc_gauge_"]`)?.value,
        site_health: entry.querySelector(`[id^="pivc_site_health_"]`)?.value,
        score: entry.querySelector(`[id^="pivc_score_"]`)?.value,
    }));
    data.drains = Array.from(document.querySelectorAll('.drain-entry')).map(entry => ({
        output_24hr: entry.querySelector(`[id^="drain_output_24hr_"]`)?.value,
        cumulative: entry.querySelector(`[id^="drain_output_cumulative_"]`)?.value,
    }));
    return data;
  }
  
  function saveState() {
    localStorage.setItem('alertToolState_v_flag_v1', JSON.stringify(gatherFormData()));
  }

  function loadReviewData() {
    Object.keys(currentReview).forEach(key => {
      const el = form.querySelector(`#${key}`);
      if (el) {
        if (el.type === 'checkbox') el.checked = currentReview[key];
        else el.value = currentReview[key];
      } else if (key.endsWith('_trend')) {
        document.querySelector(`input[name="${key}_radio"][value="${currentReview[key]}"]`)?.setAttribute('checked', true);
      }
    });

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
    pivcCounter = 0; drainCounter = 0;
    document.getElementById('pivc-container').innerHTML = '';
    document.getElementById('drains-container').innerHTML = '';
    updateRiskAssessment();
  }

  function calculateADDS(data) {
    let score = 0;
    let metCall = false;
    let metReason = '';

    const checkParam = (value, ranges) => {
        if (isNaN(value) || metCall) return;
        for (const r of ranges) {
            if ((r.min === -Infinity || value >= r.min) && (r.max === Infinity || value <= r.max)) {
                if (r.score === 'E') {
                    metCall = true;
                    metReason = r.note;
                } else {
                    score += r.score;
                }
                return;
            }
        }
    };

    checkParam(p(data.rr), [{min: -Infinity, max: 4, score: 'E', note: '<=4 => MET'},{min: 5, max: 8, score: 3}, {min: 9, max: 10, score: 2},{min: 11, max: 20, score: 0}, {min: 21, max: 24, score: 1},{min: 25, max: 30, score: 2}, {min: 31, max: 35, score: 3},{min: 36, max: Infinity, score: 'E', note: '>=36 => MET'}]);
    checkParam(p(data.spo2), [{min: -Infinity, max: 84, score: 'E', note: '<=84 => MET'},{min: 85, max: 88, score: 3}, {min: 89, max: 90, score: 2},{min: 91, max: 93, score: 1}, {min: 94, max: Infinity, score: 0}]);
    checkParam(p(data.o2_flow), [{min: 0, max: 5, score: 0}, {min: 6, max: 7, score: 1},{min: 8, max: 9, score: 2}, {min: 10, max: Infinity, score: 3}]);
    if (data.o2_device === 'HFNP') { score += 1; }
    checkParam(p(data.fio2), [{min: 28, max: 39, score: 2}, {min: 40, max: Infinity, score: 3}]);
    checkParam(p(data.hr), [{min: -Infinity, max: 30, score: 'E', note: '<=30 => MET'},{min: 31, max: 40, score: 3}, {min: 41, max: 50, score: 2},{min: 51, max: 99, score: 0}, {min: 100, max: 109, score: 1},{min: 110, max: 120, score: 2}, {min: 121, max: 129, score: 1},{min: 130, max: 139, score: 3},{min: 140, max: Infinity, score: 'E', note: '>=140 => MET'}]);
    checkParam(p(data.sbp), [{min: -Infinity, max: 40, score: 'E', note: 'extreme low -> MET'},{min: 41, max: 50, score: 3}, {min: 51, max: 60, score: 2},{min: 61, max: 70, score: 1}, {min: 71, max: 80, score: 0},{min: 81, max: 90, score: 3}, {min: 91, max: 100, score: 2},{min: 101, max: 110, score: 1}, {min: 111, max: 139, score: 0},{min: 140, max: 180, score: 1}, {min: 181, max: 200, score: 2},{min: 201, max: 220, score: 3},{min: 221, max: Infinity, score: 'E', note: '>=221 => MET'}]);
    checkParam(p(data.temp), [{min: -Infinity, max: 35, score: 3}, {min: 35.1, max: 36.0, score: 1},{min: 36.1, max: 37.5, score: 0}, {min: 37.6, max: 38.0, score: 1},{min: 38.1, max: 39.0, score: 2},{min: 39.1, max: Infinity, score: 'E', note: '>=39.1 => MET'}]);
    if (!metCall) {
        switch (data.consciousness) {
            case 'Unresponsive': metCall = true; metReason = 'Unresponsive'; break;
            case 'Pain': score += 2; break;
            case 'Voice': score += 1; break;
        }
    }

    document.getElementById('finalADDSScore').textContent = metCall ? 'MET' : score;
    return { score, metCall, metReason };
  }

  function evaluateFlags(data) {
    const adds = calculateADDS(data);
    const critical = CRITICAL_PREDICATES.map(p => p.test(data, adds) ? p.label : null).filter(Boolean);
    const important = IMPORTANT_PREDICATES.map(p => p.test(data) ? p.label : null).filter(Boolean);
    const afterHours = !!data.after_hours;

    let categoryKey = 'GREEN';
    if (critical.length > 0) categoryKey = 'RED';
    else if ((afterHours && important.length > 0) || important.length >= 2) categoryKey = 'RED';
    else if (important.length === 1) categoryKey = 'AMBER';

    if (data.manual_override && data.override_reason) categoryKey = 'RED';
    else if (data.manual_downgrade && data.downgrade_reason) categoryKey = data.manual_downgrade_category;
    return { categoryKey, critical, important, afterHours, adds };
  }
  
  function displayResults(result, data) {
    const category = CATEGORIES[result.categoryKey];
    document.getElementById('footer-category').textContent = category.text;
    document.getElementById('footer-critical-count').textContent = result.critical.length;
    document.getElementById('footer-important-count').textContent = `Important: ${result.important.length}`;
    document.getElementById('sticky-footer').className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex flex-col z-40 ${category.class}`;
    document.getElementById('summary-container').innerHTML = `<div class="summary-category ${category.class}">${category.text}</div>`;
  }

  function generateDMRSummary() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    
    const devices = [];
    if (data.pivcs.length) data.pivcs.forEach((p, i) => devices.push(`PIVC #${i+1}: ${p.gauge}, Score ${p.score || ''}, Health: ${p.site_health || ''}`));
    if (data.drains.length) data.drains.forEach((d, i) => devices.push(`Drain #${i+1}: ${d.output_24hr || ''}mL/24hr`));
    if (data.cvad_present) devices.push('CVAD Present');
    if (data.idc_present) devices.push('IDC Present');
    if (data.enteral_tube_present) devices.push(`Enteral Tube: ${data.enteral_tube_type} ${data.enteral_tube_type === 'Other' ? '('+data.enteral_tube_other+')' : ''}`);
    if (data.epicardial_wires_present) devices.push('Epicardial Pacing Wires');
    if (data.wounds_present) devices.push('Wounds Present');
    if (data.other_device_present) devices.push(`Other Device: ${data.other_device_details || ''}`);

    let a_e_summary = `ADDS: ${result.adds.metCall ? 'MET' : result.adds.score}\n`;
    a_e_summary += `A: Airway: ${data.airway || ''}\n`;
    a_e_summary += `B: RR ${data.rr || ''}, SpO2 ${data.spo2 || ''} on ${data.o2_device || ''} ${data.fio2 ? '(FiO2 ' + data.fio2 + '%)' : ''}\n`;
    a_e_summary += `C: HR ${data.hr || ''}, BP ${data.sbp || ''}/${data.dbp || ''}, CRT ${data.cap_refill || ''}\n`;
    a_e_summary += `D: Consciousness: ${data.consciousness || ''}, Delirium: ${data.delirium !== '0' ? data.delirium : ''}, Pain: ${data.pain_score || ''}/10`;

    const summary = `
ALERT CNS ${data.review_type || ''} on ward ${data.location || ''}
LOS: ${data.icu_los || ''} days
${CATEGORIES[result.categoryKey].text}

REASON FOR ICU: ${data.reason_icu || ''}
ICU SUMMARY: ${data.icu_summary || ''}
PMH: ${data.pmh || ''}

${a_e_summary.trim()}

DEVICES:
- ${devices.length ? devices.join('\n- ') : 'None'}

IMP:
${data.clinical_impression || ''}

Plan:
${data.clinical_plan || ''}
`.trim().replace(/\n\s*\n/g, '\n');

    document.getElementById('emrSummary').value = summary;
  }

  function updateRiskAssessment() {
    const data = gatherFormData();
    const result = evaluateFlags(data);
    displayResults(result, data);
    saveState();
    generateDMRSummary();
  }

  function setupEventListeners() {
    form.addEventListener('input', updateRiskAssessment);
    form.addEventListener('change', updateRiskAssessment);
    document.getElementById('startOverBtn').addEventListener('click', () => { if (confirm('Are you sure? This will clear all data.')) clearForm(); });
    document.getElementById('copySummaryButton').addEventListener('click', () => {
      document.getElementById('emrSummary').select();
      document.execCommand('copy');
      alert('DMR Summary Copied!');
    });
  }

  function addPivc(data = {}) {
      const container = document.getElementById('pivc-container');
      const entry = document.createElement('div');
      entry.className = 'pivc-entry mt-2 pt-2 border-t flex items-start gap-4';
      entry.innerHTML = `
        <div class="flex-grow grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
            <label class="text-sm">Commencement:<input type="date" id="pivc_commencement_date_${pivcCounter}" class="input-field" value="${data.commencement_date || ''}"></label>
            <label class="text-sm">Gauge:<select id="pivc_gauge_${pivcCounter}" class="input-field">
                <option ${data.gauge === '24G (Yellow)' ? 'selected' : ''}>24G (Yellow)</option><option ${data.gauge === '22G (Blue)' ? 'selected' : ''}>22G (Blue)</option><option ${data.gauge === '20G (Pink)' ? 'selected' : ''}>20G (Pink)</option><option ${data.gauge === '18G (Green)' ? 'selected' : ''}>18G (Green)</option><option ${data.gauge === '16G (Grey)' ? 'selected' : ''}>16G (Grey)</option>
            </select></label>
            <label class="text-sm">Site Health:<select id="pivc_site_health_${pivcCounter}" class="input-field"><option>Clean & Healthy</option><option>Redness/Swelling</option><option>Signs of Infection</option><option>Occluded/Poor Function</option></select></label>
            <label class="text-sm">VIP Score:<input type="number" id="pivc_score_${pivcCounter}" class="input-field" value="${data.score || ''}"></label>
            <div class="text-sm">Dwell: <span id="pivc_dwell_time_${pivcCounter}" class="font-bold">N/A</span> days</div>
        </div>
        <button type="button" class="remove-btn mt-1" onclick="this.parentElement.remove()">X</button>
      `;
      pivcCounter++;
      container.appendChild(entry);
  }

  function addDrain(data = {}) {
      const container = document.getElementById('drains-container');
      const entry = document.createElement('div');
      entry.className = 'drain-entry mt-2 pt-2 border-t flex items-start gap-4';
      entry.innerHTML = `
          <div class="flex-grow grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label class="text-sm">24hr Output (mL):<input type="number" id="drain_output_24hr_${drainCounter}" class="input-field" value="${data.output_24hr || ''}"></label>
              <label class="text-sm">Cumulative Output (mL):<input type="number" id="drain_output_cumulative_${drainCounter}" class="input-field" value="${data.cumulative || ''}"></label>
          </div>
          <button type="button" class="remove-btn mt-1" onclick="this.parentElement.remove()">X</button>`;
      drainCounter++;
      container.appendChild(entry);
  }

 function populateStaticContent() {
    const createTrendButtons = (id) => `<div class="trend-radio-group" data-trend-id="${id}_trend"><label title="Increasing"><input type="radio" name="${id}_trend_radio" value="increasing"><span>↑</span></label><label title="Stable"><input type="radio" name="${id}_trend_radio" value="stable" checked><span>→</span></label><label title="Decreasing"><input type="radio" name="${id}_trend_radio" value="decreasing"><span>↓</span></label></div>`;

    document.getElementById('patient-details-section').innerHTML = `<details class="form-section" open><summary>Patient & Review Details</summary><div class="form-section-content grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <label>Review Type:<select id="review_type" class="input-field"><option value="post">Post-ICU stepdown</option><option value="pre">Pre-ICU stepdown</option></select></label>
        <div class="grid grid-cols-2 gap-4"><label>Location:<select id="location" class="input-field"></select></label><div id="location_other_container" class="hidden"><label>Specify:<input type="text" id="location_other" class="input-field"></label></div></div>
        <label>Room No.:<input type="text" id="room_number" class="input-field"></label>
        <label>Stepdown Date:<input type="date" id="stepdown_date" class="input-field"></label>
        <label>Weight (kg):<input type="number" id="weight" class="input-field"></label>
        <label>Age:<input type="number" id="age" class="input-field"></label>
        <label>Admission Type:<select id="admission_type" class="input-field"><option>Elective Surgical</option><option>Emergency Surgical</option><option>Medical/ED</option></select></label>
        <label>ICU LOS (days):<input type="number" id="icu_los" class="input-field"></label>
        <label class="flex items-center pt-6"><input type="checkbox" id="after_hours" class="input-checkbox"> After-Hours Discharge</label>
    </div></details>`;

    document.getElementById('context-section').innerHTML = `<details class="form-section"><summary>Context & Plan</summary><div class="form-section-content space-y-4">
        <label class="font-medium">Reason for ICU Admission:<textarea id="reason_icu" class="input-field" rows="2"></textarea></label>
        <label class="font-medium">ICU Summary:<textarea id="icu_summary" class="input-field" rows="3"></textarea></label>
        <label class="font-medium">Past Medical History (PMH):<textarea id="pmh" class="input-field" rows="2"></textarea></label>
        <hr/>
        <div><label class="font-medium">Impression (IMP):</label><textarea id="clinical_impression" rows="3" class="input-field"></textarea></div>
        <div><label class="font-medium">Plan:</label><textarea id="clinical_plan" rows="4" class="input-field"></textarea></div>
        <hr/>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_override" class="input-checkbox"> Manual Category Upgrade</label><textarea id="override_reason" class="input-field" placeholder="Reason for upgrade..."></textarea></div>
        <div class="space-y-2"><label class="flex items-center"><input type="checkbox" id="manual_downgrade" class="input-checkbox"> Manual Category Downgrade</label><div class="grid grid-cols-2 gap-4"><select id="manual_downgrade_category" class="input-field"><option value="AMBER">Amber</option><option value="GREEN">Green</option></select><textarea id="downgrade_reason" class="input-field" placeholder="Reason for downgrade..."></textarea></div></div>
    </div></details>`;

    document.getElementById('bloods-section').innerHTML = `<details class="form-section" open><summary>Blood Panel</summary><div class="form-section-content grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div><label class="font-medium text-sm">Creatinine:<input type="number" id="creatinine" class="input-field"></label>${createTrendButtons('creatinine')}</div>
        <div><label class="font-medium text-sm">Lactate:<input type="number" id="lactate" class="input-field"></label>${createTrendButtons('lactate')}</div>
        <div><label class="font-medium text-sm">Hb:<input type="number" id="hb" class="input-field"></label>${createTrendButtons('hb')}</div>
        <div><label class="font-medium text-sm">Platelets:<input type="number" id="platelets" class="input-field"></label>${createTrendButtons('platelets')}</div>
        <div><label class="font-medium text-sm">Albumin:<input type="number" id="albumin" class="input-field"></label>${createTrendButtons('albumin')}</div>
        <div><label class="font-medium text-sm">CRP:<input type="number" id="crp" class="input-field"></label>${createTrendButtons('crp')}</div>
        <div><label class="font-medium text-sm">Glucose:<input type="number" id="glucose" class="input-field"></label>${createTrendButtons('glucose')}</div>
        <div><label class="font-medium text-sm">K+:<input type="number" id="k" class="input-field"></label>${createTrendButtons('k')}</div>
        <div><label class="font-medium text-sm">Mg++:<input type="number" id="mg" class="input-field"></label>${createTrendButtons('mg')}</div>
    </div></details>`;
        
    document.getElementById('assessment-section').innerHTML = `<details class="form-section" open><summary>A-E Assessment</summary><div class="form-section-content">
        <div class="mt-6 mb-4 bg-teal-50 p-4 rounded-lg border border-teal-200 text-center"><span class="text-sm font-medium text-gray-500">ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div>
        <div class="assessment-grid" style="align-items: end;">
            <div><label>Airway:<select id="airway" class="input-field"><option>Patent</option><option>At Risk</option><option>Tracheostomy</option></select></label></div>
            <div><label>Resp Rate:</label><div class="flex items-center gap-2"><input type="number" id="rr" class="input-field">${createTrendButtons('rr')}</div></div>
            <div><label>SpO2 (%):</label><div class="flex items-center gap-2"><input type="number" id="spo2" class="input-field">${createTrendButtons('spo2')}</div></div>
            <div><label>O₂ Device:<select id="o2_device" class="input-field"><option value="RA">Room Air</option><option value="NP">Nasal Prongs</option><option value="HFNP">High-Flow</option><option value="NIV">NIV/CPAP</option></select></label><div id="o2_flow_container" class="hidden"><label class="text-xs">Flow (L/min):<input type="number" id="o2_flow" class="input-field"></label></div><div id="fio2_container" class="hidden"><label class="text-xs">FiO2 (%):<input type="number" id="fio2" class="input-field"></label></div></div>
            <div><label>Heart Rate:</label><div class="flex items-center gap-2"><input type="number" id="hr" class="input-field">${createTrendButtons('hr')}</div></div>
            <label>Systolic BP:<input type="number" id="sbp" class="input-field"></label>
            <label>Diastolic BP:<input type="number" id="dbp" class="input-field"></label>
            <div><label>Temperature (°C):</label><div class="flex items-center gap-2"><input type="number" step="0.1" id="temp" class="input-field">${createTrendButtons('temp')}</div></div>
            <label>Consciousness:<select id="consciousness" class="input-field"><option>Alert</option><option>Voice</option><option>Pain</option><option>Unresponsive</option></select></label>
            <label>Cap Refill:<select id="cap_refill" class="input-field"><option value="<3s">< 3 sec</option><option value=">3s">> 3 sec</option></select></label>
            <label>Urine Output (last hr, mL):<input type="number" id="urine_output_hr" class="input-field"></label>
            <label>Delirium:<select id="delirium" class="input-field"><option value="0">None</option><option value="1">Mild</option><option value="2">Mod-Severe</option></select></label>
            <label>Pain Score (0-10):<input type="number" id="pain_score" class="input-field" min="0" max="10"></label>
            <label>Mobility:<select id="mobility" class="input-field"><option>Independent</option><option>Supervision</option><option>Requires Assistance</option><option>Bedbound</option></select></label>
            <label>Frailty (CFS):<input type="number" id="frailty_score" class="input-field" min="1" max="9"></label>
            <label>Bowels:<select id="bowels" class="input-field"><option>Normal</option><option>BNO</option><option>Diarrhoea</option></select></label>
            <label>Diet:<select id="diet" class="input-field"><option>Tolerating Full Diet</option><option>NBM</option><option>Other</option></select></label>
        </div>
        <div class="mt-4 p-4 border rounded-lg"><label class="font-medium text-sm flex items-center"><input type="checkbox" id="mods_enabled" class="input-checkbox">Vital Sign Modifications (MODS) in place</label>
            <div id="mods_details_container" class="hidden mt-2 space-y-2"><div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <label class="text-xs">Target SpO2 Min (%):<input type="number" id="target_spo2_min" class="input-field"></label>
                <label class="text-xs">Target SBP >:<input type="number" id="target_sbp" class="input-field"></label>
                <label class="text-xs">Target HR <:<input type="number" id="target_hr" class="input-field"></label>
            </div><label class="text-xs">Other MODS notes:<textarea id="mods_notes" class="input-field" rows="1"></textarea></label></div>
        </div>
    </div></details>`;
        
    document.getElementById('devices-section').innerHTML = `<details class="form-section"><summary>Devices</summary><div class="form-section-content space-y-4">
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="cvad_present" class="input-checkbox">CVAD</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="idc_present" class="input-checkbox">IDC</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="epicardial_wires_present" class="input-checkbox">Epicardial Pacing Wires</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="wounds_present" class="input-checkbox">Wounds</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="enteral_tube_present" class="input-checkbox">Enteral Tube</label></div>
        <div class="device-item"><label class="flex items-center font-medium"><input type="checkbox" id="other_device_present" class="input-checkbox">Other Device</label><div id="other_device_details_container" class="hidden"><textarea id="other_device_details" class="input-field" rows="1"></textarea></div></div>
        <hr/>
        <div class="device-item"><div class="flex justify-between items-center"><h4 class="font-medium">PIVCs</h4><button type="button" id="add-pivc-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add PIVC</button></div><div id="pivc-container"></div></div>
        <hr/>
        <div class="device-item"><div class="flex justify-between items-center"><h4 class="font-medium">Drains</h4><button type="button" id="add-drain-btn" class="bg-blue-100 text-blue-800 text-sm font-semibold py-1 px-3 rounded-lg">Add Drain</button></div><div id="drains-container"></div></div>
    </div></details>`;

    // Add event listeners for dynamic elements
    document.getElementById('add-pivc-btn').addEventListener('click', () => addPivc());
    document.getElementById('add-drain-btn').addEventListener('click', () => addDrain());
    form.addEventListener('change', (e) => { // Using event delegation
        if (e.target.id === 'o2_device') {
            const device = e.target.value;
            document.getElementById('o2_flow_container').classList.toggle('hidden', !['NP', 'HFNP', 'NIV'].includes(device));
            document.getElementById('fio2_container').classList.toggle('hidden', !['HFNP', 'NIV'].includes(device));
        } else if (e.target.id === 'mods_enabled') {
            document.getElementById('mods_details_container').classList.toggle('hidden', !e.target.checked);
        } else if (e.target.id === 'other_device_present') {
            document.getElementById('other_device_details_container').classList.toggle('hidden', !e.target.checked);
        }
    });
 }
        
    initializeApp();
});
// --- SCRIPT END ---
