// Utility: simple unique id
function generateId() {
	return 't_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

// Natural language helpers
const PRIORITY_KEYWORDS = [
	{ re: /\b(high|urgent|asap|blocker|p1)\b/i, value: 'high', score: 0.9 },
	{ re: /\b(medium|normal|soon|p2)\b/i, value: 'medium', score: 0.6 },
	{ re: /\b(low|nice to have|whenever|p3)\b/i, value: 'low', score: 0.5 }
];

// Expanded action detection
const ACTION_VERBS = [
	'send','review','schedule','draft','prepare','create','update','fix','investigate','follow up','call','email','notify','deploy','test','document','summarize','refactor','design','plan','organize','clean up','migrate','implement','analyze','benchmark','configure','ship','release','align','sync','meet','set up','spin up','provision','book','arrange'
];
const ACTION_VERB_RE = new RegExp(`\\b(${ACTION_VERBS.map(v=>v.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|')})\\b`, 'i');
const CHECKBOX_RE = /^[-*]\s*\[(?: |x|X)\]\s*(.+)$/;
const BULLET_RE = /^(?:[-*•]|\d+\.)\s+(.*)$/;
const SECTION_HEADER_RE = /^(action items|actions|todos|to-?do|next steps|follow\s*ups?)\b[:\-]?/i;
const NEGATION_RE = /\b(no action needed|FYI only|not required|ignore|cancel(?:led)?|won't do)\b/i;

const ASSIGNEE_PATTERNS = [
	{ re: /\b(?:assign(?:ed)? to|owner|@)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:\s*(?:and|,)\s*[A-Z][a-z]+)*)\b/, group: 1, score: 0.85 },
  { re: /\b([A-Z][a-z]+(?:\s*(?:and|,)\s*[A-Z][a-z]+)*) to (?:handle|do|prepare|draft|finish)/, group: 1, score: 0.7 }
];

const DATE_PATTERNS = [
	{ re: /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, fn: relativeWeekday },
	{ re: /\bby\s+(?:eod|cob)\b/i, fn: endOfDay },
	{ re: /\bby\s+eow\b/i, fn: endOfWeek },
	{ re: /\bby\s+end of (?:day|week|month)\b/i, fn: endOfPeriod },
	{ re: /\bby\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, fn: parseMDY },
	{ re: /\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})\b/i, fn: parseMonthDay },
	{ re: /\b(?:tomorrow|today|next week|next month)\b/i, fn: relativeNamed }
];

function relativeWeekday(match) {
	const day = match[1].toLowerCase();
	const map = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
	const target = map[day];
	const now = new Date();
	const diff = (target + 7 - now.getDay()) % 7 || 7; // upcoming weekday
	const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
	return { dueISO: due.toISOString().slice(0,10), score: 0.75 };
}

function endOfPeriod(match) {
	const now = new Date();
	const text = match[0].toLowerCase();
	let due;
	if (text.includes('day')) {
		due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
	} else if (text.includes('week')) {
		const diff = (7 - now.getDay()) % 7; // end of week Sunday
		due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 23, 59, 59);
	} else {
		due = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
	}
	return { dueISO: due.toISOString().slice(0,10), score: 0.6 };
}

function endOfDay() {
	const now = new Date();
	const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
	return { dueISO: due.toISOString().slice(0,10), score: 0.7 };
}

function endOfWeek() {
	const now = new Date();
	const diff = (7 - now.getDay()) % 7; // end of week Sunday
	const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, 23, 59, 59);
	return { dueISO: due.toISOString().slice(0,10), score: 0.7 };
}

function parseMDY(match) {
	const [_, m, d, y] = match;
	const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : new Date().getFullYear();
	const date = new Date(year, Number(m)-1, Number(d));
	return { dueISO: date.toISOString().slice(0,10), score: 0.8 };
}

