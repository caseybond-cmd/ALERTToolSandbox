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
        loadState();
        const launchModal = document.getElementById('launchScreenModal');
        const mainContent = document.getElementById('main-content');
        
        if (window.innerWidth >= 768 && !navigator.userAgent.includes("Mobi")) {
            const handoffContainer = document.getElementById('handoff-container');
            if(handoffContainer) handoffContainer.style.display = 'block';
        }

        if (Object.keys(currentReview).length > 0) {
            launchModal.style.display = 'none';
            setAppViewMode(currentReview.mode || 'full');
            loadReviewData();
        } else {
            launchModal.style.display = 'flex';
        }
        setupEventListeners();
    }
    
    function setAppViewMode(mode) {
        document.getElementById('main-content').style.visibility = 'visible';
        const fullReviewContainer = document.getElementById('fullReviewContainer');
        const fullReviewContainerBottom = document.getElementById('fullReviewContainerBottom');
        currentReview.mode = mode;
        if (mode === 'quick') {
            fullReviewContainer.style.display = 'none';
            fullReviewContainerBottom.style.display = 'none';
        } else {
            fullReviewContainer.style.display = 'block';
            fullReviewContainerBottom.style.display = 'block';
        }
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
        ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'drains', 'others'].forEach(type => {
            const container = document.getElementById(`${type}_container`);
            if (container) {
                data.devices[type] = Array.from(container.querySelectorAll('.device-entry')).map(entry => {
                    const deviceData = {};
                    entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                        if (input.dataset.key) deviceData[input.dataset.key] = input.value;
                    });
                    return deviceData;
                });
            }
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        currentReview.finalScore = parseInt(document.getElementById('footer-score').textContent) || 0;
        localStorage.setItem('alertToolState_v20', JSON.stringify(currentReview));
    }
    
    function loadState() {
        const savedState = localStorage.getItem('alertToolState_v20');
        if (savedState) {
            currentReview = JSON.parse(savedState);
        }
    }

    function loadReviewData() {
        clearForm(false);
        const data = JSON.parse(JSON.stringify(currentReview));
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
             ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'drains', 'others'].forEach(type => {
                if (data.devices[type]) {
                    const addFunc = window[`add${type.charAt(0).toUpperCase() + type.slice(1).replace(/s$/, '')}`];
                    if (addFunc) data.devices[type].forEach(device => addFunc(device));
                }
            });
        }
        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        calculateTotalScore();
    }

    function clearForm(clearStorage = true) {
        form.reset();
        deviceCounters = {};
        document.querySelectorAll('.device-entry, .allergy-item').forEach(el => el.remove());
        form.querySelectorAll('input, select, textarea').forEach(el => {
             el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        currentReview = {};
        if (clearStorage) localStorage.removeItem('alertToolState_v20');
        calculateTotalScore();
        calculateADDS();
        updateBloodFlags();
        calculatePfRatio();
    }
    
    // --- SCORING & CALCULATIONS ---
    function calculateTotalScore() {
        let score = 0;
        form.querySelectorAll('.score-input:checked').forEach(input => {
            score += parseInt(input.dataset.score, 10) || 0;
        });
        
        const footerScoreEl = document.getElementById('footer-score');
        const footerCategoryEl = document.getElementById('footer-category');
        const stickyFooter = document.getElementById('sticky-footer');
        
        footerScoreEl.title = '';
        footerScoreEl.textContent = score;
        
        const category = getRiskCategory(score);
        footerCategoryEl.textContent = category.text.split(':')[0].toUpperCase();
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        
        saveState();
    }
    
    function getRiskCategory(score) {
        if (score >= RISK_CATEGORIES.extremely_high.score) return RISK_CATEGORIES.extremely_high;
        if (score >= RISK_CATEGORIES.high.score) return RISK_CATEGORIES.high;
        if (score >= RISK_CATEGORIES.medium.score) return RISK_CATEGORIES.medium;
        return RISK_CATEGORIES.low;
    }

    function calculateADDS() {
        const getScore = (val, ranges) => { for (const r of ranges) { if (val >= r.min && val <= r.max) return r.score; } return 0; };
        const p = (id) => parseFloat(document.getElementById(id).value);
        let total = 0;
        
        const rr = p('rr_input'); if (!isNaN(rr)) total += getScore(rr, [{min:0, max:8, score:2}, {min:9, max:11, score:1}, {min:21, max:29, score:2}, {min:30, max:999, score:3}]);
        const spo2 = p('spo2_input'); if (!isNaN(spo2)) total += getScore(spo2, [{min:0, max:89, score:3}, {min:90, max:93, score:2}, {min:94, max:95, score:1}]);
        const o2 = p('o2_flow_input'); if (!isNaN(o2) && o2 > 0) total += 2;
        const hr = p('hr_input'); if (!isNaN(hr)) total += getScore(hr, [{min:0, max:39, score:2}, {min:40, max:49, score:1}, {min:100, max:119, score:1}, {min:120, max:999, score:2}]);
        const sbp = p('sbp_input'); if (!isNaN(sbp)) total += getScore(sbp, [{min:0, max:79, score:3}, {min:80, max:99, score:2}, {min:200, max:999, score:2}]);
        const cons = p('consciousness_input'); if (!isNaN(cons) && cons > 0) total += 3;
        const temp = p('temp_input'); if (!isNaN(temp)) total += getScore(temp, [{min:0, max:35.0, score:2}, {min:38.1, max:38.9, score:1}, {min:39.0, max:99, score:2}]);
        
        document.getElementById('calculatedADDSScore').textContent = total;
    }

    function calculatePfRatio() {
        const pao2 = parseFloat(document.getElementById('pao2_input').value);
        const fio2 = parseFloat(document.getElementById('fio2_input').value);
        const resultEl = document.getElementById('pf_ratio_result');
        const interpretationEl = document.getElementById('pf_ratio_interpretation');

        if (isNaN(pao2) || isNaN(fio2) || fio2 <= 0 || fio2 > 100) {
            resultEl.textContent = '-';
            interpretationEl.textContent = 'Enter PaO2 and FiO2 to calculate.';
            interpretationEl.className = 'text-sm text-gray-500';
            return;
        }

        const pfRatio = pao2 / (fio2 / 100);
        resultEl.textContent = pfRatio.toFixed(1);

        if (pfRatio < 100) {
            interpretationEl.textContent = 'Poor';
            interpretationEl.className = 'text-sm font-semibold text-red-600';
        } else if (pfRatio >= 100 && pfRatio < 300) {
            interpretationEl.textContent = 'Concerning';
            interpretationEl.className = 'text-sm font-semibold text-amber-600';
        } else {
            interpretationEl.textContent = 'Good';
            interpretationEl.className = 'text-sm font-semibold text-green-600';
        }
    }

    // --- DEVICE MANAGEMENT ---
    function createDeviceEntryHTML(id, content) { return `<div id="${id}" class="device-entry bg-white p-3 rounded-md border space-y-2">${content}<button type="button" class="remove-device-btn text-xs text-red-600 hover:underline no-print">Remove</button></div>`;}
    window.addCentral_line = function(data = {}) { deviceCounters.central = (deviceCounters.central || 0) + 1; document.getElementById('central_lines_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`central_${deviceCounters.central}`, `<div class="grid grid-cols-2 gap-2 text-sm"><input type="text" data-key="type" value="${data.type || ''}" placeholder="Type (e.g., PICC)" class="p-1 border rounded-md"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md col-span-2 device-date-input"><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPivc = function(data = {}) { deviceCounters.pivc = (deviceCounters.pivc || 0) + 1; document.getElementById('pivcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pivc_${deviceCounters.pivc}`, `<div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="Pink (20G)" ${data.size === 'Pink (20G)' ? 'selected' : ''}>Pink (20G)</option><option value="Blue (22G)" ${data.size === 'Blue (22G)' ? 'selected' : ''}>Blue (22G)</option><option value="Green (18G)" ${data.size === 'Green (18G)' ? 'selected' : ''}>Green (18G)</option><option value="Grey (16G)" ${data.size === 'Grey (16G)' ? 'selected' : ''}>Grey (16G)</option><option value="Yellow (24G)" ${data.size === 'Yellow (24G)' ? 'selected' : ''}>Yellow (24G)</option></select><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md"></div>`)); }
    window.addIdc = function(data = {}) { deviceCounters.idc = (deviceCounters.idc || 0) + 1; document.getElementById('idcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`idc_${deviceCounters.idc}`, `<div class="grid grid-cols-2 gap-2 text-sm items-center"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md device-date-input"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="12" ${data.size === '12' ? 'selected' : ''}>12 Ch</option><option value="14" ${data.size === '14' ? 'selected' : ''}>14 Ch</option><option value="16" ${data.size === '16' ? 'selected' : ''}>16 Ch</option></select><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPacing_wire = function(data = {}) { deviceCounters.pacing = (deviceCounters.pacing || 0) + 1; document.getElementById('pacing_wires_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pacing_${deviceCounters.pacing}`, `<div><input type="text" data-key="details" value="${data.details || ''}" placeholder="Pacing wire details (e.g., Atrial x2)" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    window.addDrain = function(data = {}) { deviceCounters.drain = (deviceCounters.drain || 0) + 1; document.getElementById('drains_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`drain_${deviceCounters.drain}`, `<div class="space-y-2 text-sm"><input type="text" data-key="type" value="${data.type || ''}" placeholder="Type/Location" class="p-1 border rounded-md w-full"><div class="grid grid-cols-2 gap-2"><input type="number" data-key="output_24hr" value="${data.output_24hr || ''}" placeholder="24hr Output (mL)" class="p-1 border rounded-md"><input type="number" data-key="output_cum" value="${data.output_cum || ''}" placeholder="Cumulative (mL)" class="p-1 border rounded-md"></div></div>`));}
    window.addOther = function(data = {}) { deviceCounters.other = (deviceCounters.other || 0) + 1; document.getElementById('others_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`other_${deviceCounters.other}`, `<div><input type="text" data-key="description" value="${data.description || ''}" placeholder="Device/Wound Description" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    function addAllergy(name = '', reaction = '') { document.getElementById('allergies_container').insertAdjacentHTML('beforeend', `<div class="allergy-item flex items-center gap-2"><input type="text" data-type="name" value="${name}" placeholder="Allergen" class="flex-grow p-1 border rounded-md text-sm"><input type="text" data-type="reaction" value="${reaction}" placeholder="Reaction" class="flex-grow p-1 border rounded-md text-sm"><button type="button" class="remove-allergy-btn text-red-500 font-bold no-print">&times;</button></div>`);}
    
    // --- DMR & HANDOFF NOTE ---
    function generateEMRSummary() {
        const val = (id) => document.getElementById(id)?.value?.trim() || 'N/A';
        const isChecked = (id) => document.getElementById(id)?.checked;
        let summary = `ALERT NURSE REVIEW:\n\n--- PATIENT & REVIEW DETAILS ---\n`;
        const now = new Date();
        const reviewTime = new Date(Math.round(now.getTime() / (30 * 60000)) * (30 * 60000)).toLocaleTimeString('en-AU', { hour: '2-digit', minute:'2-digit' });
        summary += `Review Time: ${reviewTime}\n`;
        summary += `Patient: ${val('patientInitials')}\nLocation: ${val('ward') === 'Other' ? val('wardOther') : val('ward')} - Room ${val('roomNumber')}\n`;
        const stepdownDate = val('icuStepdownDate');
        if (stepdownDate && stepdownDate !== 'N/A') {
            const timeBand = val('icuStepdownTime');
            summary += `ICU Stepdown: ${stepdownDate} @ ${timeBand}\n`;
            const timeMatch = timeBand.match(/\((\d{2})/);
            const hour = timeMatch ? timeMatch[1] : '00';
            const stepdownDateTime = new Date(`${stepdownDate}T${hour}:00:00`);
            const diffHours = (now - stepdownDateTime) / (1000 * 60 * 60);
            if (diffHours >= 0) {
                const timeOnWardText = diffHours < 24 ? `${Math.round(diffHours)} hours` : `${Math.round(diffHours / 24)} days`;
                summary += `Time on Ward: ${timeOnWardText}\n`;
            }
        }
        summary += `ICU LOS: ${val('losDays')} days\n`;
        
        const combinedNotes = [val('admissionReason'), val('icuSummary'), val('pmh'), val('additionalNotes')].filter(s => s && s !== 'N/A');
        if (combinedNotes.length > 0) {
            summary += `\n--- CLINICIAN NOTES & HISTORY ---\n`;
            if (val('admissionReason') && val('admissionReason') !== 'N/A') summary += `Admission: ${val('admissionReason')}\n\n`;
            if (val('icuSummary') && val('icuSummary') !== 'N/A') summary += `ICU Summary:\n${val('icuSummary')}\n\n`;
            if (val('pmh') && val('pmh') !== 'N/A') summary += `PMH:\n${val('pmh')}\n\n`;
            if (val('additionalNotes') && val('additionalNotes') !== 'N/A') summary += `Additional Notes:\n${val('additionalNotes')}\n`;
        }

        summary += `\n--- OBSERVATIONS (ADDS) ---\n`;
        summary += `Calculated ADDS: ${document.getElementById('calculatedADDSScore').textContent}\n`;
        if(isChecked('addsModificationCheckbox')) { summary += `MODIFIED ADDS: ${val('manualADDSScore')} (Rationale: ${val('addsModificationText')})\n`; }
        summary += `Observations: RR ${val('rr_input')}, SpO2 ${val('spo2_input')}% on ${val('o2_flow_input')}${val('o2_unit_input')}, HR ${val('hr_input')}, BP ${val('sbp_input')}/${val('dbp_input')}, Temp ${val('temp_input')}C\n`;
        
        summary += `\n--- RISK ASSESSMENT ---\n`;
        const finalScore = parseInt(document.getElementById('footer-score').textContent);
        summary += `Final Score: ${finalScore}\nCategory & Action: ${getRiskCategory(finalScore).text}\n`;
        if (isChecked('flagAfterHours')) { summary += `**! FLAGGED: AFTER-HOURS DISCHARGE RISK !**\n`; }
        
        summary += `\nContributing Factors:\n`;
        document.querySelectorAll('.score-input:checked').forEach(input => {
            if (parseInt(input.dataset.score) !== 0 || (input.name === 'concern_score' && input.value !== '0')) {
                const label = input.closest('label').querySelector('.score-label').textContent.trim();
                const note = document.getElementById(`${input.name}_note`)?.value.trim();
                const groupTitleEl = input.closest('.score-group')?.querySelector('.score-group-title');
                const groupTitle = groupTitleEl ? groupTitleEl.textContent + ': ' : '';
                summary += `- ${groupTitle}${label}${note ? ` (${note})` : ''}\n`;
            }
        });
        
        const getDeviceText = (containerId, typeName) => Array.from(document.getElementById(containerId).querySelectorAll('.device-entry')).map(entry => {
            let details = [];
            entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => { if (input.value) details.push(`${input.dataset.key.replace(/_/g, ' ')}: ${input.value}`); });
            const dwellSpan = entry.querySelector('span[data-key="dwell_time"]');
            if(dwellSpan && dwellSpan.textContent) details.push(dwellSpan.textContent);
            return `- ${typeName}: ` + details.join(', ');
        }).join('\n');
        const devicesSummary = [getDeviceText('central_lines_container', 'CVAD'), getDeviceText('pivcs_container', 'PIVC'), getDeviceText('idcs_container', 'IDC'), getDeviceText('pacing_wires_container', 'Pacing Wires'), getDeviceText('drains_container', 'Drain'), getDeviceText('others_container', 'Other')].filter(Boolean).join('\n');
        summary += `\n--- DEVICES ---\n${devicesSummary || 'No devices documented.'}\n`;

        summary += `\n--- ASSESSMENT & PLAN ---\n`;
        summary += `Fluid Status: Current Wt: ${val('patientWeight')}kg, Prev Wt: ${val('patientWeightPrevious')}kg. 24hr Bal: ${val('fbc_24hr_input')}mL, Total ICU Bal: ${val('fbc_total_input')}mL\n`;
        const clinicalSigns = [];
        if (isChecked('oedema_checkbox')) clinicalSigns.push('Oedema');
        if (isChecked('cap_refill_checkbox')) clinicalSigns.push('Delayed Cap Refill');
        if (clinicalSigns.length > 0) summary += `Clinical Signs: ${clinicalSigns.join(', ')}\n`;
        summary += `PICS: ${val('pics_status')}. ${val('pics_notes') || ''}\n`;
        summary += `Home Team Plan: ${isChecked('homeTeamPlanCheckbox') ? `Yes - ${val('homeTeamPlanText')}` : 'No'}\n`;
        
        document.getElementById('emrSummary').value = summary;
    }

    function generateHandoffNote() {
        saveState();
        const keyData = {};
        ['reviewType', 'patientInitials', 'ward', 'roomNumber', 'wardOther', 'icuStepdownDate', 'icuStepdownTime', 'losDays', 'goc', 'gocSpecifics', 'nkdaCheckbox', 'allergies', 'precautions', 'infectionControlReason', 'admissionReason', 'icuSummary', 'pmh', 'lactate_input', 'lactate_input_prev', 'hb_input', 'hb_input_prev', 'k_input', 'k_input_prev', 'mg_input', 'mg_input_prev', 'creatinine_input', 'creatinine_input_prev', 'crp_input', 'crp_input_prev', 'albumin_input', 'albumin_input_prev', 'wcc_input', 'wcc_input_prev', 'neut_input', 'neut_input_prev'].forEach(k => {
            if(currentReview[k]) keyData[k] = currentReview[k];
        });
        return btoa(JSON.stringify(keyData));
    }

    function loadFromHandoff(pastedText) {
        try {
            const decodedData = JSON.parse(atob(pastedText));
            clearForm(false);
            Object.keys(decodedData).forEach(key => {
                const el = form.querySelector(`#${key}`);
                if (el) {
                     if (el.type === 'checkbox') el.checked = decodedData[key];
                     else el.value = decodedData[key];
                }
            });
            if (decodedData.allergies) decodedData.allergies.forEach(a => addAllergy(a.name, a.reaction));
            
            form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
            alert('Data loaded successfully!');
        } catch (e) {
            alert('Error loading data. The key may be incomplete or corrupted.');
            console.error("Error decoding handoff data:", e);
        }
    }
    
    // --- EVENT LISTENER SETUP ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); clearForm(true); });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('quick'); clearForm(true); });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => { const pastedText = document.getElementById('pasteDataInput').value; if(!pastedText) return; document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); loadFromHandoff(pastedText); });
        form.addEventListener('input', saveState);
        form.addEventListener('change', saveState);
        document.getElementById('startOverBtn').addEventListener('click', () => { if (confirm('Are you sure you want to start over?')) { clearForm(true); document.getElementById('main-content').style.visibility = 'hidden'; document.getElementById('launchScreenModal').style.display = 'flex'; } });
        let activeRadio = null;
        form.addEventListener('mousedown', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input'))) activeRadio = e.target.checked ? e.target : null; });
        form.addEventListener('click', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input')) && e.target === activeRadio) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); } });
        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.getElementById('addIdcButton').addEventListener('click', () => window.addIdc());
        document.getElementById('addPacingWireButton').addEventListener('click', () => window.addPacing_wire());
        document.getElementById('addDrainButton').addEventListener('click', () => window.addDrain());
        document.getElementById('addOtherButton').addEventListener('click', () => window.addOther());
        document.getElementById('addAllergyButton').addEventListener('click', () => addAllergy());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn, .remove-allergy-btn')) e.target.closest('div').remove(); });
        document.addEventListener('input', e => { if (e.target.classList.contains('device-date-input')) { const dwellEl = e.target.closest('.device-entry').querySelector('[data-key="dwell_time"]'); if(e.target.value) { const days = Math.round((new Date() - new Date(e.target.value)) / (1000 * 60 * 60 * 24)); dwellEl.textContent = `Dwell time: ${days} day(s)`; } else { dwellEl.textContent = ''; } } });
        
        const scoringContainer = document.getElementById('scoringContainer');
        scoringContainer.addEventListener('change', (e) => { if(e.target.classList.contains('score-input')) { const isCheckbox = e.target.type === 'checkbox'; const option = e.target.closest('.list-score-option'); const noteBox = document.getElementById(`${e.target.name}_note`); if (noteBox) { const shouldShow = e.target.checked && (parseInt(e.target.dataset.score, 10) !== 0 || e.target.name === 'concern_score'); noteBox.style.display = shouldShow ? 'block' : 'none'; } calculateTotalScore(); }});
        
        form.querySelectorAll('.vital-input').forEach(el => el.addEventListener('input', calculateADDS));
        
        document.getElementById('homeTeamPlanCheckbox').addEventListener('change', e => { document.getElementById('homeTeamPlanDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.querySelectorAll('.precaution-cb').forEach(cb => cb.addEventListener('change', () => { document.getElementById('infectionControlDetails').style.display = document.querySelector('.precaution-cb:checked') ? 'block' : 'none'; }));
        document.getElementById('addsModificationCheckbox').addEventListener('change', e => { document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.getElementById('goc').addEventListener('change', e => { document.getElementById('gocSpecificsContainer').style.display = (e.target.value === 'B' || e.target.value === 'C' || e.target.value === '') ? 'block' : 'none'; });
        document.getElementById('pics_status').addEventListener('change', e => { document.getElementById('pics_details_container').style.display = e.target.value !== 'Negative' ? 'block' : 'none'; });
        document.getElementById('ward').addEventListener('change', e => { document.getElementById('wardOtherContainer').style.display = e.target.value === 'Other' ? 'block' : 'none'; });
        document.getElementById('reviewType').addEventListener('change', updateWardOptions);
        
        document.getElementById('printBlankBtn').addEventListener('click', () => {
            const printContainer = document.getElementById('print-container');
            const checklistHTML = document.querySelector('.print-section').innerHTML;
            printContainer.innerHTML = `<div class="print-grid">${Array(4).fill(`<div class="print-checklist">${checklistHTML}</div>`).join('')}</div>`;
            document.body.classList.add('print-blank-mode');
            window.print();
            document.body.classList.remove('print-blank-mode');
        });
        document.getElementById('generateSummaryButton').addEventListener('click', generateEMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { const el = document.getElementById('emrSummary'); el.select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('resetButton').addEventListener('click', () => { if (confirm('Reset form?')) clearForm(true); });
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => { const note = generateHandoffNote(); navigator.clipboard.writeText(note).then(() => { alert('Handoff data key copied to clipboard!'); }, () => { alert('Could not copy automatically.'); }); });

        document.getElementById('abg-calculator-container').addEventListener('input', e => {
            if (e.target.id === 'pao2_input' || e.target.id === 'fio2_input') {
                calculatePfRatio();
            }
        });
    }
    
    // --- DYNAMIC CONTENT INJECTION ---
    function updateWardOptions() {
        const reviewType = document.getElementById('reviewType').value;
        const wardSelect = document.getElementById('ward');
        const postIcuWards = ['CCU', '3A', '3C', '3D', '4A', '4B', '4C', '4D', '5A', '5B', '5C', '5D', '6A', '6B', '6C', '6D', '7A', '7B', '7C', '7D', 'SRS2A', 'SRS1A', 'SRSA', 'SRSB', 'Mental Health Adult', 'Mental Health Youth', 'Mother & Baby', 'Medihotel 8', 'Medihotel 7', 'Medihotel 6', 'Medihotel 5', 'Transit Lounge', 'Other'];
        const preIcuWards = ['ICU Pod 1', 'ICU Pod 2', 'ICU Pod 3', 'ICU Pod 4', 'Other'];
        const wards = reviewType === 'post' ? postIcuWards : preIcuWards;
        wardSelect.innerHTML = `<option value="">Select Ward...</option>` + wards.map(w => `<option value="${w}">${w}</option>`).join('');
    }

    function updateBloodFlags() {
        const check = (id, labelId, low, high) => {
            const el = document.getElementById(labelId);
            const val = parseFloat(document.getElementById(id).value);
            el.classList.remove('flag-red', 'flag-amber');
            if (isNaN(val)) return;
            if (low) {
                if (val < low.red) el.classList.add('flag-red');
                else if (val < low.amber) el.classList.add('flag-amber');
            }
            if (high) {
                if (val > high.red) el.classList.add('flag-red');
                else if (val > high.amber) el.classList.add('flag-amber');
            }
        };
        check('hb_input', 'hb_label', { red: 80, amber: 100 }, null);
        check('lactate_input', 'lactate_label', null, { red: 4.0, amber: 2.0 });
        check('k_input', 'k_label', { red: 3.0, amber: 4.0 }, { red: 5.5, amber: 5.0 });
        check('mg_input', 'mg_label', { red: 0.7, amber: 1.0 }, { red: 1.5, amber: 1.3 });
        check('creatinine_input', 'creatinine_label', null, { red: 200, amber: 150 });
        check('crp_input', 'crp_label', null, { red: 200, amber: 100 });
        check('wcc_input', 'wcc_label', { red: 2.0, amber: 4.0 }, { red: 20, amber: 12 });
        check('neut_input', 'neut_label', { red: 1.0, amber: 2.0 }, { red: 15, amber: 8 });
    }
    
    function populateStaticContent() {
        const addsContainer = document.getElementById('adds-container');
        addsContainer.innerHTML = `<h3 class="font-semibold mb-2">ADDS Calculator</h3><div class="space-y-4"><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Resp Rate</label><div class="sm:col-span-2"><input type="number" id="rr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SpO2 (%)</label><div class="sm:col-span-2"><input type="number" id="spo2_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Oxygen Delivery</label><div class="sm:col-span-2 flex items-center space-x-2"><input type="number" id="o2_flow_input" class="vital-input mt-1 w-full rounded-md border-2 p-2" placeholder="Value"><select id="o2_unit_input" class="vital-input mt-1 w-auto rounded-md border-2 p-2"><option value="L/min">L/min</option><option value="%">% FiO2</option></select></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Heart Rate</label><div class="sm:col-span-2"><input type="number" id="hr_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">SBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="sbp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">DBP (mmHg)</label><div class="sm:col-span-2"><input type="number" id="dbp_input" class="mt-1 w-full rounded-md border-2 p-2"></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Consciousness</label><div class="sm:col-span-2"><select id="consciousness_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"><option value="0">Alert</option><option value="1">Voice</option><option value="2">Pain</option><option value="3">Unresponsive</option></select></div></div><div class="grid grid-cols-1 sm:grid-cols-3 gap-x-4 items-center"><label class="block text-sm font-medium sm:col-span-1">Temp (°C)</label><div class="sm:col-span-2"><input type="number" step="0.1" id="temp_input" class="vital-input mt-1 w-full rounded-md border-2 p-2"></div></div></div><div class="mt-6 bg-gray-100 p-4 rounded-lg border"><label class="flex items-center"><input type="checkbox" id="addsModificationCheckbox"> <span class="ml-2 text-sm font-medium">Apply MODS to ADDS</span></label><div id="addsModificationDetails" class="hidden ml-6 mt-4 space-y-4"><div><label for="manualADDSScore" class="block text-sm font-medium">Manual Override ADDS Score:</label><input type="number" id="manualADDSScore" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label for="addsModificationText" class="block text-sm font-medium">Rationale:</label><textarea id="addsModificationText" rows="2" class="mt-1 w-full rounded-md border-2 p-2"></textarea></div></div></div><div class="mt-6 bg-teal-50 p-4 rounded-lg text-center border"><span class="text-sm font-medium text-gray-500">CALCULATED ADDS</span><div id="calculatedADDSScore" class="font-bold text-5xl my-2">0</div></div>`;
        document.getElementById('abg-calculator-container').innerHTML = `<div class="bg-gray-50 p-4 rounded-lg border"><h3 class="font-semibold text-gray-700 mb-2">ABG Data (Optional) - P/F Ratio Calculator</h3><div class="grid sm:grid-cols-3 gap-4 items-center"><div class="sm:col-span-1"><label for="pao2_input" class="block text-sm font-medium">PaO2 (mmHg)</label><input type="number" id="pao2_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div class="sm:col-span-1"><label for="fio2_input" class="block text-sm font-medium">FiO2 (%)</label><input type="number" id="fio2_input" class="mt-1 w-full rounded-md border-2 p-2"></div><div class="sm:col-span-1 text-center bg-white p-3 rounded-lg"><div class="text-sm text-gray-500">P/F Ratio</div><div id="pf_ratio_result" class="font-bold text-3xl">-</div><div id="pf_ratio_interpretation" class="text-sm text-gray-500">Enter values to calculate.</div></div></div></div>`;
        document.getElementById('scoringContainer').innerHTML = `<h2 class="text-xl font-bold border-b pb-3 mb-4">RISK SCORING ASSESSMENT</h2><div class="space-y-4">${generateScoringHTML()}</div>`;
        document.getElementById('fluid-assessment-container').innerHTML = `<h3 class="font-semibold mb-2">Holistic Fluid Status Assessment</h3><div class="grid md:grid-cols-2 gap-4"><div class="grid grid-cols-2 gap-x-4"><div><label class="block text-sm font-medium">Current Wt (kg):</label><input type="number" id="patientWeight" class="mt-1 w-full rounded-md border-2 p-2"></div><div><label class="block text-sm font-medium">Previous Wt (kg):</label><input type="number" id="patientWeightPrevious" class="mt-1 w-full rounded-md border-2 p-2"></div></div><div><label class="block text-sm font-medium">24hr Fluid Balance (mL):</label><input type="number" id="fbc_24hr_input" class="mt-1 w-full rounded-md border-2 p-2" step="100"></div></div><div class="mt-4"><label class="block text-sm font-medium">Total ICU Balance (mL):</label><input type="number" id="fbc_total_input" class="mt-1 w-full rounded-md border-2 p-2" step="100"></div><div class="mt-4"><label class="block text-sm font-medium">Clinical Signs:</label><div class="flex gap-x-4 mt-2"><label class="flex items-center"><input type="checkbox" id="oedema_checkbox" class="h-4 w-4 mr-2">Oedema Present</label><label class="flex items-center"><input type="checkbox" id="cap_refill_checkbox" class="h-4 w-4 mr-2">Delayed Cap Refill (>2s)</label></div></div>`;
        updateWardOptions();
        document.querySelectorAll('.blood-input').forEach(el => el.addEventListener('input', updateBloodFlags));
    }
    
    function generateScoringHTML() {
        const sections = [
            { id: 'phys-section', title: 'Physiological & Respiratory Stability', items: [ { type: 'checkbox', label: 'Patient is in MET Criteria', score: 3, name: 'crit_met' }, { type: 'group', title: 'ADDS Score', name: 'adds_score', items: [ { label: 'ADDS Score 0-2', score: 0, checked: true }, { label: 'ADDS Score 3', score: 1 }, { label: 'ADDS Score ≥ 4', score: 3 } ]}, { type: 'group', title: 'Oxygenation & Respiratory Trend', name: 'resp_trend', items: [ { type: 'checkbox', label: 'Worsening ADDS Trend', score: 1, name: 'adds_worsening' }, { type: 'checkbox', label: 'Increasing O₂ Requirement', score: 3, name: 'resp_increasing_o2' }, { type: 'checkbox', label: 'Rapid wean of resp support', score: 2, name: 'resp_rapid_wean' } ]}, { type: 'group', title: 'Work of Breathing', name: 'wob_score', items: [ { label: 'Normal', score: 0, checked: true }, { label: 'Mild (e.g., accessory muscle use)', score: 1 }, { label: 'Moderate-Severe', score: 2 } ]} ]},
            { id: 'clinical-section', title: 'Clinical Assessment', items: [ { type: 'group', title: 'Pain Score', name: 'pain_score', items: [ { label: 'No pain / Well controlled', score: 0, checked: true }, { label: 'Significant pain/PRN use', score: 1 }, { label: 'PCA, Ketamine, high pain, under APS', score: 2 } ]}, { type: 'group', title: 'Gastrointestinal Assessment', name: 'gi_assessment', items: [ { type: 'sub-group', title: 'Diet / Nutrition', name: 'diet_score', items: [ { label: 'Normal', score: 0, checked: true }, { label: 'Modified', score: 1 }, { label: 'NBM/NG/TPN', score: 2 } ]}, { type: 'sub-group-item', type: 'checkbox', label: 'Bowels not opened >3 days or Ileus', score: 1, name: 'bowels_issue'} ]}, { type: 'group', title: 'Delirium', name: 'delirium_score', items: [ { label: 'None', score: 0, checked: true }, { label: 'Mild', score: 1 }, { label: 'Mod-Severe', score: 2 }] }, { type: 'group', title: 'Mobility', name: 'mobility_score', items: [ { label: 'Baseline', score: 0, checked: true }, { label: 'Assisted (requires physical help)', score: 1 }, { label: 'Bed-bound', score: 2 }] } ]},
            { id: 'systemic-section', title: 'Systemic & Contextual Factors', items: [ { type: 'group', title: 'Admission Source (SWIFT)', name: 'admission_source_score', items: [ { label: 'Surgical (Elective)', score: 0, checked: true }, { label: 'Surgical (Emergency) or Acute Medical', score: 1 }, { label: 'ED or Acute Ward Transfer', score: 2 } ]}, { type: 'group', title: 'Patient Factors', items: [ { type: 'checkbox', label: 'ICU LOS > 3 days', score: 1, name: 'systemic_los', id: 'losCheckbox' }, { type: 'checkbox', label: '≥3 chronic comorbidities', score: 1, name: 'systemic_comorbid' }] }, { type: 'group', title: 'Frailty (pre-hospital)', name: 'frailty_score', items: [ { label: 'Not Frail / Mild', score: 0, checked: true }, { label: 'Mod-Severe', score: 1 }] }, { type: 'group', title: 'Discharge Timing', items: [ { type: 'checkbox', label: 'Flag as After-Hours Discharge', score: 1, name: 'flagAfterHours' }] } ]},
            { id: 'ward-section', title: 'Receiving Ward and Staffing (Reducers)', items: [ { type: 'group', title: 'Bed Type', name: 'bed_type', items: [ { label: 'Unmonitored', score: 0, checked: true }, { label: 'Monitored', score: -1 }] }, { type: 'group', title: 'Staffing', name: 'env_ratio', items: [ { label: 'Standard Ratio', score: 0, checked: true }, { label: 'Enhanced Care (e.g., 1:1, 1:2 special)', score: -1 }] } ]},
            { id: 'concern-section', title: 'Nursing Concern', items: [ { type: 'group', title: '', name: 'concern_score', items: [ { label: 'No Concerns', score: 0, value: '0', checked: true }, { label: 'Concern Present', score: 1, value: '1'}] } ]}
        ];
        let html = '';
        sections.forEach(section => {
            html += `<div id="${section.id}" class="mb-4"><h3 class="font-bold text-xl mb-3 text-gray-800">${section.title}</h3>`;
            section.items.forEach(item => {
                if (item.type === 'group') {
                    html += `<div class="score-group"><div class="score-group-title">${item.title}</div>`;
                    item.items.forEach(subItem => { 
                        if (subItem.type === 'sub-group') {
                            html += `<div class="score-sub-group-title">${subItem.title}</div>`;
                            subItem.items.forEach(subSubItem => html += buildScoreOption(subSubItem, subItem.name));
                        } else if (subItem.type === 'sub-group-item') {
                            html += buildScoreOption(subItem, subItem.name);
                        } else {
                            html += buildScoreOption(subItem, item.name);
                        }
                    });
                    if (item.title === '') { html += `<textarea id="${item.name}_note" name="${item.name}_note" class="score-note mt-4 w-full rounded-md border-gray-300 hidden" rows="2" placeholder="Specify concern..."></textarea>`}
                    html += `</div>`;
                } else { html += buildScoreOption(item, item.name); }
            });
            html += `</div>`;
        });
        return html;
    }
    
    function buildScoreOption(item, groupName) {
        const name = item.name || groupName;
        const type = item.type || 'radio';
        const noteHtml = (item.type === 'checkbox') ? `<textarea name="${name}_note" id="${name}_note" class="score-note mt-2 w-full rounded-md border-gray-300 shadow-sm text-sm p-2 hidden" rows="2" placeholder="Add details..."></textarea>` : '';
        const score = item.score !== undefined ? item.score : 0;
        const value = item.label || item.value;
        const scoreText = `${score > 0 ? '+' : ''}${score}`;
        const idAttr = item.id ? `id="${item.id}"` : '';
        return `<label class="list-score-option"> <input type="${type}" name="${name}" ${idAttr} class="score-input" data-score="${score}" ${item.checked ? 'checked' : ''} value="${value}"> <span class="score-label">${item.label}</span><span class="score-value">${scoreText}</span> </label>${noteHtml}`;
    }
        
    initializeApp();
});
