// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let patients = [];
    let currentPatientId = null;
    let deviceCounters = {};

    const RISK_CATEGORIES = {
        critical: { score: 25, text: 'CRITICAL: Escalate to ICU Liaison / MET / Critical Care', class: 'category-critical' },
        intensive_escalate: { score: 20, text: 'INTENSIVE+: Escalate to ICU Liaison / ANM', class: 'category-intensive-escalate' },
        intensive: { score: 11, text: 'INTENSIVE: Requires multiple reviews per day', class: 'category-intensive' },
        standard: { score: 5, text: 'STANDARD: At least one follow-up review required', class: 'category-standard' },
        single: { score: 0, text: 'SINGLE: Follow-up as required', class: 'category-single' }
    };
    
    const form = document.getElementById('assessmentForm');

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        loadState();
        const launchModal = document.getElementById('launchScreenModal');
        const mainContent = document.getElementById('main-content');
        if (patients.length > 0 && currentPatientId) {
            renderTabs();
            switchPatientTab(currentPatientId);
            mainContent.style.visibility = 'visible';
            launchModal.style.display = 'none';
        } else {
            launchModal.style.display = 'flex';
        }
        setupEventListeners();
    }

    // --- PATIENT & TAB MANAGEMENT ---
    function generatePatientId() { return `p_${Date.now()}`; }
    
    function addPatient(mode = 'full') {
        if (currentPatientId) saveCurrentPatientData();
        const newPatientId = generatePatientId();
        patients.push({ id: newPatientId, data: {}, name: `Patient ${patients.length + 1}` });
        currentPatientId = newPatientId;
        
        clearForm();
        setAppViewMode(mode);
        renderTabs();
        switchPatientTab(newPatientId);
    }
    
    function switchPatientTab(patientId) {
        if (!patientId) return;
        if (currentPatientId && currentPatientId !== patientId) saveCurrentPatientData();
        
        currentPatientId = patientId;
        loadPatientData(patientId);
        renderTabs();
        calculateTotalScore();
    }

    function deletePatient(patientId) {
        const index = patients.findIndex(p => p.id === patientId);
        if (index > -1) patients.splice(index, 1);
        if (currentPatientId === patientId) {
            currentPatientId = patients.length > 0 ? patients[Math.max(0, index - 1)].id : null;
        }
        if (patients.length === 0) {
            addPatient();
        } else {
            switchPatientTab(currentPatientId || patients[0].id);
        }
    }
    
    function renderTabs() {
        const container = document.getElementById('patientTabsContainer');
        container.innerHTML = '';
        patients.forEach(patient => {
            const score = patient.data?.finalScore || 0;
            const riskClass = getRiskCategory(score).class;
            const tab = document.createElement('div');
            tab.className = `patient-tab ${patient.id === currentPatientId ? 'active' : ''}`;
            tab.dataset.patientId = patient.id;
            tab.innerHTML = `<span class="tab-score-badge ${riskClass}">${score}</span><span class="tab-name">${patient.name}</span><button class="delete-patient-btn no-print" data-patient-id="${patient.id}">&times;</button>`;
            container.appendChild(tab);
            if (patient.id === currentPatientId) updateTabRiskClass(tab);
        });
        saveState();
    }

    function updateTabRiskClass(tabElement) {
        const patient = patients.find(p => p.id === tabElement.dataset.patientId);
        if (!patient || !patient.data) return;
        const categoryInfo = getRiskCategory(patient.data.finalScore || 0);
        const riskClass = { 'category-critical': 'risk-critical', 'category-intensive-escalate': 'risk-intensive-escalate', 'category-intensive': 'risk-intensive', 'category-standard': 'risk-standard', 'category-single': 'risk-single' }[categoryInfo.class] || 'risk-single';
        tabElement.className = `patient-tab ${patient.id === currentPatientId ? 'active' : ''} ${riskClass}`;
    }

    // --- DATA & STATE HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            const key = el.id || el.name;
            if (!key || el.closest('.device-entry, .allergy-item')) return;
            if (el.type === 'checkbox') data[key] = el.checked;
            else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
            else data[key] = el.value;
        });
        data.allergies = Array.from(document.querySelectorAll('.allergy-item')).map(item => ({ name: item.querySelector('input[data-type="name"]').value, reaction: item.querySelector('input[data-type="reaction"]').value }));
        data.devices = {};
        ['central_lines', 'pivcs', 'idcs', 'others'].forEach(type => {
            data.devices[type] = Array.from(document.getElementById(`${type}_container`).querySelectorAll('.device-entry')).map(entry => {
                const deviceData = {};
                entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                    if (input.dataset.key) deviceData[input.dataset.key] = input.value;
                });
                return deviceData;
            });
        });
        return data;
    }

    function saveCurrentPatientData() {
        if (!currentPatientId) return;
        const patient = patients.find(p => p.id === currentPatientId);
        if (!patient) return;
        const formData = gatherFormData();
        patient.data = JSON.parse(JSON.stringify(formData));
        patient.name = formData.patientInitials || `Patient ${patients.findIndex(p => p.id === currentPatientId) + 1}`;
        patient.data.finalScore = parseInt(document.getElementById('updatedTotalScore').textContent) || 0;
        saveState();
    }
    
    function loadPatientData(patientId) {
        clearForm();
        const patient = patients.find(p => p.id === patientId);
        if (!patient || !patient.data) return;
        const data = JSON.parse(JSON.stringify(patient.data));
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
        if (data.allergies) data.allergies.forEach(a => addAllergy(a.name, a.reaction));
        if (data.devices) {
             ['central_lines', 'pivcs', 'idcs', 'others'].forEach(type => {
                if (data.devices[type]) {
                    const addFunc = window[`add${type.charAt(0).toUpperCase() + type.slice(1).replace(/s$/, '')}`];
                    if (addFunc) data.devices[type].forEach(device => addFunc(device));
                }
            });
        }
        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    }

    function clearForm() {
        form.reset();
        deviceCounters = {};
        document.querySelectorAll('.device-entry, .allergy-item').forEach(el => el.remove());
        form.querySelectorAll('input, select, textarea').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        calculateTotalScore();
        calculateADDS();
    }
    
    function saveState() { localStorage.setItem('alertToolState_v12', JSON.stringify({ patients, currentPatientId })); }
    function loadState() {
        const state = JSON.parse(localStorage.getItem('alertToolState_v12'));
        if (state) {
            patients = state.patients || [];
            currentPatientId = state.currentPatientId;
        }
    }
    function clearAllData() {
        if (confirm('Are you sure you want to delete ALL patient data?')) {
            patients = []; currentPatientId = null;
            localStorage.removeItem('alertToolState_v12');
            addPatient();
        }
    }
    
    function setAppViewMode(mode) {
        const fullReviewContainer = document.getElementById('fullReviewContainer');
        const fullReviewContainerBottom = document.getElementById('fullReviewContainerBottom');
        if (mode === 'quick') {
            fullReviewContainer.style.display = 'none';
            fullReviewContainerBottom.style.display = 'none';
        } else {
            fullReviewContainer.style.display = 'block';
            fullReviewContainerBottom.style.display = 'block';
        }
    }

    // --- SCORING & CALCULATIONS ---
    function calculateTotalScore() {
        let score = 0;
        const hasCriticalItem = Array.from(form.querySelectorAll('.score-input:checked')).some(input => {
            score += parseInt(input.dataset.score, 10) || 0;
            return input.dataset.isCritical === 'true';
        });
        const totalScoreEl = document.getElementById('updatedTotalScore');
        totalScoreEl.title = '';
        if (hasCriticalItem && score < RISK_CATEGORIES.critical.score) {
            score = RISK_CATEGORIES.critical.score;
            totalScoreEl.textContent = `${score}*`;
            totalScoreEl.title = '*Score elevated due to critical risk item.';
        } else {
             totalScoreEl.textContent = score;
        }
        const category = getRiskCategory(score);
        const categoryEl = document.getElementById('updatedRiskCategory');
        categoryEl.textContent = category.text;
        categoryEl.className = `text-xl font-bold p-3 rounded-md mt-1 transition-all duration-300 ${category.class}`;
        if (currentPatientId) saveCurrentPatientData();
    }
    
    function getRiskCategory(score) {
        for (const key in RISK_CATEGORIES) { if (score >= RISK_CATEGORIES[key].score) return RISK_CATEGORIES[key]; }
        return RISK_CATEGORIES.single;
    }

    function calculateADDS() {
        const getScore = (val, ranges) => { for (const r of ranges) { if (val >= r.min && val <= r.max) return { score: r.score, text: r.text }; } return { score: 0, text: null }; };
        const p = (id) => parseFloat(document.getElementById(id).value);
        let total = 0; let breakdown = [];
        const rr = p('rr_input'); if (!isNaN(rr)) { const res = getScore(rr, [{min:0, max:8, score:2, text:"RR Low"}, {min:9, max:11, score:1, text:"RR Low"}, {min:21, max:29, score:2, text:"RR High"}, {min:30, max:999, score:3, text:"RR High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const spo2 = p('spo2_input'); if (!isNaN(spo2)) { const res = getScore(spo2, [{min:0, max:89, score:3, text:"SpO2 Low"}, {min:90, max:93, score:2, text:"SpO2 Low"}, {min:94, max:95, score:1, text:"SpO2 Low"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const o2 = p('o2_flow_input'); if (!isNaN(o2) && o2 > 0) { total += 2; breakdown.push("On O2"); }
        const hr = p('hr_input'); if (!isNaN(hr)) { const res = getScore(hr, [{min:0, max:39, score:2, text:"HR Low"}, {min:40, max:49, score:1, text:"HR Low"}, {min:100, max:119, score:1, text:"HR High"}, {min:120, max:999, score:2, text:"HR High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const sbp = p('sbp_input'); if (!isNaN(sbp)) { const res = getScore(sbp, [{min:0, max:79, score:3, text:"SBP Low"}, {min:80, max:99, score:2, text:"SBP Low"}, {min:200, max:999, score:2, text:"SBP High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        const cons = p('consciousness_input'); if (!isNaN(cons) && cons > 0) { total += 3; breakdown.push("Consciousness Not Alert"); }
        const temp = p('temp_input'); if (!isNaN(temp)) { const res = getScore(temp, [{min:0, max:35.0, score:2, text:"Temp Low"}, {min:38.1, max:38.9, score:1, text:"Temp High"}, {min:39.0, max:99, score:2, text:"Temp High"}]); total += res.score; if(res.text) breakdown.push(res.text);}
        document.getElementById('calculatedADDSScore').textContent = total;
        document.getElementById('addsBreakdown').textContent = breakdown.length > 0 ? breakdown.join(', ') : 'Normal Parameters';
    }

    // --- DEVICE MANAGEMENT ---
    function createDeviceEntryHTML(id, content) { return `<div id="${id}" class="device-entry bg-white p-3 rounded-md border space-y-2">${content}<button type="button" class="remove-device-btn text-xs text-red-600 hover:underline no-print">Remove</button></div>`;}
    window.addCentral_line = function(data = {}) { deviceCounters.central = (deviceCounters.central || 0) + 1; document.getElementById('central_lines_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`central_${deviceCounters.central}`, `<div class="grid grid-cols-2 gap-2 text-sm"><input type="text" data-key="type" value="${data.type || ''}" placeholder="Type (e.g., PICC)" class="p-1 border rounded-md"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md col-span-2"></div>`)); }
    window.addPivc = function(data = {}) { deviceCounters.pivc = (deviceCounters.pivc || 0) + 1; document.getElementById('pivcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pivc_${deviceCounters.pivc}`, `<div class="grid grid-cols-2 gap-2 text-sm"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md"></div>`)); }
    window.addIdc = function(data = {}) { deviceCounters.idc = (deviceCounters.idc || 0) + 1; document.getElementById('idcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`idc_${deviceCounters.idc}`, `<div class="grid grid-cols-2 gap-2 text-sm items-center"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="12" ${data.size === '12' ? 'selected' : ''}>12 Ch</option><option value="14" ${data.size === '14' ? 'selected' : ''}>14 Ch</option><option value="16" ${data.size === '16' ? 'selected' : ''}>16 Ch</option></select></div>`)); }
    window.addOther = function(data = {}) { deviceCounters.other = (deviceCounters.other || 0) + 1; document.getElementById('others_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`other_${deviceCounters.other}`, `<div><input type="text" data-key="description" value="${data.description || ''}" placeholder="Device/Wound Description" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    function addAllergy(name = '', reaction = '') { document.getElementById('allergies_container').insertAdjacentHTML('beforeend', `<div class="allergy-item flex items-center gap-2"><input type="text" data-type="name" value="${name}" placeholder="Allergen" class="flex-grow p-1 border rounded-md text-sm"><input type="text" data-type="reaction" value="${reaction}" placeholder="Reaction" class="flex-grow p-1 border rounded-md text-sm"><button type="button" class="remove-allergy-btn text-red-500 font-bold no-print">&times;</button></div>`);}
    
    // --- DMR & HANDOFF NOTE ---
    function generateEMRSummary() {
        const val = (id) => document.getElementById(id)?.value?.trim() || 'N/A';
        const isChecked = (id) => document.getElementById(id)?.checked;
        let summary = `ALERT NURSE REVIEW:\n\n--- PATIENT & REVIEW DETAILS ---\n`;
        summary += `Patient: ${val('patientInitials')}\nLocation: ${val('wardAndRoom')}\n`;
        summary += `ICU Stepdown: ${val('icuStepdownDate')} @ ${val('icuStepdownTime')}\nICU LOS: ${val('losDays')} days\n`;
        
        summary += `\n--- CLINICAL BACKGROUND ---\n`;
        summary += `GOC: ${val('goc') || 'N/A'}${val('gocSpecifics') ? ` (${val('gocSpecifics')})` : ''}\n`;
        const precautions = Array.from(document.querySelectorAll('.precaution-cb:checked')).map(cb => cb.value).join(', ');
        summary += `Infection Control: ${precautions || 'None'}${precautions ? ` (Reason: ${val('infectionControlReason')})` : ''}\n`;
        if (isChecked('nkdaCheckbox')) { summary += `Allergies: NKDA\n`; }
        else { const allergies = Array.from(document.querySelectorAll('.allergy-item')).map(item => `${item.querySelector('input[data-type="name"]').value} (${item.querySelector('input[data-type="reaction"]').value})`).join('; '); summary += `Allergies: ${allergies || 'None'}\n`; }
        
        summary += `\n--- OBSERVATIONS (ADDS) ---\n`;
        summary += `Calculated ADDS: ${document.getElementById('calculatedADDSScore').textContent} (${document.getElementById('addsBreakdown').textContent})\n`;
        if(isChecked('addsModificationCheckbox')) { summary += `MODIFIED ADDS: ${val('manualADDSScore')} (Rationale: ${val('addsModificationText')})\n`; }
        summary += `Vitals: RR ${val('rr_input')}, SpO2 ${val('spo2_input')}% on ${val('o2_flow_input')}${val('o2_unit_input')}, HR ${val('hr_input')}, BP ${val('sbp_input')}/${val('dbp_input')}, Temp ${val('temp_input')}C\n`;
        
        summary += `\n--- RISK ASSESSMENT ---\n`;
        summary += `Final Score: ${document.getElementById('updatedTotalScore').textContent}\nCategory & Action: ${document.getElementById('updatedRiskCategory').textContent}\n`;
        if (isChecked('systemic_after_hours_checkbox')) {
            const stepdownTimeEl = document.getElementById('icuStepdownTime');
            const isOOH = stepdownTimeEl.options[stepdownTimeEl.selectedIndex].dataset.ooh === 'true';
            if ((new Date() - new Date(val('icuStepdownDate'))) / (1000*60*60*24) <= 1) {
                summary += `**! AFTER-HOURS DISCHARGE RISK (${isOOH ? 'OOH' : 'Afternoon'}) !**\n`;
            }
        }
        summary += `\nContributing Factors:\n`;
        document.querySelectorAll('.score-group').forEach(group => {
            const title = group.querySelector('.score-group-title').textContent;
            group.querySelectorAll('.score-option').forEach(option => {
                const input = option.querySelector('.score-input');
                const label = option.querySelector('.option-label span:first-child')?.textContent || option.querySelector('.option-label')?.textContent;
                const note = option.querySelector('.score-note')?.value || '';
                if(input.type === 'radio'){
                    if(input.checked) summary += `- ${title}: ${label.replace(/\(\S+\)/, '').trim()}${note ? `\n  > Notes: ${note}` : ''}\n`;
                } else {
                    summary += `- ${label.replace(/:/g, '')}: [${input.checked ? 'Yes' : 'No'}]${input.checked && note ? `\n  > Notes: ${note}` : ''}\n`;
                }
            });
        });
        
        const getDeviceText = (containerId, typeName) => Array.from(document.getElementById(containerId).querySelectorAll('.device-entry')).map(entry => `- ${typeName}: ` + Array.from(entry.querySelectorAll('input[data-key], select[data-key]')).map(input => input.value ? `${input.dataset.key.replace(/_/g, ' ')}: ${input.value}` : null).filter(Boolean).join(', ')).join('\n');
        const devicesSummary = [getDeviceText('central_lines_container', 'CVAD'), getDeviceText('pivcs_container', 'PIVC'), getDeviceText('idcs_container', 'IDC'), getDeviceText('others_container', 'Other')].filter(Boolean).join('\n');
        summary += `\n--- DEVICES ---\n${devicesSummary || 'No devices documented.'}\n`;

        summary += `\n--- ASSESSMENT & PLAN ---\n`;
        summary += `Fluid Balance: 24hr: ${val('fbc_24hr_input')}mL, Total ICU: ${val('fbc_total_input')}mL\n`;
        summary += `PICS: ${document.querySelector('input[name="pics_status"]:checked').value}. ${val('pics_notes') || ''}\n`;
        summary += `Home Team Plan: ${isChecked('homeTeamPlanCheckbox') ? `Yes - ${val('homeTeamPlanText')}` : 'No'}\n`;
        
        const combinedNotes = [val('admissionReason'), val('icuSummary'), val('pmh'), val('generalNotes')].filter(s => s && s !== 'N/A').join('\n\n');
        summary += `\n--- CLINICIAN NOTES ---\n${combinedNotes || 'N/A'}\n`;

        document.getElementById('emrSummary').value = summary;
    }

    function generateHandoffNote() {
        const keyData = {};
        form.querySelectorAll('input, select').forEach(el => {
            if (!el.id && !el.name) return;
            const key = el.id || el.name;
            if (el.closest('.device-entry, .allergy-item, #pasteContainer, #scoringContainer') || el.type === 'textarea') return;
            if (el.type === 'checkbox') keyData[key] = el.checked;
            else if (el.type === 'radio') { if (el.checked) keyData[el.name] = el.value; }
            else keyData[key] = el.value;
        });

        const freeText = [
            `--- ICU SUMMARY ---\n${document.getElementById('icuSummary').value}`,
            `--- PAST MEDICAL HISTORY ---\n${document.getElementById('pmh').value}`,
            `--- REASON FOR ADMISSION ---\n${document.getElementById('admissionReason').value}`,
            `--- GENERAL NOTES ---\n${document.getElementById('generalNotes').value}`
        ].filter(t => t.split('\n')[1]?.trim()).join('\n\n');

        const key = `[DATA_START]${btoa(JSON.stringify(keyData))}[DATA_END]`;
        return `${freeText}\n\n---\n${key}\n---`;
    }

    function loadFromHandoff(pastedText) {
        try {
            const keyMatch = pastedText.match(/\[DATA_START\](.*?)\[DATA_END\]/);
            if (!keyMatch) { alert('Invalid notes format. Could not find data key.'); return; }
            const key = keyMatch[1];
            const data = JSON.parse(atob(key));

            // Restore structured data from key
            Object.keys(data).forEach(k => {
                const el = form.querySelector(`#${k}`) || form.querySelector(`[name="${k}"]`);
                if (el) {
                    if (el.type === 'checkbox') el.checked = data[k];
                    else if (el.type === 'radio') {
                        const r = form.querySelector(`[name="${el.name}"][value="${data[k]}"]`);
                        if (r) r.checked = true;
                    } else el.value = data[k];
                }
            });

            // Put all readable text into the general notes field
            const readableText = pastedText.substring(0, keyMatch.index).trim();
            document.getElementById('generalNotes').value = readableText;

            form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            alert('Data loaded successfully!');
        } catch (e) {
            console.error("Failed to load data from handoff:", e);
            alert("Error: Could not load data. The handoff text may be corrupted.");
        }
    }
    
    // --- EVENT LISTENER SETUP ---
    function setupEventListeners() {
        form.addEventListener('input', () => { saveCurrentPatientData(); calculateTotalScore(); });
        form.addEventListener('change', () => { saveCurrentPatientData(); calculateTotalScore(); });
        document.getElementById('addPatientBtn').addEventListener('click', () => addPatient('full'));
        document.getElementById('clearDataBtn').addEventListener('click', clearAllData);
        document.getElementById('patientTabsContainer').addEventListener('click', (e) => {
            const tab = e.target.closest('.patient-tab');
            const delBtn = e.target.closest('.delete-patient-btn');
            if (delBtn) { e.stopPropagation(); if (confirm('Delete patient?')) deletePatient(delBtn.dataset.patientId); } 
            else if (tab) { switchPatientTab(tab.dataset.patientId); }
        });
        let activeRadio = null;
        form.addEventListener('mousedown', e => { if (e.target.type === 'radio') activeRadio = e.target.checked ? e.target : null; });
        form.addEventListener('click', e => { if (e.target.type === 'radio' && e.target === activeRadio) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); activeRadio = null; } });
        
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; document.getElementById('main-content').style.visibility = 'visible'; addPatient('full'); });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; document.getElementById('main-content').style.visibility = 'visible'; addPatient('quick'); });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => {
             const pastedText = document.getElementById('pasteDataInput').value;
             if(!pastedText) return;
             document.getElementById('launchScreenModal').style.display = 'none'; 
             document.getElementById('main-content').style.visibility = 'visible'; 
             addPatient('full');
             loadFromHandoff(pastedText);
        });

        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.getElementById('addIdcButton').addEventListener('click', () => window.addIdc());
        document.getElementById('addOtherButton').addEventListener('click', () => window.addOther());
        document.getElementById('addAllergyButton').addEventListener('click', () => addAllergy());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn, .remove-allergy-btn')) e.target.closest('div').remove(); });

        document.getElementById('homeTeamPlanCheckbox').addEventListener('change', e => { document.getElementById('homeTeamPlanDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.querySelectorAll('.precaution-cb').forEach(cb => cb.addEventListener('change', () => { document.getElementById('infectionControlDetails').style.display = document.querySelector('.precaution-cb:checked') ? 'block' : 'none'; }));
        document.getElementById('addsModificationCheckbox').addEventListener('change', e => { document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.getElementById('goc').addEventListener('change', e => { document.getElementById('gocSpecificsContainer').style.display = e.target.value ? 'block' : 'none'; });
        document.querySelectorAll('input[name="pics_status"]').forEach(r => r.addEventListener('change', e => { document.getElementById('pics_details_container').style.display = e.target.value !== 'Negative' ? 'block' : 'none'; }));
        document.querySelectorAll('input[name="concern_score"]').forEach(r => r.addEventListener('change', e => { document.getElementById('nursingConcernText').style.display = e.target.value === '5' ? 'block' : 'none'; }));
        
        form.querySelectorAll('.vital-input').forEach(el => el.addEventListener('input', calculateADDS));

        document.getElementById('printBlankBtn').addEventListener('click', () => { document.body.classList.add('print-blank-mode'); window.print(); document.body.classList.remove('print-blank-mode'); });
        document.getElementById('generateSummaryButton').addEventListener('click', generateEMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { const el = document.getElementById('emrSummary'); el.select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('resetButton').addEventListener('click', () => { if (confirm('Reset form?')) clearForm(); });
        document.getElementById('generateHandoffBtn').addEventListener('click', () => { const note = generateHandoffNote(); navigator.clipboard.writeText(note).then(() => alert('Bedside notes copied to clipboard!')); });
    }
    
    // --- DYNAMIC CONTENT INJECTION ---
    function populateStaticContent() {
        const bloodsContainer = document.getElementById('bloods-container');
        bloodsContainer.innerHTML = `<h3 class="font-semibold text-gray-700 mb-2">Key Bloods</h3><div class="grid sm:grid-cols-2 gap-x-6 gap-y-4"><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Lactate</label><div class="flex-grow"><input type="number" step="0.1" id="lactate_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="lactate_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Hb</label><div class="flex-grow"><input type="number" id="hb_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="hb_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">K+</label><div class="flex-grow"><input type="number" step="0.1" id="k_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="k_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex gap-x-4 mt-2 pl-24"><label class="flex items-center text-xs"><input type="checkbox" id="k_replaced_checkbox" class="h-3 w-3 mr-1"> Replaced</label> <label class="flex items-center text-xs"><input type="checkbox" id="k_planned_checkbox" class="h-3 w-3 mr-1"> Planned</label></div></div><div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Mg++</label><div class="flex-grow"><input type="number" step="0.1" id="mg_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" step="0.1" id="mg_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex gap-x-4 mt-2 pl-24"><label class="flex items-center text-xs"><input type="checkbox" id="mg_replaced_checkbox" class="h-3 w-3 mr-1"> Replaced</label> <label class="flex items-center text-xs"><input type="checkbox" id="mg_planned_checkbox" class="h-3 w-3 mr-1"> Planned</label></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Creatinine</label><div class="flex-grow"><input type="number" id="creatinine_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="creatinine_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">CRP</label><div class="flex-grow"><input type="number" id="crp_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="crp_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="flex items-center gap-x-2"><label class="block text-sm font-medium w-20">Albumin</label><div class="flex-grow"><input type="number" id="albumin_input" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Current"><input type="number" id="albumin_input_prev" class="blood-input mt-1 w-full rounded-md border-2 p-2" placeholder="Prev."></div></div><div class="sm:col-span-2 mt-2 pt-2 border-t"><label class="flex items-center"><input type="checkbox" id="cts_cardiac_checkbox" class="blood-input"><span class="ml-2 text-sm font-medium">CTS/Cardiac Patient</span></label></div></div>`;
        const addsContainer = document.getElementById('adds-container');
        addsContainer.innerHTML = `<h3 class="font-semibold mb-2">ADDS Calculator</h3><div class="space-y-4"><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Resp Rate</label><div class="sm:col-span-2"><input type="number" id="rr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SpO2 (%)</label><div class="sm:col-span-2"><input type="number" id="spo2_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Oxygen Delivery</label><div class="sm:col-span-2 flex items-center space-x-2"><input type="number" id="o2_flow_input" class="vital-input mt-1 w-full rounded-md border-2 p-2" placeholder="Value"><select id="o2_unit_input" class="vital-input mt-1 w-auto rounded-md border-2 p-2"><option value="L/min">L/min</option><option value="%">% FiO2</option></select></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Heart Rate</label><div class="sm:col-span-2"><input type="number" id="hr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="sbp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">DBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="dbp_input" class="mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Consciousness</label><div class="sm:col-span-2"><select id="consciousness_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"><option value="0">Alert</option><option value="1">Voice</option><option value="2">Pain</option><option value="3">Unresponsive</option></select></div></div><div class="grid sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Temp (°C)</label><div class="sm:col-span-2"><input type="number" step="0.1" id="temp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div></div><div class="mt-6 bg-gray-100 p-4 rounded-lg border"><label class="flex items-center"><input type="checkbox" id="addsModificationCheckbox"> <span class="ml-2 text-sm font-medium">Apply MODS to ADDS</span></label><div id="addsModificationDetails" class="hidden ml-6 mt-4 space-y-4"><div><label for="manualADDSScore" class="block text-sm font-medium">Manual Override ADDS Score:</label><input type="number" id="manualADDSScore" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label for="addsModificationText" class="block text-sm font-medium">Rationale:</label><textarea id="addsModificationText" rows="2" class="mt-1 w-full rounded-md border-2 p-2"></textarea></div></div></div><div class="mt-6 bg-teal-50 p-4 rounded-lg text-center border"><span class="text-sm font-medium text-gray-500">CALCULATED ADDS</span><div id="calculatedADDSScore" class="font-bold text-5xl my-2">0</div><div id="addsBreakdown" class="text-xs min-h-[1.5em]">Enter vitals to calculate</div></div>`;
        const scoringContainer = document.getElementById('scoringContainer');
        scoringContainer.innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">RISK SCORING ASSESSMENT</h2><div class="space-y-8">${generateScoringHTML()}</div>`;
    }
    
    function generateScoringHTML() {
        // This function builds the scoring options from a config object to keep the HTML clean
        // and make it easier to add/edit scoring items in the future.
        const sections = [
            { title: 'Physiological & Respiratory Stability', color: 'blue', items: [
                { type: 'checkbox', label: 'Patient is in MET Criteria', score: 15, isCritical: true, name: 'crit_met' },
                { type: 'group', title: 'ADDS Score', items: [
                    { type: 'radio', label: 'ADDS Score 0-2', score: 1, name: 'adds_score', checked: true },
                    { type: 'radio', label: 'ADDS Score 3', score: 5, name: 'adds_score' },
                    { type: 'radio', label: 'ADDS Score ≥ 4', score: 10, name: 'adds_score', isCritical: true }
                ]},
                { type: 'group', title: 'Respiratory Trend', items: [
                    { type: 'checkbox', label: 'Worsening ADDS Trend (last 12-24h)', score: 5, name: 'adds_worsening' },
                    { type: 'checkbox', label: 'Increasing O₂ requirements in last 12h', score: 10, name: 'resp_increasing_o2' },
                    { type: 'checkbox', label: 'Rapid wean of resp support in last 4h', score: 6, name: 'resp_rapid_wean' }
                ]}
            ]},
            { title: 'Clinical', color: 'yellow', items: [
                 { type: 'group', title: 'Pain Score', control: 'segmented', items: [
                    { type: 'radio', label: 'Controlled', score: 0, name: 'pain_score', checked: true },
                    { type: 'radio', label: 'Needs IV', score: 3, name: 'pain_score' },
                    { type: 'radio', label: 'PCA/Poorly Controlled', score: 5, name: 'pain_score' }
                ]},
                { type: 'group', title: 'Fluid Status', control: 'segmented', items: [
                    { type: 'radio', label: 'Euvolaemic', score: 0, name: 'fluid_status_score', checked: true },
                    { type: 'radio', label: 'Mild Dehydration/Overload', score: 2, name: 'fluid_status_score' },
                    { type: 'radio', label: 'Significant Dehydration/Overload', score: 4, name: 'fluid_status_score', isCritical: true }
                ]},
                // ... other clinical items
            ]},
             { title: 'Systemic', color: 'red', items: [ /* ... systemic items ... */ ]},
             { title: 'Receiving Ward and Staffing', color: 'indigo', items: [ /* ... ward items ... */ ]},
             { title: 'Nursing Concern', color: 'yellow', items: [ /* ... concern items ... */ ]}
        ];
        
        // This is a simplified builder. A full implementation would be more robust.
        let html = '';
        sections.forEach(section => {
            html += `<div class="p-4 rounded-lg bg-${section.color}-50"><h3 class="font-bold text-xl mb-3">${section.title}</h3>`;
            section.items.forEach(item => {
                if (item.type === 'group') {
                    html += `<div class="score-group"><div class="score-group-title">${item.title}</div>`;
                    if (item.control === 'segmented') html += `<div class="segmented-control">`;
                    item.items.forEach(subItem => { html += buildScoreOption(subItem); });
                    if (item.control === 'segmented') html += `</div>`;
                    html += `</div>`;
                } else {
                    html += buildScoreOption(item);
                }
            });
            html += `</div>`;
        });
        return html;
    }
    
    function buildScoreOption(item) {
        const scoreText = item.score !== undefined ? `<span>(${item.score > 0 ? '+' : ''}${item.score})</span>` : '';
        const noteHtml = `<textarea name="${item.name}_note" class="score-note mt-2 w-full rounded-md border-gray-300 shadow-sm text-sm p-2 hidden" rows="2" placeholder="Add details..."></textarea>`;
        return `<label class="score-option">
                    <input type="${item.type}" name="${item.name}" class="score-input" 
                           data-score="${item.score || 0}" 
                           ${item.isCritical ? 'data-is-critical="true"' : ''} 
                           ${item.checked ? 'checked' : ''}>
                    <span class="option-label"><span>${item.label}</span>${scoreText}</span>
                    ${noteHtml}
                </label>`;
    }
        
    initializeApp();
});