function parseMonthDay(match) {
	const monthStr = match[1].toLowerCase();
	const day = Number(match[2]);
	const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','sept','oct','nov','dec'];
	let monthIndex = months.indexOf(monthStr);
	if (monthIndex === -1) return null;
	if (monthIndex === 8) monthIndex = 8; // sep/sept both map to 8
	const now = new Date();
	let year = now.getFullYear();
	const tentative = new Date(year, monthIndex % 12, day);
	if (tentative < now) year += 1;
	const date = new Date(year, monthIndex % 12, day);
	return { dueISO: date.toISOString().slice(0,10), score: 0.7 };
}

function relativeNamed(match) {
	const text = match[0].toLowerCase();
	const now = new Date();
	let date = new Date(now);
	if (text.includes('tomorrow')) date.setDate(now.getDate() + 1);
	else if (text.includes('next week')) date.setDate(now.getDate() + 7);
	else if (text.includes('next month')) date = new Date(now.getFullYear(), now.getMonth()+1, now.getDate());
	return { dueISO: date.toISOString().slice(0,10), score: 0.55 };
}

function inferPriority(text) {
	// Force highest priority for explicit ASAP mentions
	if (/\basap\b/i.test(text)) {
		return { priority: 'high', score: 1.0 };
	}
	for (const p of PRIORITY_KEYWORDS) {
		if (p.re.test(text)) return { priority: p.value, score: p.score };
	}
	return { priority: 'medium', score: 0.4 };
}

function inferAssignee(text) {
	for (const p of ASSIGNEE_PATTERNS) {
		const m = text.match(p.re);
		if (m) return { assignee: m[p.group].trim(), score: p.score };
	}
	return { assignee: '', score: 0.2 };
}

function inferDueDate(text) {
	for (const p of DATE_PATTERNS) {
		const m = text.match(p.re);
		if (m) {
			const r = p.fn(m);
			if (r) return r;
		}
	}
	return { dueISO: '', score: 0.0 };
}

// Extraction engine
function extractActionItems(source, advanced) {
	const raw = source.replace(/\r/g, '');
	const lines = raw.split(/\n+/).map(s => s.trim());

	let inActionSection = false;
	const tasks = [];
	for (let i = 0; i < lines.length; i++) {
		const original = lines[i];
		if (!original) continue;
		if (SECTION_HEADER_RE.test(original)) { inActionSection = true; continue; }
		const checkboxMatch = CHECKBOX_RE.exec(original);
		const bulletMatch = BULLET_RE.exec(original);
		const core = (checkboxMatch && checkboxMatch[1]) || (bulletMatch && bulletMatch[1]) || original;
		const line = core.trim();
		if (!line) continue;
		if (NEGATION_RE.test(line)) continue;

		let score = 0;
		// Section boost
		score += inActionSection ? 0.25 : 0;
		// Checkbox/bullet boost
		if (checkboxMatch || bulletMatch) score += 0.3;
		// Action verb
		if (ACTION_VERB_RE.test(line)) score += 0.35;
		// Imperative or please
		if (/^(please\s+)?[a-z]+\b/i.test(line)) score += 0.1;
		// Penalize questions or non-action note prefixes
		if (/[?]$/.test(original)) score -= 0.25;
		if (/^(?:note|discuss|discussion|context)\b/i.test(line)) score -= 0.15;

		const d = inferDueDate(line); score += d.score * 0.2;
		const a = inferAssignee(line); score += a.score * 0.15;
		const p = inferPriority(line); score += p.score * 0.1;

		const threshold = advanced ? 0.6 : 0.55;
		if (score < threshold) { if (/^\s*$/.test(lines[i+1] || '')) inActionSection = false; continue; }

		const cleaned = line.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+by\s+(eod|eow|cob)/ig, '').trim();
		const idRef = generateId();
		tasks.push({
			id: idRef,
			text: cleaned.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, ''),
			completed: /\[[xX]\]/.test(original),
			createdAt: Date.now(),
			priority: p.priority,
			assignee: (a.assignee || '').trim(),
			due: d.dueISO,
			confidence: Math.min(1, Number((score).toFixed(2)))
		});
		if (d.dueISO) adjustDueDateForHoliday(d.dueISO).then(nextDate => {
			if (nextDate && nextDate !== d.dueISO) {
				const task = state.tasks.find(x => x.id === idRef);
				if (task) { task.due = nextDate; saveAndRender(); }
			}
		}).catch(() => {});
		if (/^\s*$/.test(lines[i+1] || '')) inActionSection = false;
	}

	// Auto-grouping heuristic: merge consecutive lines continuing with "-" or indentation
	for (let i = 0; i < tasks.length - 1; i++) {
		const current = tasks[i];
		const next = tasks[i+1];
		if (/^(?:\(|—|–|-)\s*/.test(next.text)) {
			current.text += ' ' + next.text.replace(/^[^\w]+/, '');
			tasks.splice(i+1, 1); i--;
		}
	}

	return tasks;
}

