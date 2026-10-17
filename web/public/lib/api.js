/* ============================================================
   api.js — Klien HTTP ke server EHR
   ============================================================
   Semua permintaan memakai cookie sesi (httpOnly), jadi tidak ada
   token yang tersimpan di JavaScript.
   ============================================================ */

const API = (() => {

  let onUnauthorized = null;

  function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

  async function request(path, options = {}) {
    const opts = Object.assign({ credentials: 'same-origin', headers: {} }, options);
    /* Body bukan teks dan bukan Blob -> dianggap JSON dan diserialkan.
       Blob (foto) dibiarkan apa adanya: ia harus dikirim sebagai biner,
       bukan dibungkus base64 atau JSON. */
    const berupaBlob = typeof Blob !== 'undefined' && opts.body instanceof Blob;
    if (opts.body !== undefined && typeof opts.body !== 'string' && !berupaBlob) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new ApiError('Tidak dapat menghubungi server.', 0);
    }

    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new ApiError('Sesi berakhir. Silakan masuk kembali.', 401);
    }

    const text = await res.text();
    let data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }

    if (!res.ok) {
      throw new ApiError((data && data.error) || `Permintaan gagal (${res.status}).`, res.status, data);
    }
    return data;
  }

  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }

  return {
    ApiError, request, setUnauthorizedHandler,
    me:     ()              => request('/api/me'),
    data:   ()              => request('/api/data'),
    stats:  ()              => request('/api/stats'),
    logout: ()              => request('/api/logout', { method: 'POST' }),

    savePatient:   (p)      => request('/api/patients', { method: 'POST', body: p }),
    deletePatient: (id)     => request('/api/patients?id=' + encodeURIComponent(id), { method: 'DELETE' }),

    saveVisit:     (p)      => request('/api/visits', { method: 'POST', body: p }),
    deleteVisit:   (id)     => request('/api/visits?id=' + encodeURIComponent(id), { method: 'DELETE' }),

    saveConsent:   (p)      => request('/api/consents', { method: 'POST', body: p }),
    deleteConsent: (id)     => request('/api/consents?id=' + encodeURIComponent(id), { method: 'DELETE' }),

    /* Foto dikirim sebagai BINER MENTAH, bukan base64 — itu menghapus
       pembengkakan 33% dan menghemat penguraian teks raksasa di server.
       Balasannya rujukan ringan { id, mime, width, height, size } yang
       disimpan di v.photos[kind]. */
    uploadPhoto: ({ visitId, kind, blob, width, height }) => request(
      '/api/photos?visitId=' + encodeURIComponent(visitId) +
      '&kind=' + encodeURIComponent(kind) +
      '&width=' + (Number(width) || 0) + '&height=' + (Number(height) || 0),
      {
        method: 'POST',
        headers: { 'Content-Type': (blob && blob.type) || 'image/jpeg' },
        body: blob
      }
    ),
    deletePhoto:   (id)     => request('/api/photos?id=' + encodeURIComponent(id), { method: 'DELETE' }),

    /* Cadangan lengkap: foto disertakan sebagai base64 supaya berkasnya
       mandiri. Berbeda dari data() yang hanya membawa rujukan. */
    exportBackup:  ()       => request('/api/export'),

    syncAudit:     (b)      => request('/api/audit', { method: 'POST', body: b }),
    listAudit:     (visitId)=> request('/api/audit?visitId=' + encodeURIComponent(visitId)),

    /* Riwayat akses. `aksi` & `patientId` dikirim; petugas diambil server. */
    recordAccess:  (e)      => request('/api/access', { method: 'POST', body: e }),
    listAccess:    (o = {}) => request('/api/access?limit=' + (o.limit || 200) +
                                   (o.patientId ? '&patientId=' + encodeURIComponent(o.patientId) : '')),
    lastAccess:    (pid)    => request('/api/access/last?patientId=' + encodeURIComponent(pid)),

    saveConfig:    (c)      => request('/api/config', { method: 'POST', body: c }),
    listUsers:     ()       => request('/api/users'),
    createUser:    (u)      => request('/api/users', { method: 'POST', body: u }),
    setActive:     (id, on) => request('/api/users/active', { method: 'POST', body: { id, aktif: on } }),
    deleteUser:   (id)     => request('/api/users?id=' + encodeURIComponent(id), { method: 'DELETE' }),
    setRole:       (id, r)  => request('/api/users/role', { method: 'POST', body: { id, peran: r } }),
    resetPassword: (id, p)  => request('/api/users/reset', { method: 'POST', body: { id, password: p } }),
    changePassword:(p)      => request('/api/users/password', { method: 'POST', body: p })
  };
})();
