// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let currentReview = {};
    let deviceCounters = {};

    const RISK_CATEGORIES = {
        extremely_high: { score: 10, text: 'Extremely High Risk: Urgent medical review & consider re-transfer to higher care.', class: 'category-extremely-high' },
        high: { score: 6, text: 'High Risk: Formal medical review required.', class: 'category-high' },
        medium: { score: 3, text: 'Medium Risk: Enhanced nurse-led care.', class: 'category-medium' },
        low: { score: 0, text: 'Low Risk: Single check next shift.', class: 'category-low' }
    };
    
    const form = document.getElementById('assessmentForm');

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        setupEventListeners();
        
        const savedState = localStorage.getItem('alertToolState_v24');
        if (savedState) {
            currentReview = JSON.parse(savedState);
            loadReviewData();
            document.getElementById('launchScreenModal').style.display = 'none';
            setAppViewMode(currentReview.mode || 'full');
        } else {
            document.getElementById('launchScreenModal').style.display = 'flex';
        }
    }
    
    function setAppViewMode(mode) {
        document.getElementById('main-content').style.visibility = 'visible';
        currentReview.mode = mode;
        const isQuickMode = mode === 'quick';
        document.getElementById('fullReviewContainer').style.display = isQuickMode ? 'none' : 'block';
        document.getElementById('assessment-container').style.display = 'block';
        document.getElementById('scoringContainer').style.display = 'block';
        document.getElementById('fullReviewContainerBottom').style.display = isQuickMode ? 'none' : 'block';
    }

    // --- DATA & STATE HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            if (!el.id) return;
            if (el.type === 'checkbox') data[el.id] = el.checked;
            else if (el.type === 'radio') { if(el.checked) data[el.name] = el.value; }
            else data[el.id] = el.value;
        });
        
        data.devices = {};
        ['central_lines', 'pivcs', 'idcs', 'drains', 'pacing_wires', 'others'].forEach(type => {
            const container = document.getElementById(`${type}_container`);
            if(!container) return;
            data.devices[type] = Array.from(container.querySelectorAll('.device-entry')).map(entry => {
                const deviceData = {};
                entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => deviceData[input.dataset.key] = input.value);
                return deviceData;
            });
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        currentReview.finalScore = parseInt(document.getElementById('footer-score').textContent) || 0;
        localStorage.setItem('alertToolState_v24', JSON.stringify(currentReview));
    }
    
    function loadReviewData(isHandoff = false) {
        const data = currentReview;
        // Clear dynamic content before loading
        document.querySelectorAll('.device-entry').forEach(el => el.remove());
        deviceCounters = {};

        Object.keys(data).forEach(key => {
            const el = form.querySelector(`#${key}`) || form.querySelector(`[name="${key}"]`);
            if (el) {
                if (el.type === 'checkbox') el.checked = data[key];
                 else if (el.type === 'radio') {
                    const radio = form.querySelector(`[name="${el.name}"][value="${data[el.name]}"]`);
                    if (radio) radio.checked = true;
                } else el.value = data[key];
            }
        });

        if (data.devices && !isHandoff) {
            ['central_lines', 'pivcs', 'idcs', 'drains', 'pacing_wires', 'others'].forEach(type => {
                if(data.devices[type]) {
                    const addFunc = window[`add${type.charAt(0).toUpperCase() + type.slice(1).replace(/s$/, '')}`];
                    if(addFunc) data.devices[type].forEach(d => addFunc(d));
                }
            });
        }
        
        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    }

    function clearForm(clearStorage = true) {
        form.reset();
        document.querySelectorAll('.device-entry').forEach(el => el.remove());
        deviceCounters = {};
        if (clearStorage) {
            localStorage.removeItem('alertToolState_v24');
            currentReview = {};
        }
        // Manually trigger change on selects to reset their data-score
        form.querySelectorAll('select.score-input').forEach(sel => sel.dispatchEvent(new Event('change')));
        calculateTotalScore();
    }
    
    // --- SCORING & INSIGHTS ---
    function calculateTotalScore() {
        let score = 0;
        const data = gatherFormData();

        if (data.age > 65) score += 1;
        score += parseInt(data.admission_type, 10) || 0;
        if (data.los_days > 5) score += 1;
        if (data.severe_comorbidities >= 2) score += 2;
        if (data.after_hours) score += 1;
        
        form.querySelectorAll('.score-input').forEach(input => {
             if (input.checked && input.type === 'checkbox') {
                 score += parseInt(input.dataset.score, 10) || 0;
             }
        });
        
        form.querySelectorAll('select.score-input').forEach(select => {
            score += parseInt(select.value, 10) || 0;
        });
        
        const bloodScore = calculateBloodScore();
        score += bloodScore.total;
        
        const addsResult = calculateADDS();
        score += addsResult.score;

        const footerScoreEl = document.getElementById('footer-score');
        const footerCategoryEl = document.getElementById('footer-category');
        footerScoreEl.textContent = score;
        const category = getRiskCategory(score);
        footerCategoryEl.textContent = category.text.split(':')[0].toUpperCase();
        document.getElementById('sticky-footer').className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        
        generateClinicalInsights(data, bloodScore.insights);
        saveState();
    }
    
    function getRiskCategory(score) {
        if (score >= RISK_CATEGORIES.extremely_high.score) return RISK_CATEGORIES.extremely_high;
        if (score >= RISK_CATEGORIES.high.score) return RISK_CATEGORIES.high;
        if (score >= RISK_CATEGORIES.medium.score) return RISK_CATEGORIES.medium;
        return RISK_CATEGORIES.low;
    }

    function calculateBloodScore() {
        let total = 0;
        const insights = {};
        const p = (id) => parseFloat(document.getElementById(id).value);
        const updateBadge = (id, score) => { 
            const badge = document.getElementById(id);
            if(badge) {
                badge.className = `blood-score-badge score-${score}`; 
                badge.textContent = `+${score}`; 
            }
        };

        const calc = (id, abs_rules, trend_rules) => {
            const current = p(id);
            const prev = p(`${id}_prev`);
            let abs_score = 0;
            let trend_score = 0;
            if (!isNaN(current)) { for (const rule of abs_rules) { if (rule.test(current)) { abs_score = rule.score; break; } } }
            if (!isNaN(current) && !isNaN(prev) && prev > 0) { for (const rule of trend_rules) { if (rule.test(current, prev)) { trend_score = rule.score; break; } } }
            const final_score = Math.max(abs_score, trend_score);
            insights[id] = { current, prev, score: final_score };
            updateBadge(`${id}_blood_score`, final_score);
            total += final_score;
        };

        calc('creatinine', [{ test: v => v > 171, score: 1 }], [{ test: (c, p) => (c - p) / p > 0.5, score: 2 }]);
        const nlr_val = p('neutrophils') / p('lymphocytes'); const nlr_score = nlr_val > 5 ? 1 : 0; total += nlr_score; updateBadge('nlr_blood_score', nlr_score); insights.nlr = { current: nlr_val, score: nlr_score };
        calc('albumin', [{ test: v => v < 30, score: 1 }], []);
        calc('rdw', [{ test: v => v > 15, score: 1 }], [{ test: (c, p) => c - p > 1, score: 2 }]);
        calc('lactate', [{ test: v => v > 2, score: 2 }], []);
        calc('bilirubin', [{ test: v => v > 20, score: 1 }], [{ test: (c, p) => c / p >= 2, score: 2 }]);
        calc('platelets', [{ test: v => v < 50, score: 2 },{ test: v => v < 100, score: 1 }], [{ test: (c, p) => (p - c) / p > 0.4, score: 2 }]);
        calc('hemoglobin', [{ test: v => v < 7, score: 2 }], []);
        calc('glucose', [{ test: v => v > 180, score: 2 }], []);
        
        document.getElementById('total_blood_score').textContent = total;
        return { total, insights };
    }
    
    function calculateADDS() {
        const p = (id) => parseFloat(document.getElementById(id).value);
        const getScore = (val, ranges) => { for (const r of ranges) { if (val >= r.min && val <= r.max) return r.score; } return 0; };
        let total = 0;
        const rr = p('rr_input'); if (!isNaN(rr)) total += getScore(rr, [{min:0, max:8, score:2}, {min:9, max:11, score:1}, {min:21, max:29, score:2}, {min:30, max:999, score:3}]);
        const spo2 = p('spo2_input'); if (!isNaN(spo2)) total += getScore(spo2, [{min:0, max:89, score:3}, {min:90, max:93, score:2}, {min:94, max:95, score:1}]);
        if (p('o2_flow_input') > 0 || p('fio2_input') > 21) total += 2;
        const hr = p('hr_input'); if (!isNaN(hr)) total += getScore(hr, [{min:0, max:39, score:2}, {min:40, max:49, score:1}, {min:100, max:119, score:1}, {min:120, max:999, score:2}]);
        const sbp = p('sbp_input'); if (!isNaN(sbp)) total += getScore(sbp, [{min:0, max:79, score:3}, {min:80, max:99, score:2}, {min:200, max:999, score:2}]);
        if (document.getElementById('consciousness_input').value !== 'Alert') total += 3;
        const temp = p('temp_input'); if (!isNaN(temp)) total += getScore(temp, [{min:0, max:35.0, score:2}, {min:38.1, max:38.9, score:1}, {min:39.0, max:99, score:2}]);
        
        const manualScore = p('manualADDSScore');
        const finalScore = document.getElementById('addsModificationCheckbox').checked && !isNaN(manualScore) ? manualScore : total;
        
        document.getElementById('calculatedADDSScore').textContent = total;
        document.getElementById('finalADDSScore').textContent = finalScore;
        
        return { score: finalScore };
    }

    function generateClinicalInsights(data, bloodInsights) {
        const container = document.getElementById('clinicalInsightsContainer');
        const insights = [];
        const createInsight = (text, level) => `<div class="insight-item level-${level}"><svg class="insight-item-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span class="insight-item-text">${text}</span></div>`;

        if (data.age > 65 && data.severe_comorbidities >= 2) insights.push(createInsight('<b>High-Risk Profile:</b> Patient has multiple baseline risk factors.', 'medium'));
        if (bloodInsights.nlr.score > 0 && bloodInsights.lactate.score > 0) insights.push(createInsight('<b>Systemic Inflammatory Response:</b> High NLR and elevated lactate suggest significant metabolic stress.', 'high'));
        if (bloodInsights.creatinine.score > 0 || bloodInsights.bilirubin.score > 0 || bloodInsights.platelets.score > 0) insights.push(createInsight('<b>Multi-Organ Dysfunction:</b> Markers for kidney, liver, or hematologic systems are abnormal.', 'high'));
        if (bloodInsights.hemoglobin.score > 0) insights.push(createInsight('<b>Significant Anemia:</b> Critically low Hemoglobin may impair tissue oxygenation.', 'high'));
        if (document.getElementById('map_low')?.checked && bloodInsights.lactate.score > 0) insights.push(createInsight('<b>Inadequate Perfusion (Shock):</b> Low MAP with elevated lactate is a critical finding.', 'high'));
        if (data.fluid_overload) insights.push(createInsight('<b>Fluid Overload:</b> May be straining cardiac and respiratory function.', 'medium'));
        
        container.innerHTML = insights.length ? insights.join('') : '<p class="text-gray-500">No specific risk patterns detected yet.</p>';
    }

    function generateDMRSummary() {
        const data = gatherFormData();
        const score = document.getElementById('footer-score').textContent;
        const category = getRiskCategory(score).text.split(':')[0];
        
        const insightsText = Array.from(document.querySelectorAll('.insight-item-text')).map(el => `- ${el.innerHTML.replace(/<b>|<\/b>/g, '')}`).join('\n');

        const devicesText = ['central_lines', 'pivcs', 'idcs', 'drains', 'pacing_wires', 'others']
            .map(type => {
                const deviceName = type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
                const entries = data.devices[type].map(d => d.details).filter(Boolean);
                return entries.length ? `${deviceName}: ${entries.join(', ')}` : '';
            })
            .filter(Boolean)
            .join('\n');
            
        const summary = `
ALERT NURSE REVIEW
------------------
PATIENT: ${data.patient_initials || ''}-${data.patient_urn_last4 || ''} | Age: ${data.age || 'N/A'} | Ward: ${data.ward || 'N/A'}-${data.room_number || 'N/A'}
ADMISSION: ${document.getElementById('admission_type').options[document.getElementById('admission_type').selectedIndex].text} | ICU LOS: ${data.los_days || 'N/A'} days

FINAL SCORE: ${score} (${category})
------------------
CLINICAL INSIGHTS:
${insightsText || 'No specific risk patterns detected.'}

KEY DATA
----------
A-E ASSESSMENT:
- Airway: ${data.airway_input || 'N/A'}
- Breathing: RR ${data.rr_input || 'N/A'}, SpO2 ${data.spo2_input || 'N/A'}% on ${data.o2_flow_input || 'N/A'}L or ${data.fio2_input || 'N/A'}% (PEEP ${data.peep_input || 'N/A'}, PS ${data.ps_input || 'N/A'})
- Circulation: HR ${data.hr_input || 'N/A'}, SBP ${data.sbp_input || 'N/A'}, MAP < 70: ${data.map_low ? 'Yes' : 'No'}
- Disability: ${data.consciousness_input || 'N/A'}
- Exposure: Temp ${data.temp_input || 'N/A'}°C
- FINAL ADDS SCORE: ${document.getElementById('finalADDSScore').textContent}

BLOODS:
- Scored: Cr ${data.creatinine || 'N/A'}, NLR ${isNaN(data.neutrophils/data.lymphocytes) ? 'N/A' : (data.neutrophils/data.lymphocytes).toFixed(1)}, Alb ${data.albumin||'N/A'}, Lac ${data.lactate||'N/A'}, Plt ${data.platelets||'N/A'}, Hb ${data.hemoglobin||'N/A'}, Gluc ${data.glucose||'N/A'}
- Other: K+ ${data.k_input||'N/A'}, Mg++ ${data.mg_input||'N/A'}

FLUID STATUS:
- Current Wt: ${data.current_weight||'N/A'}kg, Prev Wt: ${data.previous_weight||'N/A'}kg
- 24h Bal: ${data.fbc_24hr_input||'N/A'}mL, Total ICU Bal: ${data.fbc_total_input||'N/A'}mL
- Fluid Overload (>5L): ${data.fluid_overload ? 'Yes' : 'No'}

DEVICES:
${devicesText || 'No devices documented.'}

CLINICIAN NOTES:
- Reason for ICU: ${data.reason_icu || 'Not specified.'}
- ICU Summary: ${data.icu_summary || 'Not specified.'}
- Additional Notes: ${data.additionalNotes || 'None.'}
`;
        document.getElementById('emrSummary').value = summary.trim();
    }


    // --- EVENT LISTENERS & UI ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { setAppViewMode('full'); clearForm(); document.getElementById('launchScreenModal').style.display = 'none'; });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { setAppViewMode('quick'); clearForm(); document.getElementById('launchScreenModal').style.display = 'none'; });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => {
             const pastedText = document.getElementById('pasteDataInput').value;
             if (!pastedText) return;
             try {
                currentReview = JSON.parse(atob(pastedText));
                loadReviewData(true);
                document.getElementById('launchScreenModal').style.display = 'none';
                setAppViewMode('full');
             } catch(e) { alert('Invalid handoff key.'); }
        });
        document.getElementById('startOverBtn').addEventListener('click', () => { if (confirm('Are you sure? This will clear all data.')) { clearForm(true); document.getElementById('main-content').style.visibility = 'hidden'; document.getElementById('launchScreenModal').style.display = 'flex'; } });
        
        form.addEventListener('input', calculateTotalScore);
        form.addEventListener('change', calculateTotalScore);

        document.getElementById('generateSummaryButton').addEventListener('click', generateDMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { document.getElementById('emrSummary').select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
            const handoffData = {};
            const desktopFields = ['patient_initials', 'patient_urn_last4', 'ward', 'room_number', 'age', 'admission_type', 'los_days', 'severe_comorbidities', 'after_hours', 'reason_icu', 'icu_summary', 'creatinine', 'creatinine_prev', 'neutrophils', 'lymphocytes', 'albumin', 'albumin_prev', 'rdw', 'rdw_prev', 'lactate', 'lactate_prev', 'bilirubin', 'bilirubin_prev', 'platelets', 'platelets_prev', 'hemoglobin', 'hemoglobin_prev', 'glucose', 'glucose_prev', 'k_input', 'mg_input'];
            desktopFields.forEach(id => { const el = document.getElementById(id); if(el) handoffData[id] = el.type === 'checkbox' ? el.checked : el.value; });
            const key = btoa(JSON.stringify(handoffData));
            navigator.clipboard.writeText(key).then(() => alert('Handoff key copied to clipboard!'));
        });
        
        document.getElementById('devices-container').addEventListener('click', e => {
            if(e.target.id && e.target.id.includes('add')) {
                 const type = e.target.id.replace('addButton','');
                 window[`add${type}`]();
            }
             if (e.target.matches('.remove-device-btn')) {
                e.target.closest('.device-entry').remove();
            }
        });

        document.getElementById('assessment-container').addEventListener('change', e => {
            if (e.target.id === 'addsModificationCheckbox') {
                document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }
    
    // --- DYNAMIC CONTENT ---
    function populateStaticContent() {
        const createBloodInput = (label, id, unit) => `<div class="flex items-center gap-x-2 blood-score-item"><label class="block text-sm font-medium w-32">${label}</label><div class="flex-grow grid grid-cols-2 gap-x-2"><input type="number" step="0.1" id="${id}" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Current"><input type="number" step="0.1" id="${id}_prev" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Previous"></div><span class="text-xs text-gray-500 w-16">${unit}</span><span id="${id}_blood_score" class="blood-score-badge score-0">+0</span></div>`;
        document.getElementById('bloods-container').innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">Bloods</h2><div class="space-y-3">${createBloodInput('Creatinine', 'creatinine', 'µmol/L')}<div class="flex items-center gap-x-2 blood-score-item"><label class="block text-sm font-medium w-32">NLR</label><div class="flex-grow grid grid-cols-2 gap-x-2"><input type="number" step="0.1" id="neutrophils" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Neut"><input type="number" step="0.1" id="lymphocytes" class="w-full rounded-md border-2 p-2 text-sm" placeholder="Lymph"></div><span class="text-xs text-gray-500 w-16"></span><span id="nlr_blood_score" class="blood-score-badge score-0">+0</span></div>${createBloodInput('Albumin', 'albumin', 'g/L')}${createBloodInput('RDW', 'rdw', '%')}${createBloodInput('Lactate', 'lactate', 'mmol/L')}${createBloodInput('Bilirubin', 'bilirubin', 'µmol/L')}${createBloodInput('Platelets', 'platelets', 'x10⁹/L')}${createBloodInput('Hemoglobin', 'hemoglobin', 'g/dL')}${createBloodInput('Glucose', 'glucose', 'mg/dL')}</div><div class="mt-4 pt-4 border-t text-right font-bold text-lg">Total Blood Score: <span id="total_blood_score" class="text-teal-600">0</span></div> <div class="mt-6 pt-4 border-t"><h3 class="font-semibold text-gray-700 mb-2">Key Electrolytes (Non-Scored)</h3><div class="grid sm:grid-cols-2 gap-x-6 gap-y-4"><div><label>K+</label><input type="number" step="0.1" id="k_input" class="mt-1 w-full rounded-md border-2 p-2"><div class="flex gap-x-2 mt-1"><label class="text-xs flex items-center"><input type="checkbox" id="k_replaced" class="mr-1">Replaced</label><label class="text-xs flex items-center"><input type="checkbox" id="k_planned" class="mr-1">Planned</label></div></div><div><label>Mg++</label><input type="number" step="0.1" id="mg_input" class="mt-1 w-full rounded-md border-2 p-2"><div class="flex gap-x-2 mt-1"><label class="text-xs flex items-center"><input type="checkbox" id="mg_replaced" class="mr-1">Replaced</label><label class="text-xs flex items-center"><input type="checkbox" id="mg_planned" class="mr-1">Planned</label></div></div></div></div>`;
        document.getElementById('assessment-container').innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">A-E Assessment & ADDS</h2><div class="space-y-6"><div><h3 class="assessment-section-title">A: Airway</h3><select id="airway_input" class="w-full rounded-md border-2 p-2"><option>Clear and maintained</option><option>Airway at risk / requires adjunct</option></select></div><div><h3 class="assessment-section-title">B: Breathing</h3><div class="assessment-grid"><label>Resp Rate:<input type="number" id="rr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>SpO2 (%):<input type="number" id="spo2_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>O2 Flow (L/min):<input type="number" id="o2_flow_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>FiO2 (%):<input type="number" id="fio2_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>PEEP:<input type="number" id="peep_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>Pressure Support:<input type="number" id="ps_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label></div></div><div><h3 class="assessment-section-title">C: Circulation</h3><div class="assessment-grid"><label>Heart Rate:<input type="number" id="hr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><label>Systolic BP:<input type="number" id="sbp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label><div class="p-2 bg-amber-100 rounded-md"><label class="flex items-center font-medium h-full"><input type="checkbox" id="map_low" class="score-input mr-2 h-4 w-4" data-score="2">MAP < 70 mmHg</label></div></div></div><div><h3 class="assessment-section-title">D: Disability</h3><select id="consciousness_input" class="vital-input w-full rounded-md border-2 p-2"><option>Alert</option><option>Voice</option><option>Pain</option><option>Unresponsive</option></select></div><div><h3 class="assessment-section-title">E: Exposure</h3><label>Temperature (°C):<input type="number" step="0.1" id="temp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></label></div></div><div class="mt-6 bg-gray-100 p-4 rounded-lg border"><label class="flex items-center"><input type="checkbox" id="addsModificationCheckbox"> <span class="ml-2 text-sm font-medium">Apply MODS to ADDS</span></label><div id="addsModificationDetails" class="hidden ml-6 mt-4 space-y-4"><div><label class="block text-sm font-medium">Manual Override ADDS Score:</label><input type="number" id="manualADDSScore" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label class="block text-sm font-medium">Rationale:</label><textarea id="addsModificationText" rows="2" class="mt-1 w-full rounded-md border-2 p-2"></textarea></div></div></div><div class="mt-6 grid grid-cols-2 gap-4 text-center"><div class="bg-blue-50 p-4 rounded-lg border border-blue-200"><span class="text-sm font-medium text-gray-500">CALCULATED ADDS</span><div id="calculatedADDSScore" class="font-bold text-5xl my-2">0</div></div><div class="bg-teal-50 p-4 rounded-lg border border-teal-200"><span class="text-sm font-medium text-gray-500">FINAL ADDS SCORE</span><div id="finalADDSScore" class="font-bold text-5xl my-2">0</div></div></div>`;
        document.getElementById('scoringContainer').innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">Clinical Risk Factors</h2><div class="space-y-2"><label class="list-score-option"><input type="checkbox" class="score-input" data-score="3" id="met_criteria"><span class="score-label">Patient is in MET Criteria</span><span class="score-value">+3</span></label><label class="list-score-option"><input type="checkbox" class="score-input" data-score="2" id="increasing_o2"><span class="score-label">Increasing O₂ Trend</span><span class="score-value">+2</span></label><label class="list-score-option"><input type="checkbox" class="score-input" data-score="2" id="rapid_wean"><span class="score-label">Rapid Wean of Resp Support</span><span class="score-value">+2</span></label><label class="list-score-option"><input type="checkbox" class="score-input" data-score="1" id="high_risk_airway"><span class="score-label">High Risk Airway</span><span class="score-value">+1</span></label><label class="list-score-option"><input type="checkbox" class="score-input" data-score="1" id="high_risk_drain"><span class="score-label">High Risk Drain</span><span class="score-value">+1</span></label><div><label class="block font-medium mb-1">Pain Score:</label><select id="pain_score" class="score-input w-full rounded-md border-2 p-2"><option value="0">None / Well Controlled</option><option value="1">Significant / PRN Use</option><option value="2">High / PCA / APS Review</option></select></div><div><label class="block font-medium mb-1">Gastrointestinal:</label><div class="pl-2 border-l-2"><label class="flex items-center mt-2"><input type="checkbox" id="gi_nbm" class="score-input mr-2" data-score="2">NBM/NG/TPN</label><label class="flex items-center mt-2"><input type="checkbox" id="gi_ileus" class="score-input mr-2" data-score="1">Ileus / Bowels not opened >3 days</label></div></div><div><label class="block font-medium mb-1">Delirium:</label><select id="delirium" class="score-input w-full rounded-md border-2 p-2"><option value="0">None</option><option value="1">Mild</option><option value="2">Moderate-Severe</option></select></div><div><label class="block font-medium mb-1">Mobility:</label><select id="mobility" class="score-input w-full rounded-md border-2 p-2"><option value="0">Baseline</option><option value="0">Limited due to lines/attachments</option><option value="1">Assisted</option><option value="2">Bed-bound</option></select></div><div><label class="block font-medium mb-1">Frailty (Pre-hospital):</label><select id="frailty" class="score-input w-full rounded-md border-2 p-2"><option value="0">Not Frail</option><option value="1">Mild</option><option value="2">Moderate-Severe</option></select></div><div><label class="block font-medium mb-1">Staffing (Reducer):</label><select id="staffing" class="score-input w-full rounded-md border-2 p-2"><option value="0">Standard Ratio</option><option value="-1">Enhanced Care (1:1, 1:2)</option></select></div></div>`;
        document.getElementById('devices-container').innerHTML = `<div><h4 class="font-medium">CVADs</h4><div id="central_lines_container" class="space-y-2"></div><button type="button" id="addCentralLineButton" class="no-print mt-2 text-sm bg-rose-100 px-3 py-1 rounded-md">+ Add CVAD</button></div><div class="mt-4 pt-4 border-t"><h4 class="font-medium">PIVCs</h4><div id="pivcs_container" class="space-y-2"></div><button type="button" id="addPivcButton" class="no-print mt-2 text-sm bg-blue-100 px-3 py-1 rounded-md">+ Add PIVC</button></div><div class="mt-4 pt-4 border-t"><h4 class="font-medium">IDCs</h4><div id="idcs_container" class="space-y-2"></div><button type="button" id="addIdcButton" class="no-print mt-2 text-sm bg-gray-100 px-3 py-1 rounded-md">+ Add IDC</button></div><div class="mt-4 pt-4 border-t"><h4 class="font-medium">Drains</h4><div id="drains_container" class="space-y-2"></div><button type="button" id="addDrainButton" class="no-print mt-2 text-sm bg-teal-100 px-3 py-1 rounded-md">+ Add Drain</button></div><div class="mt-4 pt-4 border-t"><h4 class="font-medium">Pacing Wires</h4><div id="pacing_wires_container" class="space-y-2"></div><button type="button" id="addPacingWireButton" class="no-print mt-2 text-sm bg-purple-100 px-3 py-1 rounded-md">+ Add Pacing Wires</button></div><div class="mt-4 pt-4 border-t"><h4 class="font-medium">Other</h4><div id="others_container" class="space-y-2"></div><button type="button" id="addOtherButton" class="no-print mt-2 text-sm bg-gray-100 px-3 py-1 rounded-md">+ Add Other</button></div>`;
        document.getElementById('fluid-assessment-container').innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">Fluid Status</h2><div class="grid grid-cols-1 sm:grid-cols-2 gap-4"><label>Current Weight (kg)<input type="number" id="current_weight" class="mt-1 w-full rounded-md border-2 p-2"></label><label>Previous Weight (kg)<input type="number" id="previous_weight" class="mt-1 w-full rounded-md border-2 p-2"></label><label>24hr Fluid Balance (mL)<input type="number" id="fbc_24hr_input" class="mt-1 w-full rounded-md border-2 p-2"></label><label>Total ICU Balance (mL)<input type="number" id="fbc_total_input" class="mt-1 w-full rounded-md border-2 p-2"></label><div class="p-2 bg-amber-100 rounded-md flex items-center sm:col-span-2"><label class="flex items-center font-medium h-full"><input type="checkbox" id="fluid_overload" class="score-input mr-2 h-4 w-4" data-score="2">Significant Fluid Overload (>5L Cumulative)</label></div></div>`;
        const wardSelect = document.getElementById('ward');
        const wards = ['CCU', '3A', '3C', '3D', '4A', '4B', '4C', '4D', '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D', '7A', '7B', '7C', '7D', 'Other'];
        wardSelect.innerHTML = `<option value="">Select Ward...</option>` + wards.map(w => `<option value="${w}">${w}</option>`).join('');
    }

    // --- DEVICE MANAGEMENT ---
    const addDevice = (type, containerId, html) => { deviceCounters[type] = (deviceCounters[type] || 0) + 1; document.getElementById(containerId).insertAdjacentHTML('beforeend', `<div id="${type}_${deviceCounters[type]}" class="device-entry bg-white p-3 rounded-md border space-y-2">${html}<button type="button" class="remove-device-btn text-xs text-red-600 hover:underline no-print">Remove</button></div>`); };
    window.addCentralLine = (d={}) => addDevice('cvad', 'central_lines_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., PICC, R IJ, Day 5" class="p-1 border rounded-md w-full text-sm">`);
    window.addPivc = (d={}) => addDevice('pivc', 'pivcs_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., L Forearm, 20G, Day 2" class="p-1 border rounded-md w-full text-sm">`);
    window.addIdc = (d={}) => addDevice('idc', 'idcs_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., 16Ch, Day 3" class="p-1 border rounded-md w-full text-sm">`);
    window.addDrain = (d={}) => addDevice('drain', 'drains_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., Blake Drain R Chest, 50ml/24h" class="p-1 border rounded-md w-full text-sm">`);
    window.addPacingWire = (d={}) => addDevice('pacing', 'pacing_wires_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., Atrial x2, Ventricular x2" class="p-1 border rounded-md w-full text-sm">`);
    window.addOther = (d={}) => addDevice('other', 'others_container', `<input type="text" data-key="details" value="${d.details||''}" placeholder="e.g., Wound Vac R Leg" class="p-1 border rounded-md w-full text-sm">`);
        
    initializeApp();
});

