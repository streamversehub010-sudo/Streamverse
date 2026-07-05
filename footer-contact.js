/* =========================================================================
   footer-contact.js
   -------------------------------------------------------------------------
   Powers the "Contact Us" popup opened from the index.html footer.

   - Support email / phone / any extra info rows are admin-managed (see
     support-contact.js + the admin panel's "Support Contact" tab) and are
     always shown to anyone who opens the popup.
   - The message form ("Send Feedback" / "Request a Movie") is open to
     everyone — signed in or not, on any plan. Submissions are filed to
     Firestore via contact-messages.js and show up live in the admin
     panel's Broadcast tab, under "Contact Messages" — no EmailJS, no
     third-party email relay.
   ========================================================================= */
(function () {
  const overlay   = document.getElementById('contactPopupOverlay');
  const openBtn   = document.getElementById('footerContactBtn');
  const closeBtn  = document.getElementById('contactPopupClose');
  const infoEl    = document.getElementById('contactPopupInfo');
  const formWrap  = document.getElementById('contactPopupFormWrap');

  if (!overlay || !openBtn) return; // popup not on this page

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------------------------- Info section ---------------------------- */
  function renderInfo(info) {
    if (!infoEl) return;
    const rows = [];
    rows.push(`
      <div class="contact-info-row">
        <span class="contact-info-icon">✉️</span>
        <div>
          <span class="contact-info-label">Support Email</span>
          <a class="contact-info-value" href="mailto:${escapeHtml(info.email || 'support@streamverse.example')}">${escapeHtml(info.email || 'support@streamverse.example')}</a>
        </div>
      </div>`);
    if (info.phone) {
      rows.push(`
      <div class="contact-info-row">
        <span class="contact-info-icon">📞</span>
        <div>
          <span class="contact-info-label">Phone</span>
          <a class="contact-info-value" href="tel:${escapeHtml(info.phone)}">${escapeHtml(info.phone)}</a>
        </div>
      </div>`);
    }
    (info.extraInfo || []).forEach((f) => {
      if (!f.label && !f.value) return;
      rows.push(`
      <div class="contact-info-row">
        <span class="contact-info-icon">ℹ️</span>
        <div>
          <span class="contact-info-label">${escapeHtml(f.label || 'Info')}</span>
          <span class="contact-info-value">${escapeHtml(f.value)}</span>
        </div>
      </div>`);
    });
    infoEl.innerHTML = rows.join('');
  }

  /* ---------------------------- Form section ---------------------------- */
  // Available to everyone. If signed in, the name/email fields are
  // prefilled from the account; guests just fill them in by hand.
  function renderForm(user) {
    const displayName = user ? (user.username || '') : '';
    const displayEmail = user ? (user.email || '') : '';

    formWrap.innerHTML = `
      <form id="contactPopupForm">
        <div class="form-field">
          <label for="cpName">Your name</label>
          <input type="text" id="cpName" required value="${escapeHtml(displayName)}" autocomplete="name">
        </div>
        <div class="form-field">
          <label for="cpEmail">Your email</label>
          <input type="email" id="cpEmail" required value="${escapeHtml(displayEmail)}" autocomplete="email">
        </div>
        <div class="form-field">
          <label for="cpType">What's this about?</label>
          <select id="cpType">
            <option value="Feedback">General feedback</option>
            <option value="Movie Request">Movie / series request</option>
            <option value="Support">Something isn't working</option>
          </select>
        </div>
        <div class="form-field">
          <label for="cpMessage">Message</label>
          <textarea id="cpMessage" required placeholder="Tell us what's on your mind — e.g. the title you'd like added, or your feedback."></textarea>
        </div>
        <button type="submit" class="auth-submit" id="contactPopupSubmitBtn">Send Message</button>
        <div class="contact-form-status" id="contactPopupStatus"></div>
      </form>`;

    const form = document.getElementById('contactPopupForm');
    const submitBtn = document.getElementById('contactPopupSubmitBtn');
    const statusEl = document.getElementById('contactPopupStatus');

    function setStatus(kind, message) {
      statusEl.textContent = message;
      statusEl.className = `contact-form-status show ${kind}`;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!window.svContactMessages) {
        setStatus('error', 'Contact form is unavailable right now — please try again in a moment.');
        return;
      }

      submitBtn.disabled = true;
      setStatus('sending', 'Sending your message…');

      const result = await window.svContactMessages.submit({
        name: document.getElementById('cpName').value.trim(),
        email: document.getElementById('cpEmail').value.trim(),
        type: document.getElementById('cpType').value,
        message: document.getElementById('cpMessage').value.trim(),
        userId: user ? user.uid : null,
        plan: user ? user.plan : 'guest'
      });

      if (result.ok) {
        setStatus('success', 'Thanks! Your message has been sent — we\u2019ll get back to you soon.');
        form.reset();
        document.getElementById('cpName').value = displayName;
        document.getElementById('cpEmail').value = displayEmail;
      } else {
        setStatus('error', result.error || 'Something went wrong sending your message. Please try again or email us directly.');
      }
      submitBtn.disabled = false;
    });
  }

  async function renderFormSection() {
    const user = window.svAuth ? await window.svAuth.currentUser() : null;
    renderForm(user);
  }

  /* ---------------------------- Open / close ---------------------------- */
  function openPopup() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderInfo(window.svSupportContact ? window.svSupportContact.getSnapshot() : { email: 'support@streamverse.example', phone: '', extraInfo: [] });
    renderFormSection();
  }

  function closePopup() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  openBtn.addEventListener('click', openPopup);
  if (closeBtn) closeBtn.addEventListener('click', closePopup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closePopup(); });

  // Keep the info panel current if an admin edits it while the popup is
  // already open in another tab/session.
  function wireSupportContact() {
    window.svSupportContact.subscribe((info) => {
      if (overlay.classList.contains('open')) renderInfo(info);
    });
  }
  if (window.svSupportContact) wireSupportContact();
  else window.addEventListener('svSupportContactReady', wireSupportContact, { once: true });

  // Re-fill the form with the right name/email if the user signs in/out
  // while the popup is open.
  function wireAuth() {
    window.svAuth.onChange(() => {
      if (overlay.classList.contains('open')) renderFormSection();
    });
  }
  if (window.svAuth) wireAuth();
  else window.addEventListener('svAuthReady', wireAuth, { once: true });
})();