// Persistence
const STORAGE_KEY = 'auto_todo_items_v1';
function saveTasks(tasks) { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
function loadTasks() {
	try {
		const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
		return Array.isArray(arr) ? arr.map(t => ({ createdAt: Date.now(), ...t, createdAt: t.createdAt || Date.now() })) : [];
	} catch { return []; }
}

// Exporters
function exportJSON(tasks) {
	const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
	downloadBlob(blob, 'tasks.json');
}

function exportCSV(tasks) {
	const headers = ['id','text','completed','priority','assignee','due','confidence'];
	const rows = tasks.map(t => headers.map(h => String(t[h] ?? '').replace(/"/g, '""')));
	const csv = [headers.join(','), ...rows.map(r => r.map(v => '"' + v + '"').join(','))].join('\n');
	const blob = new Blob([csv], { type: 'text/csv' });
	downloadBlob(blob, 'tasks.csv');
}

function exportICS(tasks) {
	const lines = [
		'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Auto To-Do//EN'
	];
	for (const t of tasks.filter(t => t.due)) {
		const dt = t.due.replace(/-/g, '') + 'T090000Z';
		lines.push('BEGIN:VTODO');
		lines.push('UID:' + t.id + '@auto-todo');
		lines.push('SUMMARY:' + escapeICS(t.text));
		lines.push('DUE:' + dt);
		lines.push('STATUS:' + (t.completed ? 'COMPLETED' : 'NEEDS-ACTION'));
		lines.push('PRIORITY:' + (t.priority === 'high' ? '1' : t.priority === 'medium' ? '5' : '9'));
		lines.push('END:VTODO');
	}
	lines.push('END:VCALENDAR');
	const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
	downloadBlob(blob, 'tasks.ics');
}

function escapeICS(text) { return text.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url; a.download = filename; a.click();
	URL.revokeObjectURL(url);
}

// Helpers
function splitAssignees(value) {
	if (!value) return [];
	return value
		.split(/\s*(?:,|&|\band\b|\/)\s*/i)
		.map(s => s.replace(/[.;:,]+$/,'').trim())
		.filter(Boolean);
}

// IndexedDB for attachments
let dbPromise;
function getDB() {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open('auto_todo_db', 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains('attachments')) {
					const store = db.createObjectStore('attachments', { keyPath: 'id' });
					store.createIndex('by_task', 'taskId');
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}
	return dbPromise;
}

async function listAttachments(taskId) {
	const db = await getDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('attachments', 'readonly');
		const store = tx.objectStore('attachments');
		const idx = store.index('by_task');
		const req = idx.getAll(IDBKeyRange.only(taskId));
		req.onsuccess = () => resolve(req.result || []);
		req.onerror = () => reject(req.error);
	});
}

async function addAttachments(taskId, files) {
	if (!files || files.length === 0) return [];
	const db = await getDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('attachments', 'readwrite');
		const store = tx.objectStore('attachments');
		const added = [];
		Array.from(files).forEach((file) => {
			const id = 'a_' + generateId();
			const rec = { id, taskId, name: file.name, size: file.size, type: file.type, createdAt: Date.now(), data: file };
			store.put(rec);
			added.push(rec);
		});
		tx.oncomplete = () => resolve(added);
		tx.onerror = () => reject(tx.error);
	});
}

