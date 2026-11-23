// Fixi admin: Alpine components. Loaded before Alpine (see layout.eta), registered on `alpine:init`.
// No inline script anywhere: the CSP only allows scripts served from this origin.
document.addEventListener('alpine:init', () => {
  /** JSON call to the admin API. Never throws: returns { ok, status, data }. */
  async function api(method, url, body) {
    try {
      const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = null;
      if (res.status !== 204) {
        try { data = await res.json(); } catch { data = null; }
      }
      if (res.status === 401) { window.location.href = '/admin/login'; }
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { message: 'Fixi est injoignable.' } };
    }
  }

  /** Readable message from an API error body (zod issues, or { message }). */
  function errorText(result) {
    const d = result.data || {};
    if (d.message) return d.message;
    if (Array.isArray(d.issues) && d.issues.length) {
      return d.issues.map((i) => (i.path ? i.path + ' : ' : '') + i.message).join(' ; ');
    }
    return 'Erreur ' + (result.status || 'réseau') + (d.error ? ' (' + d.error + ')' : '');
  }

  Alpine.data('logoutButton', () => ({
    async logout() {
      await api('POST', '/api/admin/logout');
      window.location.href = '/admin/login';
    },
  }));

  Alpine.data('loginForm', () => ({
    username: '',
    password: '',
    error: '',
    busy: false,
    async submit() {
      this.busy = true;
      this.error = '';
      const res = await api('POST', '/api/admin/login', { username: this.username, password: this.password });
      this.busy = false;
      if (res.ok) { window.location.href = '/admin'; return; }
      if (res.status === 401) this.error = 'Identifiant ou mot de passe incorrect.';
      else if (res.status === 429) this.error = 'Trop de tentatives. Réessayez dans une minute.';
      else this.error = errorText(res);
    },
  }));

  Alpine.data('reportPage', () => ({
    id: 0,
    appId: 0,
    appSlug: '',
    screenshot: '',
    status: '',
    notes: '',
    issueUrl: '',
    error: '',
    notice: '',
    // lightbox
    lightbox: false,
    lightboxSrc: '',
    zoom: false,
    // duplicates
    attachOpen: false,
    attachQuery: '',
    attachSearched: false,
    parents: [],
    markdownPromise: null,
    // issue creation
    issueModal: false,
    issueTitle: '',
    issueLabels: '',
    issueError: '',
    issueBusy: false,
    // user notification
    notifySubject: '',
    notifyMessage: '',
    lastNotified: '',
    notifyBusy: false,
    notifyFailed: [],

    init() {
      const d = this.$root.dataset;
      this.id = Number(d.id);
      this.appId = Number(d.appId);
      this.appSlug = d.appSlug;
      this.screenshot = d.screenshot;
      this.status = d.status;
      this.notes = d.notes;
      this.issueUrl = d.issueUrl;
      this.issueTitle = d.issueTitle;
      this.issueLabels = d.issueLabels;
      this.notifySubject = d.notifySubject;
      this.notifyMessage = d.notifyMessage;
      this.lastNotified = d.lastNotified;
      // Preloaded so that the copy happens right inside the click (clipboard needs a user gesture).
      this.markdownPromise = this.loadMarkdown();
    },

    async loadMarkdown() {
      const res = await api('GET', '/api/admin/reports/' + this.id);
      if (!res.ok) throw new Error(errorText(res));
      return res.data.markdown;
    },

    say(notice, error) {
      this.notice = notice || '';
      this.error = error || '';
    },

    async copyMarkdown() {
      try {
        await navigator.clipboard.writeText(await this.markdownPromise);
        this.say('Rapport Markdown copié.');
      } catch {
        this.say('', 'Copie impossible (le presse-papiers exige HTTPS ou localhost). Utilisez « Télécharger .md ».');
      }
    },

    async copyImage() {
      try {
        // The blob is passed as a promise so that the write starts inside the user gesture.
        const blob = fetch(this.screenshot, { credentials: 'same-origin' }).then((r) => {
          if (!r.ok) throw new Error('fetch');
          return r.blob();
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        this.say('Image copiée. Collez-la avec Ctrl+V.');
      } catch {
        this.say('', "Copie de l'image impossible dans ce navigateur : utilisez « Télécharger la capture ».");
      }
    },

    async downloadMarkdown() {
      try {
        const text = await this.markdownPromise;
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'fixi-' + this.appSlug + '-' + this.id + '.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        this.say('', 'Impossible de générer le fichier Markdown.');
      }
    },

    openLightbox() {
      this.zoom = false;
      this.lightboxSrc = this.screenshot;
      this.lightbox = true;
    },

    /** PATCH then reload the page so that every server-rendered block is up to date. */
    async patch(body, options) {
      this.say('', '');
      const res = await api('PATCH', '/api/admin/reports/' + this.id, body);
      if (!res.ok) { this.say('', errorText(res)); return; }
      if (options && options.reload === false) { this.say('Enregistré.'); return; }
      window.location.reload();
    },

    openIssue() {
      this.issueError = '';
      this.issueModal = true;
    },

    async createIssue() {
      this.issueBusy = true;
      this.issueError = '';
      const labels = this.issueLabels.split(',').map((l) => l.trim()).filter(Boolean);
      const res = await api('POST', '/api/admin/reports/' + this.id + '/issue', { title: this.issueTitle, labels });
      this.issueBusy = false;
      // On failure the ticket is untouched: the modal stays open with the tracker's message.
      if (!res.ok) { this.issueError = errorText(res); return; }
      window.location.reload();
    },

    async notify() {
      if (this.lastNotified && !window.confirm('Ce signalement a déjà été notifié le ' + this.lastNotified + '. Envoyer à nouveau ?')) return;
      this.notifyBusy = true;
      this.notifyFailed = [];
      this.say('', '');
      const res = await api('POST', '/api/admin/reports/' + this.id + '/notify', {
        subject: this.notifySubject,
        message: this.notifyMessage,
      });
      this.notifyBusy = false;
      if (!res.ok) { this.say('', errorText(res)); return; }
      const { sent, failed, last_notified_label: label } = res.data;
      this.notifyFailed = failed;
      // The server only moves last_notified_at when at least one e-mail left.
      this.lastNotified = label || '';
      if (sent === 0) this.say('', "Aucun e-mail n'a pu être envoyé.");
      else this.say(sent + ' e-mail(s) envoyé(s)' + (failed.length ? ', ' + failed.length + ' en échec (voir ci-dessous).' : '.'));
    },

    toggleAttach() {
      this.attachOpen = !this.attachOpen;
      if (this.attachOpen && !this.attachSearched) this.searchParents();
    },

    async searchParents() {
      const params = new URLSearchParams({ parents_only: '1', app_id: String(this.appId) });
      if (this.attachQuery.trim()) params.set('q', this.attachQuery.trim());
      const res = await api('GET', '/api/admin/reports?' + params.toString());
      this.attachSearched = true;
      // A ticket cannot be attached to itself.
      this.parents = res.ok ? res.data.reports.filter((r) => r.id !== this.id) : [];
      if (!res.ok) this.say('', errorText(res));
    },

    async attach(parentId) {
      await this.patch({ parent_id: parentId });
    },
  }));

  Alpine.data('settingsPage', () => ({
    apps: [],
    form: null,
    selected: null,
    baseUrl: '',
    error: '',
    notice: '',
    copied: false,
    defaultColor: '#318f9b',

    init() {
      this.baseUrl = this.$root.dataset.baseUrl;
      this.form = this.emptyForm();
      this.load();
    },

    emptyForm() {
      return {
        id: null, slug: '', name: '', origins: '',
        issue_provider: '', issue_project: '', issue_default_labels: '', issue_anonymize: false,
        widget_color: this.defaultColor,
      };
    },

    /** Same rules as src/widget/theme.ts: invalid value = default color. */
    previewColor() {
      const c = this.form && this.form.widget_color;
      return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : this.defaultColor;
    },

    /** Text on the color: white if it reaches 3:1 (WCAG, bold text), else dark — same rule as the widget. */
    previewText() {
      const hex = this.previewColor();
      const lum = (h) => {
        const lin = (i) => {
          const s = parseInt(h.slice(i, i + 2), 16) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
      };
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const l = lum(hex);
      return ratio(l, 1) >= 3 ? '#ffffff' : '#1f2a30';
    },

    async load() {
      const res = await api('GET', '/api/admin/apps');
      if (res.ok) this.apps = res.data.apps;
      else this.error = errorText(res);
      if (this.selected) this.selected = this.apps.find((a) => a.id === this.selected.id) || null;
    },

    providerLabel(a) {
      if (!a.issue_provider) return 'Aucun';
      return (a.issue_provider === 'gitlab' ? 'GitLab' : 'GitHub') + (a.issue_project ? ' · ' + a.issue_project : '');
    },

    reset() {
      this.form = this.emptyForm();
    },

    edit(a) {
      this.error = '';
      this.notice = '';
      this.selected = a;
      this.form = {
        id: a.id,
        slug: a.slug,
        name: a.name,
        origins: a.allowed_origins.join('\n'),
        issue_provider: a.issue_provider || '',
        issue_project: a.issue_project || '',
        issue_default_labels: a.issue_default_labels || '',
        issue_anonymize: a.issue_anonymize,
        widget_color: a.widget_color || this.defaultColor,
      };
    },

    async save() {
      this.error = '';
      this.notice = '';
      const f = this.form;
      const body = {
        slug: f.slug.trim(),
        name: f.name.trim(),
        allowed_origins: f.origins.split('\n').map((l) => l.trim()).filter(Boolean),
        issue_provider: f.issue_provider || null,
        issue_project: f.issue_project.trim() || null,
        issue_default_labels: f.issue_default_labels.trim() || null,
        issue_anonymize: !!f.issue_anonymize,
        widget_color: this.previewColor().toLowerCase(),
      };
      const res = f.id
        ? await api('PUT', '/api/admin/apps/' + f.id, body)
        : await api('POST', '/api/admin/apps', body);
      if (!res.ok) {
        this.error = res.data && res.data.error === 'slug_already_used' ? 'Ce slug est déjà utilisé.' : errorText(res);
        return;
      }
      this.notice = f.id ? 'Application mise à jour.' : 'Application créée.';
      this.selected = res.data.app;
      this.reset();
      await this.load();
    },

    async regenerate(a) {
      if (!window.confirm('Régénérer la clé de « ' + a.name + ' » ? Le snippet de l\'application hôte devra être mis à jour.')) return;
      const res = await api('POST', '/api/admin/apps/' + a.id + '/regenerate-key');
      if (!res.ok) { this.error = errorText(res); return; }
      this.error = '';
      this.notice = 'Clé régénérée : copiez le nouveau snippet.';
      this.selected = res.data.app;
      await this.load();
    },

    async remove(a) {
      if (!window.confirm('Supprimer l\'application « ' + a.name + ' » ?')) return;
      const res = await api('DELETE', '/api/admin/apps/' + a.id);
      if (!res.ok) { this.error = errorText(res); return; }
      this.error = '';
      this.notice = 'Application supprimée.';
      if (this.selected && this.selected.id === a.id) this.selected = null;
      await this.load();
    },

    snippet() {
      const a = this.selected;
      if (!a) return '';
      return [
        '<!-- Fixi : adapter data-user, data-user-email et data-version (exemple CakePHP) -->',
        '<script',
        '  src="' + this.baseUrl + '/widget.js"',
        '  data-app="' + a.slug + '"',
        '  data-api-key="' + a.api_key + '"',
        '  data-user="<?= h($user) ?>"',
        '  data-user-email="<?= h($userEmail) ?>"',
        '  data-version="<?= h($gitVersion) ?>"',
        '  defer>',
        '</script>',
      ].join('\n');
    },

    async copySnippet() {
      try {
        await navigator.clipboard.writeText(this.snippet());
        this.copied = true;
        setTimeout(() => { this.copied = false; }, 2000);
      } catch {
        this.error = 'Copie impossible : sélectionnez le snippet à la main.';
      }
    },
  }));
});
