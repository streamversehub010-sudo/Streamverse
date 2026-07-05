/* =========================================================================
   contact.js
   -------------------------------------------------------------------------
   Sends the "Send us a message" form on contact.html straight to your
   inbox via EmailJS (https://www.emailjs.com) — no backend server needed.

   SETUP — replace these 3 values with your own from the EmailJS dashboard:
     1. PUBLIC_KEY  — Account -> API Keys -> Public Key
     2. SERVICE_ID  — Email Services -> your connected service's ID
     3. TEMPLATE_ID — Email Templates -> your template's ID

   Your EmailJS template should reference these variable names (they match
   the form field `name` attributes below):
     {{from_name}}   — sender's name
     {{from_email}}  — sender's email (also set this as the template's
                        "Reply To" field in the EmailJS template settings,
                        so hitting Reply in your inbox goes to them)
     {{message}}     — the message body
   ========================================================================= */

const EMAILJS_PUBLIC_KEY  = 'jBozZ1M4OfjNRxZRy';
const EMAILJS_SERVICE_ID  = 'service_fbt8203';
const EMAILJS_TEMPLATE_ID = 'template_9rt7ina';

emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

const contactForm  = document.getElementById('contactForm');
const submitBtn    = document.getElementById('contactSubmitBtn');
const statusEl     = document.getElementById('contactStatus');

function setStatus(kind, message){
  statusEl.textContent = message;
  statusEl.className = `contact-form-status show ${kind}`;
}

contactForm.addEventListener('submit', (e) => {
  e.preventDefault();

  if (EMAILJS_PUBLIC_KEY.startsWith('YOUR_')){
    setStatus('error', 'EmailJS isn\u2019t configured yet — add your Public Key, Service ID, and Template ID in contact.js.');
    return;
  }

  submitBtn.disabled = true;
  setStatus('sending', 'Sending your message…');

  emailjs.sendForm(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, contactForm)
    .then(() => {
      setStatus('success', 'Thanks! Your message has been sent — we\u2019ll get back to you soon.');
      contactForm.reset();
    })
    .catch((err) => {
      console.error('EmailJS send failed:', err);
      setStatus('error', 'Something went wrong sending your message. Please try again or email us directly.');
    })
    .finally(() => {
      submitBtn.disabled = false;
    });
});
