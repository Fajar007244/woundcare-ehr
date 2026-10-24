/* ============================================================
   store.js — Model domain (data berasal dari server SQLite)
   ============================================================
   Antarmuka publik tetap SINKRON supaya seluruh app tidak berubah
   banyak: baca dari memori, tulis ke memori lebih dulu, lalu kirim
   ke server. Antrean kirim menjaga perubahan tetap aman bila
   koneksi putus.
   ============================================================ */

const Store = (() => {

  const uid = (p = 'id') =>
    `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const nowISO = () => new Date().toISOString();
  const today  = () => new Date().toISOString().slice(0, 10);
  const nowTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  function dateAdd(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const DEFAULT_CLINIC = {
    nama: 'KLINIK KHUSUS LUKA LUKAMU LUKAKU',
    namaPemilik: 'Slamet Wibut M, S.Kep., Ners, CWCC',
    alamat: 'Jl. Ciawitali no. 49B RT 03 RW X Citeureup Cimahi',
    telepon: '082250504500'
  };

  /* ==========================================================
     State
     ========================================================== */

  let state = { meta: { clinic: Object.assign({}, DEFAULT_CLINIC) }, patients: [] };
  let user = null;
  let ready = false;

  /* --- Antrean sinkronisasi --- */
  let queue = [];
  let flushing = false;
  const listeners = new Set();

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function notify() { listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }

  function unsyncedCount() { return queue.length; }

  function setError(msg) { listeners.forEach(fn => { try { fn.onError && fn.onError(msg); } catch (e) {} }); notify(); }

  async function flush() {
    if (flushing) return;
    flushing = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        await job.run();
      } catch (e) {
        // Kembalikan ke depan antrean; coba lagi nanti
        queue.unshift(job);
        if (e && e.status === 401) break;      // sesi habis, jangan dipaksa
        console.warn('[store] gagal menyinkronkan:', e.message);
        scheduleRetry();
        break;
      }
      notify();
    }
    flushing = false;
  }

  let retryTimer = null;
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, 5000);
  }

  /** Daftarkan satu pekerjaan kirim ke server. */
  function push(label, run) {
    queue.push({ label, run });
    notify();
    flush();
  }

  /* ==========================================================
     Boot / auth
     ========================================================== */

  async function boot() {
    const me = await API.me();
    user = me.user;
    const snap = await API.data();
    applySnapshot(snap);
    ready = true;
    // Lunasi antrean yang tertinggal dari sesi sebelumnya
    if (queue.length) flush();
    return user;
  }

  function applySnapshot(snap) {
    const clinic = (snap.meta && snap.meta.clinic) || DEFAULT_CLINIC;
    state = {
      meta: { version: (snap.meta && snap.meta.version) || 1, clinic: Object.assign({}, DEFAULT_CLINIC, clinic) },
      patients: (snap.patients || []).map(normalizePatient)
    };
    notify();
  }

  function normalizePatient(p) {
    p.identity = Object.assign(defaultIdentity(), p.identity || {});
    p.identity.alergi = Object.assign(defaultIdentity().alergi, (p.identity && p.identity.alergi) || {});
    p.consents = Array.isArray(p.consents) ? p.consents : [];
    p.visits = (Array.isArray(p.visits) ? p.visits : []).map(normalizeVisit);
    p.archived = !!p.archived;
    return p;
  }

  function normalizeVisit(v) {
    v.wound = Object.assign(defaultWound(), v.wound || {});
    v.wound.ukuran     = Object.assign(defaultWound().ukuran,     (v.wound && v.wound.ukuran)     || {});
    v.wound.undermining= Object.assign(defaultWound().undermining,(v.wound && v.wound.undermining)|| {});
    v.wound.jaringan   = Object.assign(defaultWound().jaringan,   (v.wound && v.wound.jaringan)   || {});
    v.wound.eksudat    = Object.assign(defaultWound().eksudat,    (v.wound && v.wound.eksudat)    || {});
    v.photos = Object.assign({ before: null, after: null, catatan: '', ruler: false, rulerNote: '' }, v.photos || {});
    const dw = defaultWinner();
    /* Rekam lama masih menyimpan winner.total hasil perhitungan 13 aspek,
       sehingga angkanya tidak sebanding dengan band 10 aspek yang berlaku
       sekarang. Bila kunjungan memang sudah punya objek scores, total
       dihitung ulang dari scores itu dan hasil hitung yang dipakai —
       nilai tersimpan dianggap basi. Kunjungan tanpa scores sama sekali
       dibiarkan memakai total lamanya agar catatan yang belum pernah
       dinilai tidak tiba-tiba kehilangan skor. */
    const punyaScores = !!(v.winner && v.winner.scores);
    v.winner = Object.assign(dw, v.winner || {});
    v.winner.scores = Object.assign(dw.scores, (v.winner && v.winner.scores) || {});
    if (punyaScores) {
      const hasil = Scales.total(v.winner.scores);
      v.winner.total = hasil ? hasil.sum : null;
    }
    v.dressing = Object.assign({ nama: '', frekuensi: '', catatan: '' }, v.dressing || {});
    v.audit = Array.isArray(v.audit) ? v.audit : [];
    v.frozen = !!v.frozen;
    return v;
  }

  async function logout() {
    try { await API.logout(); } catch (e) {}
    queue = [];
    state = { meta: { clinic: Object.assign({}, DEFAULT_CLINIC) }, patients: [] };
    user = null;
    ready = false;
  }

  /* ==========================================================
     Objek default
     ========================================================== */

  function defaultIdentity() {
    return {
      nama: '', nik: '', tglLahir: '', jenisKelamin: '', alamat: '',
      telepon: '', pekerjaan: '', tanggalMasuk: today(),
      kontakNama: '', kontakHubungan: '', kontakTelepon: '',
      alergi: { tidakAda: false, obat: '', dressing: '', latex: '', lain: '' },
      komorbid: [], komorbidLain: '', dpj: '', penanggungJawab: '', catatan: ''
    };
  }

  function defaultWound() {
    return {
      etiologi: [], etiologiLain: '',
      lokasi: '', lokasiSisi: '',
      ukuran: { panjang: '', lebar: '', kedalaman: '' },
      undermining: { ada: false, arahJam: '', kedalaman: '', lokasi: '' },
      tepi: [], kalus: false,
      jaringan: { nekrotik: '', slough: '', granulasi: '', epitel: '' },
      eksudat: { jumlah: '', tipe: '' },
      bau: '', time: [], nrs: 0,
      iskemia: '', palpasiNadi: '', neuropati: '',
      catatan: ''
    };
  }

  function defaultWinner() {
    const scores = {};
    Scales.ITEMS.forEach(i => { scores[i.key] = null; });
    return { scores, total: null, note: '' };
  }

  function defaultVisit() {
    return {
      id: uid('v'), date: today(), time: nowTime(), perawat: '',
      wound: defaultWound(),
      photos: { before: null, after: null, catatan: '', ruler: false, rulerNote: '' },
      winner: defaultWinner(),
      dressing: { nama: '', frekuensi: '', catatan: '' },
      education: '', plan: '', notes: '',
      frozen: false, frozenAt: '', frozenBy: '',
      lastEditedBy: '', lastEditedAt: '',
      audit: [],
      createdAt: nowISO(), updatedAt: nowISO()
    };
  }

  function nextMrNumber() {
    const year = new Date().getFullYear();
    return `RM-${year}-${String(state.patients.length + 1).padStart(4, '0')}`;
  }

  function defaultPatient(name = '') {
    const d = nowISO();
    return {
      id: uid('p'), mrNumber: nextMrNumber(), createdAt: d, updatedAt: d, archived: false,
      identity: Object.assign(defaultIdentity(), { nama: name }),
      consents: [], visits: []
    };
  }

  /* ==========================================================
     Aksesor
     ========================================================== */

  function getDb() { return state; }
  function allPatients() { return state.patients; }
  function activePatients() { return state.patients.filter(p => !p.archived); }
  function getPatient(id) { return state.patients.find(p => p.id === id) || null; }

  /** Tandai pasien berubah -> kirim ke server. */
  function touch(patient) {
    if (!patient) return;
    patient.updatedAt = nowISO();
    push('pasien', () => API.savePatient(patient));
    notify();
  }

  /**
   * Tandai KUNJUNGAN berubah -> kirim ke server.
   * Data kunjungan disimpan pada tabel `visits`, terpisah dari `patients`,
   * jadi setiap perubahan isi kunjungan harus lewat sini.
   */
  function touchVisit(patientId, visitId) {
    const p = getPatient(patientId);
    const v = visitId ? getVisit(patientId, visitId) : (p && p.visits[p.visits.length - 1]);
    if (!p || !v) return;
    v.updatedAt = nowISO();
    p.updatedAt = nowISO();
    push('kunjungan', () => API.saveVisit({ patientId, visit: v }));
    notify();
  }

  /* --- Pasien --- */

  function addPatient(name) {
    const p = defaultPatient(name || '');
    state.patients.push(p);
    push('pasien', () => API.savePatient(p));
    notify();
    return p;
  }

  function removePatient(id) {
    const i = state.patients.findIndex(p => p.id === id);
    if (i < 0) return false;
    state.patients.splice(i, 1);
    push('hapus pasien', () => API.deletePatient(id));
    notify();
    return true;
  }

  /* --- Kunjungan --- */

  function addVisit(patientId, visit) {
    const p = getPatient(patientId);
    if (!p) return null;
    const v = Object.assign(defaultVisit(), visit || {});
    p.visits.push(v);
    sortVisits(p);
    push('kunjungan', () => API.saveVisit({ patientId, visit: v }));
    notify();
    return v;
  }

  function getVisit(patientId, visitId) {
    const p = getPatient(patientId);
    return p ? (p.visits.find(v => v.id === visitId) || null) : null;
  }

  function removeVisit(patientId, visitId) {
    const p = getPatient(patientId);
    if (!p) return false;
    const i = p.visits.findIndex(v => v.id === visitId);
    if (i < 0) return false;
    p.visits.splice(i, 1);
    push('hapus kunjungan', () => API.deleteVisit(visitId));
    notify();
    return true;
  }

  function sortVisits(p) {
    p.visits.sort((a, b) => {
      const ka = `${a.date || ''} ${a.time || '00:00'}`;
      const kb = `${b.date || ''} ${b.time || '00:00'}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  /* --- Persetujuan --- */

  function addConsent(patientId, consent) {
    const p = getPatient(patientId);
    if (!p) return null;
    const c = Object.assign({
      id: uid('c'), date: today(), time: nowTime(),
      nama: '', hubungan: '', keputusan: 'SETUJU',
      tandaTanganPasien: '', tandaTanganPerawat: '', catatan: ''
    }, consent || {});
    p.consents.unshift(c);
    push('persetujuan', () => API.saveConsent({ patientId, consent: c }));
    notify();
    return c;
  }

  function removeConsent(patientId, consentId) {
    const p = getPatient(patientId);
    if (!p) return false;
    const i = p.consents.findIndex(c => c.id === consentId);
    if (i < 0) return false;
    p.consents.splice(i, 1);
    push('hapus persetujuan', () => API.deleteConsent(consentId));
    notify();
    return true;
  }

  /* ==========================================================
     Audit
     ========================================================== */

  const AUDIT_MERGE_MS = 90 * 1000;

  function appendAudit(patientId, visitId, entry) {
    const v = getVisit(patientId, visitId);
    if (!v) return null;

    const now = Date.now();
    const last = v.audit[v.audit.length - 1];
    const oleh = (user && user.nama) || 'Tanpa nama';

    if (last && last.key === entry.key && (now - new Date(last.at).getTime()) < AUDIT_MERGE_MS) {
      if (String(last.before) === String(entry.before)) return last;
      last.after = entry.after;
      last.at = nowISO();
      last.oleh = oleh;
      v.lastEditedBy = oleh;
      v.lastEditedAt = last.at;
      return last;
    }

    const rec = Object.assign({ id: uid('a'), at: nowISO(), oleh }, entry);
    v.audit.push(rec);
    if (v.audit.length > 400) v.audit.splice(0, v.audit.length - 400);
    v.lastEditedBy = oleh;
    v.lastEditedAt = rec.at;
    return rec;
  }

  /** Tandai audit kunjungan ini perlu dikirim ulang ke server. */
  function syncAudit(patientId, visitId, replace) {
    const v = getVisit(patientId, visitId);
    if (!v) return;
    push('audit', () => API.syncAudit({
      patientId, visitId, replace: !!replace, entries: v.audit
    }));
  }

  function recentAudit(patientId, visitId, minutes = 15) {
    const v = getVisit(patientId, visitId);
    if (!v) return [];
    const cut = Date.now() - minutes * 60 * 1000;
    return v.audit.filter(r => new Date(r.at).getTime() >= cut);
  }

  function auditCount(patientId, visitId) {
    const v = getVisit(patientId, visitId);
    return v && v.audit ? v.audit.length : 0;
  }

  function setFrozen(patientId, visitId, on) {
    const v = getVisit(patientId, visitId);
    if (!v) return null;
    v.frozen = !!on;
    v.frozenAt = on ? nowISO() : '';
    v.frozenBy = on ? ((user && user.nama) || '') : '';
    touchVisit(patientId, visitId);
    return v;
  }

  /* ==========================================================
     Riwayat akses
     ========================================================== */

  /**
   * Catat peristiwa akses. Kegagalan sengaja ditelan agar tidak memperlambat
   * alur klinis hanya karena tabel audit sedang bermasalah.
   * Server yang menentukan nama petugas DAN nama pasien; klien hanya mengirim
   * patientId, aksi, dan keterangan.
   */
  function access(aksi, patient, detail) {
    const p = typeof patient === 'string' ? getPatient(patient) : patient;
    const body = {
      aksi,
      detail: detail || '',
      patientId: p ? p.id : null
    };
    return API.recordAccess(body).catch(() => { /* diabaikan */ });
  }

  function listAccess(opts) { return API.listAccess(opts); }

  /* ==========================================================
     Skor
     ========================================================== */

  function recalcWinner(visit) {
    const res = Scales.total(visit.winner.scores);
    visit.winner.total = res ? res.sum : null;
    return visit.winner.total;
  }

  function summarize(patient) {
    const visits = patient.visits || [];
    const scored = visits
      .filter(v => v.winner && v.winner.total != null)
      .map(v => ({
        id: v.id, date: v.date, score: v.winner.total,
        area: Scales.areaCm2(v.wound && v.wound.ukuran),
        nrs: v.wound ? v.wound.nrs : null
      }));
    const last = scored.length ? scored[scored.length - 1] : null;
    const first = scored.length ? scored[0] : null;
    const latest = visits.length ? visits[visits.length - 1] : null;
    const infection = latest && latest.wound ? (latest.wound.time || []).length : 0;

    return {
      total: visits.length, visits, scored,
      lastScore: last ? last.score : null,
      firstScore: first ? first.score : null,
      lastBand: last ? Scales.band(last.score) : null,
      trend: Scales.trend(scored),
      lastArea: last ? last.area : null,
      firstArea: first ? first.area : null,
      lastVisitDate: visits.length ? visits[visits.length - 1].date : null,
      infectionSigns: infection,
      auditCount: visits.reduce((s, v) => s + ((v.audit || []).length), 0),
      archived: !!patient.archived
    };
  }

  function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return activePatients();
    return activePatients().filter(p => {
      const id = p.identity || {};
      return [p.mrNumber, id.nama, id.nik, id.telepon, id.dpj, id.alamat]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }

  function stats() {
    const list = activePatients();
    let visits = 0, scored = 0, infected = 0, healing = 0, changes = 0;
    list.forEach(p => {
      const s = summarize(p);
      visits += s.total;
      scored += s.scored.length;
      changes += s.auditCount;
      if (s.infectionSigns > 0) infected++;
      if (s.trend.dir === 'down') healing++;
    });
    return { patients: list.length, visits, scored, infected, healing, changes };
  }

  /* ==========================================================
     Cadangan / pulih / data contoh
     ========================================================== */

  function exportJSON() { return JSON.stringify(state, null, 2); }

  function importJSON(json, { merge = false, fotoIds = null } = {}) {
    let incoming = json;
    /* Menerima teks JSON maupun objek yang sudah diurai. Halaman
       Pengaturan mengurai dan memvalidasi berkasnya lebih dulu supaya
       bisa memberi tahu isinya sebelum ada satu baris pun yang ditulis,
       lalu meneruskan objeknya ke sini. */
    if (typeof incoming === 'string') {
      try { incoming = JSON.parse(incoming); }
      catch (e) { throw new Error('Berkas bukan JSON yang valid.'); }
    }
    if (!incoming || !Array.isArray(incoming.patients)) throw new Error('Struktur berkas tidak dikenali.');

    /* Setiap pasien wajib punya id. Tanpa cek ini berkas terpotong atau
       salah pilih tetap lolos karena bentuknya sudah cuma "patients" —
       padahal mode replace mengosongkan database DULUAN, lalu tidak
       mengisi apa pun. Hasilnya data hilang tanpa jalur kembali. */
    const tanpaId = incoming.patients.filter(p => !p || typeof p !== 'object' || !p.id).length;
    if (tanpaId) throw new Error(`${tanpaId} catatan pasien tidak punya id. Berkas ditolak, data lama tidak disentuh.`);

    incoming.patients.forEach(normalizePatient);
    const snap = { meta: { version: 1, clinic: (incoming.meta && incoming.meta.clinic) || state.meta.clinic }, patients: incoming.patients };

    /* `fotoIds` hanya diisi saat memulihkan arsip .zip: daftarnya id foto
     yang ada di cadangan. Server memakainya untuk membuang foto LAMA
     tanpa ikut membuang foto yang baru saja diunggah. */
    push('pulihkan cadangan', () => API.request('/api/bulk', {
      method: 'POST',
      body: { mode: merge ? 'merge' : 'replace', snapshot: snap, fotoIds: fotoIds || null }
    }));
    applySnapshot(snap);
    return { imported: incoming.patients.length, ok: true };
  }

  function clearAll() {
    const snap = { meta: { version: 1, clinic: state.meta.clinic }, patients: [] };
    push('hapus semua', () => API.request('/api/bulk', { method: 'POST', body: { mode: 'replace', snapshot: snap } }));
    applySnapshot(snap);
    return true;
  }

  /** Data contoh dibuat di memori lalu dikirim utuh ke server. */
  function seedDemo() {
    const mk = (name, nik, gender, birth, komorbid, visits) => {
      const p = defaultPatient(name);
      p.identity.nik = nik;
      p.identity.jenisKelamin = gender;
      p.identity.tglLahir = birth;
      p.identity.alamat = 'Jl. Contoh No. ' + (10 + Math.floor(Math.random() * 80));
      p.identity.telepon = '08' + Math.floor(1000000000 + Math.random() * 899999999);
      p.identity.pekerjaan = 'Pensiunan';
      p.identity.kontakNama = 'Keluarga';
      p.identity.kontakHubungan = 'Anak';
      p.identity.kontakTelepon = '0812' + Math.floor(10000000 + Math.random() * 89999999);
      p.identity.komorbid = komorbid;
      p.identity.tanggalMasuk = visits[0].date;
      p.consents.push({
        id: uid('c'), date: visits[0].date, time: '09:15',
        nama: name, hubungan: 'Anak', keputusan: 'SETUJU',
        tandaTanganPasien: '', tandaTanganPerawat: 'Ns. Rina Amelia, S.Kep', catatan: ''
      });
      visits.forEach(vd => {
        const v = defaultVisit();
        v.date = vd.date; v.time = vd.time || '09:00';
        v.perawat = 'Ns. Rina Amelia, S.Kep';
        Object.assign(v.wound, vd.wound);
        v.winner.scores = vd.scores;
        v.notes = vd.notes || '';
        recalcWinner(v);
        p.visits.push(v);
      });
      sortVisits(p);
      return p;
    };

    const demo = [
      mk('Budi Santoso', '3273011208750001', 'L', '1975-08-12', ['Diabetes Mellitus'], [
        { date: dateAdd(-27), wound: { etiologi: ['Diabetes Mellitus (Diabetic Foot Ulcer)'], lokasi: 'Telapak kaki kanan (plantar)', ukuran: { panjang: '4.0', lebar: '3.0', kedalaman: '0.6' }, jaringan: { nekrotik: '30', slough: '40', granulasi: '25', epitel: '5' }, eksudat: { jumlah: 'Sedang', tipe: 'Serosanguinous' }, bau: 'Berbau Ringan', time: ['Kalor'], nrs: 6 },
          scores: { size: 4, depth: 3, edges: 3, undermining: 2, exType: 2, exAmount: 3, skinColor: 3, edema: 3, granulation: 3, epithelial: 4 }, notes: 'Debridement awal, pasang foam dengan contact layer.' },
        { date: dateAdd(-13), wound: { etiologi: ['Diabetes Mellitus (Diabetic Foot Ulcer)'], lokasi: 'Telapak kaki kanan (plantar)', ukuran: { panjang: '2.8', lebar: '2.2', kedalaman: '0.4' }, jaringan: { nekrotik: '10', slough: '25', granulasi: '55', epitel: '10' }, eksudat: { jumlah: 'Sedikit', tipe: 'Serous' }, bau: 'Tidak Berbau', time: [], nrs: 4 },
          scores: { size: 3, depth: 2, edges: 2, undermining: 2, exType: 2, exAmount: 2, skinColor: 2, edema: 2, granulation: 2, epithelial: 3 }, notes: 'Granulasi membaik, ganti ke foam dengan contact layer.' },
        { date: dateAdd(-3), wound: { etiologi: ['Diabetes Mellitus (Diabetic Foot Ulcer)'], lokasi: 'Telapak kaki kanan (plantar)', ukuran: { panjang: '1.6', lebar: '1.3', kedalaman: '0.2' }, jaringan: { nekrotik: '0', slough: '5', granulasi: '70', epitel: '25' }, eksudat: { jumlah: 'Sedikit', tipe: 'Serous' }, bau: 'Tidak Berbau', time: [], nrs: 2 },
          scores: { size: 2, depth: 2, edges: 2, undermining: 1, exType: 2, exAmount: 2, skinColor: 2, edema: 1, granulation: 1, epithelial: 2 }, notes: 'Luka hampir menutup, epitelisasi progressing.' }
      ]),
      mk('Siti Aminah', '3273016502900002', 'P', '1990-02-05', ['Hipertensi'], [
        { date: dateAdd(-18), wound: { etiologi: ['Dekubitus'], lokasi: 'Sakrum', ukuran: { panjang: '6.5', lebar: '5.0', kedalaman: '1.2' }, jaringan: { nekrotik: '20', slough: '50', granulasi: '30', epitel: '0' }, eksudat: { jumlah: 'Banyak', tipe: 'Purulent' }, bau: 'Sangat Berbau', time: ['Kalor', 'Dolor', 'Rubor', 'Tumor'], nrs: 8 },
          scores: { size: 5, depth: 4, edges: 4, undermining: 4, exType: 5, exAmount: 4, skinColor: 4, edema: 3, granulation: 3, epithelial: 5 }, notes: 'Tanda infeksi aktif. Kultur luka, rujukan, evaluasi vacuum therapy.' },
        { date: dateAdd(-4), wound: { etiologi: ['Dekubitus'], lokasi: 'Sakrum', ukuran: { panjang: '4.2', lebar: '3.4', kedalaman: '0.7' }, jaringan: { nekrotik: '0', slough: '20', granulasi: '60', epitel: '20' }, eksudat: { jumlah: 'Sedang', tipe: 'Serous' }, bau: 'Tidak Berbau', time: [], nrs: 4 },
          scores: { size: 3, depth: 3, edges: 2, undermining: 2, exType: 2, exAmount: 2, skinColor: 2, edema: 2, granulation: 2, epithelial: 3 }, notes: 'Infeksi terkendali, lanjut foam.' }
      ]),
      mk('Ahmad Fauzi', '3273011003750003', 'L', '1975-03-10', ['Hipertensi'], [
        { date: dateAdd(-9), wound: { etiologi: ['Trauma / Post-Op'], lokasi: 'Abdomen, area insisi', ukuran: { panjang: '5.0', lebar: '1.2', kedalaman: '0.4' }, jaringan: { nekrotik: '0', slough: '10', granulasi: '60', epitel: '30' }, eksudat: { jumlah: 'Sedang', tipe: 'Sanguinous' }, bau: 'Tidak Berbau', time: [], nrs: 3 },
          scores: { size: 3, depth: 2, edges: 2, undermining: 1, exType: 3, exAmount: 3, skinColor: 1, edema: 1, granulation: 2, epithelial: 2 }, notes: 'Dehisensi ringan post-op, gunakan fiksasi jepit.' }
      ])
    ];

    demo.forEach(normalizePatient);
    // Nomor RM dihitung setelah seluruhPatients terkumpul agar tidak bentrok
    const year = new Date().getFullYear();
    demo.forEach((p, i) => { p.mrNumber = `RM-${year}-${String(i + 1).padStart(4, '0')}`; });

    const snap = { meta: { version: 1, clinic: state.meta.clinic }, patients: demo };
    push('data contoh', () => API.request('/api/bulk', { method: 'POST', body: { mode: 'merge', snapshot: snap } }));
    applySnapshot(snap);
    return demo.length;
  }

  /* ==========================================================
     Ekspor
     ========================================================== */

  return {
    // auth
    boot, logout, onChange, flush, unsyncedCount,
    get user() { return user; },
    get ready() { return ready; },

    /** Nama petugas dari server. */
    currentUserName() { return (user && user.nama) || ''; },

    // helper
    uid, nowISO, today, nowTime, dateAdd,
    defaultVisit, defaultPatient, defaultIdentity, defaultWound, defaultWinner,

    // data
    getDb, allPatients, activePatients, getPatient, addPatient, removePatient, touch, touchVisit,
    addVisit, getVisit, removeVisit, sortVisits,
    addConsent, removeConsent,
    appendAudit, syncAudit, recentAudit, auditCount, setFrozen,
    access, listAccess,
    recalcWinner, summarize, search, stats,

    // backup
    exportJSON, importJSON, clearAll, seedDemo,

    // config
    get clinic() { return state.meta.clinic; },
    set clinic(v) {
      state.meta.clinic = Object.assign({}, DEFAULT_CLINIC, v);
      push('konfigurasi', () => API.saveConfig(state.meta.clinic));
      notify();
    },
    get version() { return 1; },
    DEFAULT_CLINIC
  };
})();