async function deleteAttachment(attId) {
	const db = await getDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('attachments', 'readwrite');
		const store = tx.objectStore('attachments');
		store.delete(attId);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

async function getAttachment(attId) {
	const db = await getDB();
	return new Promise((resolve, reject) => {
		const tx = db.transaction('attachments', 'readonly');
		const store = tx.objectStore('attachments');
		const req = store.get(attId);
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => reject(req.error);
	});
}

// Assignee overview
function renderAssigneeOverview(tasks) {
	const container = document.getElementById('assignee-overview');
	if (!container) return;
	const pendingOnly = !!(document.getElementById('overview-pending-only') && document.getElementById('overview-pending-only').checked);
	const modeEl = document.getElementById('overview-mode');
	const mode = modeEl ? modeEl.value : 'progress';
	const filtered = pendingOnly ? tasks.filter(t => !t.completed) : tasks.slice();
	const map = new Map();
	for (const t of filtered) {
		const names = splitAssignees(t.assignee || '');
		const list = names.length ? names : ['Unassigned'];
		for (const key of list) {
			const name = key.trim() || 'Unassigned';
			if (!map.has(name)) map.set(name, { total: 0, done: 0, low: 0, medium: 0, high: 0 });
			const entry = map.get(name);
			entry.total += 1;
			if (t.completed) entry.done += 1;
			const pri = (t.priority || 'medium').toLowerCase();
			if (pri === 'low' || pri === 'medium' || pri === 'high') entry[pri] += 1;
		}
	}
	const rows = Array.from(map.entries()).sort((a,b) => a[0].localeCompare(b[0]));
	container.innerHTML = '';
	for (const [name, stats] of rows) {
		const row = document.createElement('div'); row.className = 'overview-row';
		const nameEl = document.createElement('div'); nameEl.className = 'overview-name';
		const avatar = document.createElement('img'); avatar.width = 20; avatar.height = 20; avatar.style.borderRadius = '50%';
		avatar.src = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent((splitAssignees(name)[0]||'Unassigned'))}&scale=110&radius=50`;
		const label = document.createElement('span'); label.textContent = name;
		nameEl.appendChild(avatar); nameEl.appendChild(label);

		const bar = document.createElement('div'); bar.className = 'overview-bar';
		if (mode === 'progress') {
			const fill = document.createElement('span');
			const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
			fill.style.width = pct + '%';
			bar.appendChild(fill);
		} else {
			// priority segmented bar
			const total = Math.max(1, stats.total);
			const segLow = document.createElement('span'); segLow.style.width = Math.round((stats.low/total)*100) + '%'; segLow.style.background = '#059669';
			const segMed = document.createElement('span'); segMed.style.width = Math.round((stats.medium/total)*100) + '%'; segMed.style.background = '#f59e0b';
			const segHigh = document.createElement('span'); segHigh.style.width = Math.round((stats.high/total)*100) + '%'; segHigh.style.background = '#ef4444';
			bar.appendChild(segLow); bar.appendChild(segMed); bar.appendChild(segHigh);
		}
		const count = document.createElement('div'); count.className = 'overview-count';
		count.textContent = mode === 'progress' ? `${stats.done}/${stats.total}` : `${stats.low}/${stats.medium}/${stats.high}`;
		row.appendChild(nameEl); row.appendChild(bar); row.appendChild(count);
		container.appendChild(row);
	}
}

// Voice input (Web Speech API)
function initVoiceInput() {
	const btn = document.getElementById('btn-mic');
	const textarea = document.getElementById('source-text');
	const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
	if (!SpeechRecognition) {
		btn.disabled = true; btn.title = 'Speech recognition not supported'; return;
	}
	const rec = new SpeechRecognition();
	rec.lang = 'en-US';
	rec.interimResults = true;
	let listening = false;
	btn.addEventListener('click', () => {
		if (!listening) { rec.start(); listening = true; btn.textContent = '⏹️'; }
		else { rec.stop(); listening = false; btn.textContent = '🎤'; }
	});
	rec.onresult = (e) => {
		let transcript = '';
		for (const res of e.results) transcript += res[0].transcript;
		textarea.value = (textarea.value + ' ' + transcript).trim();
	};
	rec.onend = () => { listening = false; btn.textContent = '🎤'; };
}

// UI rendering
function render(tasks) {
	const list = document.getElementById('todo-list');
	const sortByEl = document.getElementById('sort-by');
	const sortBy = sortByEl ? sortByEl.value : 'none';
	const minConf = Number(document.getElementById('filter-confidence').value);
	let view = tasks.filter(t => t.confidence >= minConf);

	function priorityRank(p) { return p === 'high' ? 0 : p === 'medium' ? 1 : 2; }
	function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
	if (sortBy === 'due') {
		view.sort((a,b) => cmp(a.due || '9999-12-31', b.due || '9999-12-31'));
	} else if (sortBy === 'priority') {
		view.sort((a,b) => cmp(priorityRank(a.priority||'medium'), priorityRank(b.priority||'medium')));
	} else if (sortBy === 'assignee') {
		view.sort((a,b) => cmp((a.assignee||'').toLowerCase(), (b.assignee||'').toLowerCase()));
	} else if (sortBy === 'confidence') {
		view.sort((a,b) => cmp(1-b.confidence, 1-a.confidence));
	} else if (sortBy === 'created') {
		view.sort((a,b) => cmp(a.createdAt||0, b.createdAt||0));
	}

	list.innerHTML = '';
	for (const t of view) list.appendChild(renderItem(t));
	renderAssigneeOverview(tasks);
}

function renderItem(t) {
	const li = document.createElement('li');
	li.className = 'todo-item';

	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox'; checkbox.checked = t.completed;
	checkbox.addEventListener('change', () => { t.completed = checkbox.checked; saveAndRender(); });

	const text = document.createElement('input');
	text.type = 'text'; text.value = t.text; text.placeholder = 'Task description';
	text.addEventListener('change', () => { t.text = text.value; saveAndRender(false); });

	const right = document.createElement('div'); right.className = 'todo-actions';
	const labels = document.createElement('div'); labels.className = 'labels';

	function badge(cls, label) { const s = document.createElement('span'); s.className = 'label ' + cls; s.textContent = label; return s; }

	if (t.priority) labels.appendChild(badge('priority-' + t.priority, t.priority));
	if (t.assignee) labels.appendChild(badge('assignee', t.assignee));
	if (t.due) labels.appendChild(badge('date', t.due));
	labels.appendChild(badge('confidence', `conf ${Math.round(t.confidence*100)}%`));

	const pri = document.createElement('select');
	pri.innerHTML = '<option value="low">low</option><option value="medium">medium</option><option value="high">high</option>';
	pri.value = t.priority || 'medium';
	pri.addEventListener('change', () => { t.priority = pri.value; saveAndRender(false); });

	// Assignee with avatar
	const assigneeWrap = document.createElement('div');
	assigneeWrap.style.display = 'inline-flex'; assigneeWrap.style.alignItems = 'center'; assigneeWrap.style.gap = '6px';
	const avatar = document.createElement('img'); avatar.width = 20; avatar.height = 20; avatar.style.borderRadius = '50%';
	function updateAvatar(name) {
		const seed = encodeURIComponent(name || 'unknown');
		avatar.src = `https://api.dicebear.com/7.x/initials/svg?seed=${seed}&scale=110&radius=50`;
	}
	updateAvatar(t.assignee || '');
	const assignee = document.createElement('input'); assignee.type = 'text'; assignee.placeholder = 'Assignee'; assignee.value = t.assignee || '';
	assignee.addEventListener('change', () => { t.assignee = assignee.value; saveAndRender(false); });
	assignee.addEventListener('input', () => updateAvatar(assignee.value));
	assigneeWrap.appendChild(avatar); assigneeWrap.appendChild(assignee);

	const due = document.createElement('input'); due.type = 'date'; due.value = t.due || '';
	due.addEventListener('change', () => { t.due = due.value; saveAndRender(false); });

	const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'danger';
	del.addEventListener('click', () => { state.tasks = state.tasks.filter(x => x.id !== t.id); saveAndRender(); });

	const leftWrap = document.createElement('div');
	leftWrap.appendChild(text);
	leftWrap.appendChild(labels);

	// Attachments UI
	const attachmentsWrap = document.createElement('div'); attachmentsWrap.className = 'attachments';
	const listWrap = document.createElement('div'); listWrap.className = 'attachment-list';
	attachmentsWrap.appendChild(listWrap);
	const controls = document.createElement('div');
	const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.multiple = true;
	const uploadBtn = document.createElement('button'); uploadBtn.textContent = 'Upload';
	controls.appendChild(fileInput); controls.appendChild(uploadBtn);
	attachmentsWrap.appendChild(controls);
	const dropzone = document.createElement('div'); dropzone.className = 'dropzone'; dropzone.textContent = 'Drop files here';
	attachmentsWrap.appendChild(dropzone);

	function renderAttachmentChip(att) {
		const chip = document.createElement('span'); chip.className = 'attachment-chip';
		const name = document.createElement('span'); name.textContent = att.name;
		const size = document.createElement('span'); size.textContent = `(${Math.ceil(att.size/1024)} KB)`; size.style.opacity = '0.7';
		const dl = document.createElement('button'); dl.textContent = 'Download';
		dl.addEventListener('click', async () => {
			const rec = await getAttachment(att.id); if (!rec) return;
			downloadBlob(rec.data, rec.name);
		});
		const rm = document.createElement('button'); rm.textContent = 'Remove';
		rm.addEventListener('click', async () => {
			await deleteAttachment(att.id);
			await refreshAttachments();
		});
		chip.appendChild(name); chip.appendChild(size); chip.appendChild(dl); chip.appendChild(rm);
		return chip;
	}

	async function refreshAttachments() {
		listWrap.innerHTML = '';
		const items = await listAttachments(t.id);
		if (!items.length) { const empty = document.createElement('span'); empty.className = 'label'; empty.textContent = 'No attachments'; listWrap.appendChild(empty); return; }
		for (const a of items) listWrap.appendChild(renderAttachmentChip(a));
	}

	uploadBtn.addEventListener('click', async () => {
		if (!fileInput.files || !fileInput.files.length) return;
		await addAttachments(t.id, fileInput.files);
		fileInput.value = '';
		await refreshAttachments();
	});

	function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
	['dragenter','dragover','dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, preventDefaults));
	['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.add('dragover')));
	['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover')));
	dropzone.addEventListener('drop', async (e) => {
		const dt = e.dataTransfer; if (!dt) return;
		const files = dt.files; if (!files || !files.length) return;
		await addAttachments(t.id, files);
		await refreshAttachments();
	});

	leftWrap.appendChild(attachmentsWrap);
	// initial load
	refreshAttachments();

	li.appendChild(checkbox);
	li.appendChild(leftWrap);
	right.appendChild(pri);
	right.appendChild(assigneeWrap);
	right.appendChild(due);
	right.appendChild(del);
	li.appendChild(right);
	return li;
}

// State
const SETTINGS_KEY = 'auto_todo_settings_v1';
const state = { tasks: [], settings: loadSettings() };

function loadSettings() {
	try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

function saveAndRender(save = true) { if (save) saveTasks(state.tasks); render(state.tasks); }

// Wiring
function init() {
	state.settings = loadSettings();
	state.tasks = loadTasks();
	// Apply theme on load
	document.documentElement.classList.toggle('theme-light', state.settings.theme === 'light');
	render(state.tasks);

	initVoiceInput();

	document.getElementById('btn-extract').addEventListener('click', () => {
		const src = document.getElementById('source-text').value;
		const advanced = document.getElementById('toggle-advanced').checked;
		const newTasks = extractActionItems(src, advanced);
		// Merge with existing; avoid duplicates by text
		const existingTexts = new Set(state.tasks.map(t => t.text.toLowerCase()));
		for (const t of newTasks) if (!existingTexts.has(t.text.toLowerCase())) state.tasks.push(t);
		saveAndRender();
	});

	document.getElementById('btn-clear').addEventListener('click', () => {
		document.getElementById('source-text').value = '';
	});

	document.getElementById('btn-save').addEventListener('click', () => saveTasks(state.tasks));
	document.getElementById('btn-load').addEventListener('click', () => { state.tasks = loadTasks(); render(state.tasks); });

	document.getElementById('btn-export-json').addEventListener('click', () => exportJSON(state.tasks));
	document.getElementById('btn-export-csv').addEventListener('click', () => exportCSV(state.tasks));
	document.getElementById('btn-export-ics').addEventListener('click', () => exportICS(state.tasks));

	const sortEl = document.getElementById('sort-by');
	if (sortEl) sortEl.addEventListener('change', () => render(state.tasks));
	document.getElementById('filter-confidence').addEventListener('change', () => render(state.tasks));
	const overviewPending = document.getElementById('overview-pending-only');
	if (overviewPending) overviewPending.addEventListener('change', () => renderAssigneeOverview(state.tasks));
	const overviewMode = document.getElementById('overview-mode');
	if (overviewMode) overviewMode.addEventListener('change', () => renderAssigneeOverview(state.tasks));

	document.getElementById('btn-example').addEventListener('click', () => {
		document.getElementById('source-text').value = `Minutes 9/10
Attendees: Alex, Priya, Sam

Action items:
- Alex to draft the Q3 summary report by Friday (high)
- Priya to schedule kickoff with vendor next week
- Sam: investigate login bug ASAP
- Prepare launch checklist by 10/05
- Follow up with finance on invoice status (low)
`;
	});

	document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-input').click());
	document.getElementById('file-input').addEventListener('change', async (e) => {
		const file = e.target.files[0]; if (!file) return;
		const text = await file.text();
		document.getElementById('source-text').value = text;
	});

	// Settings modal wiring
	document.getElementById('btn-settings').addEventListener('click', () => {
		document.getElementById('setting-country').value = state.settings.country || 'US';
		document.getElementById('settings-modal').hidden = false;
	});
	document.getElementById('btn-close-settings').addEventListener('click', () => { document.getElementById('settings-modal').hidden = true; });
	document.getElementById('btn-save-settings').addEventListener('click', () => {
		state.settings = {
			country: document.getElementById('setting-country').value.trim() || 'US',
			theme: state.settings.theme || 'dark'
		};
		saveSettings(state.settings);
		document.getElementById('settings-modal').hidden = true;
	});

	// Theme toggle button
	const themeBtn = document.getElementById('btn-theme');
	if (themeBtn) themeBtn.addEventListener('click', () => {
		const isLight = document.documentElement.classList.toggle('theme-light');
		state.settings = { ...(state.settings||{}), theme: isLight ? 'light' : 'dark' };
		saveSettings(state.settings);
	});
}

document.addEventListener('DOMContentLoaded', init);

// Holiday check: Nager.Date API https://date.nager.at
async function adjustDueDateForHoliday(isoDate) {
	try {
		const date = new Date(isoDate + 'T00:00:00');
		const y = date.getFullYear();
		const country = (state.settings && state.settings.country) || 'US';
		const resp = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${encodeURIComponent(country)}`);
		if (!resp.ok) return isoDate;
		const holidays = await resp.json();
		const set = new Set(holidays.map(h => h.date));
		let d = new Date(date);
		function isWeekend(dt) { const g = dt.getDay(); return g === 0 || g === 6; }
		function toISO(dt) { return dt.toISOString().slice(0,10); }
		while (set.has(toISO(d)) || isWeekend(d)) {
			d.setDate(d.getDate() + 1);
		}
		return toISO(d);
	} catch {
		return isoDate;
	}
}
