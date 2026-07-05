/* =========================================================================
   firebase-auth.js
   -------------------------------------------------------------------------
   Real Firebase Authentication for StreamVerse, replacing the old
   localStorage/plaintext-password demo auth from store.js.

   - Uses Firebase Auth (email/password) for both viewer and admin login.
   - Each user's role ('viewer' | 'admin') and profile is kept in a
     Firestore doc at  users/{uid} .
   - Exposes a small svAuth.* API that the rest of the site calls, so
     index.html / login.html / admin-login.html / admin.html / nav-auth.js
     / admin.js only ever talk to svAuth (never to the Firebase SDK
     directly).
   ========================================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported as analyticsIsSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  updateEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------------------
// Your web app's Firebase configuration
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyA7rjyseLELNkTtG05F1zyfRkMLKDZ2wwA",
  authDomain: "streamverselab-4a5f5.firebaseapp.com",
  projectId: "streamverselab-4a5f5",
  storageBucket: "streamverselab-4a5f5.firebasestorage.app",
  messagingSenderId: "1055657513054",
  appId: "1:1055657513054:web:fac88ed36836bb034e24cf",
  measurementId: "G-7YDK5CQ24N"
};

const app = initializeApp(firebaseConfig);
analyticsIsSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});

const auth = getAuth(app);
const db = getFirestore(app);

// Exported so other modules (e.g. catalog-firestore.js) can reuse the
// exact same Firebase app/Firestore instance instead of re-initializing.
export { app, db, auth };

const USERS_COLLECTION = "users";
const SETTINGS_COLLECTION = "settings";
const PAYMENT_METHODS_DOC = "paymentMethods";
const PLAN_PRICING_DOC = "planPricing";
const UPGRADE_REQUESTS_COLLECTION = "upgradeRequests";

// Fallback config used until an admin saves real values (or if the
// settings doc doesn't exist yet). Keys are stable IDs — admin.js edits
// the label/instructions/fields/enabled but never the keys themselves.
// `fields` holds the structured, per-method data shown in the admin's
// grid editor (and, for transfer/bankDeposit, surfaced to viewers at
// checkout so they know where to send money).
const DEFAULT_PAYMENT_METHODS = {
  transfer: {
    key: "transfer",
    label: "Bank / Wire Transfer",
    enabled: true,
    instructions: "Transfer the plan total to StreamVerse Ltd. Account details are displayed below.",
    fields: {
      bankName: "Global Trust Bank",
      accountName: "StreamVerse Ltd",
      accountNumber: "12345678901234",
      swift: "GTBGB2L",
      currency: "USD"
    }
  },
  bankDeposit: {
    key: "bankDeposit",
    label: "Bank Deposit",
    enabled: true,
    instructions: "Deposit the plan total at any branch, then submit your deposit slip reference.",
    fields: {
      bankName: "Global Trust Bank",
      accountName: "StreamVerse Ltd",
      accountNumber: "12345678901234",
      branchCode: "001",
      depositSlipReference: ""
    }
  },
  card: {
    key: "card",
    label: "Card Purchase",
    enabled: true,
    instructions: "Customers will receive a secure card payment link after submitting their request.",
    fields: {
      cardholderName: "",
      cardNumber: "",
      expiry: "",
      cvv: "",
      billingEmail: "",
      billingAddress: ""
    }
  }
};

// Currencies offered in the Bank/Wire Transfer "Currency" dropdown.
const PAYMENT_CURRENCIES = [
  { code: "USD", label: "USD (US Dollar)" },
  { code: "EUR", label: "EUR (Euro)" },
  { code: "GBP", label: "GBP (British Pound)" },
  { code: "CAD", label: "CAD (Canadian Dollar)" },
  { code: "AUD", label: "AUD (Australian Dollar)" },
  { code: "NGN", label: "NGN (Nigerian Naira)" }
];

// The symbol used to display subscription plan/billing prices site-wide
// (plan cards, checkout total, admin Plan Pricing editor). Change this
// one value to switch the site's default billing currency display.
const BILLING_CURRENCY_SYMBOL = "₦";

/* ---------------------------------------------------------------------
   Internal helpers
   --------------------------------------------------------------------- */
function friendlyError(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/user-disabled": "This account has been suspended.",
    "auth/user-not-found": "Incorrect username/email or password.",
    "auth/wrong-password": "Incorrect username/email or password.",
    "auth/invalid-credential": "Incorrect username/email or password.",
    "auth/email-already-in-use": "That email is already registered.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again."
  };
  return map[code] || (err && err.message) || "Something went wrong. Please try again.";
}

async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  // --- Legacy-account plan backfill -------------------------------------
  // Any profile created before the subscription-plan feature existed has
  // no `plan` field. Treat that as Basic everywhere it's read, and
  // best-effort persist it back to Firestore so the account is fully
  // migrated the first time it's touched (never blocks the caller).
  if (!data.plan) {
    data.plan = "basic";
    updateDoc(doc(db, USERS_COLLECTION, uid), { plan: "basic" }).catch(() => {});
  }
  return data;
}

/* ---------------------------------------------------------------------
   Public API: svAuth
   --------------------------------------------------------------------- */
const svAuth = {

  /** Fires cb(userProfile|null) once immediately and on every auth change.
   *  userProfile = { uid, username, email, role, banned } or null. */
  onChange(cb) {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) return cb(null);
      const profile = await getUserDoc(fbUser.uid);
      if (!profile) return cb(null);
      cb({ uid: fbUser.uid, ...profile });
    });
  },

  /** One-shot read of the current signed-in user (or null). */
  async currentUser() {
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, async (fbUser) => {
        unsub();
        if (!fbUser) return resolve(null);
        const profile = await getUserDoc(fbUser.uid);
        resolve(profile ? { uid: fbUser.uid, ...profile } : null);
      });
    });
  },

  /** Firebase ID token for the signed-in user, or null if signed out.
   *  Used to authenticate calls to Netlify Functions (e.g. the email
   *  broadcast endpoint) — the function verifies this token server-side
   *  with firebase-admin before doing anything privileged. */
  async getIdToken() {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken();
    } catch (err) {
      console.error("getIdToken failed:", err);
      return null;
    }
  },

  /** Viewer sign-up. Creates the Firebase Auth user + Firestore profile
   *  with role:'viewer'. */
  async signup(username, email, password) {
    username = (username || "").trim();
    email = (email || "").trim();
    if (!username || !email || !password) {
      return { ok: false, error: "All fields are required." };
    }
    if (password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters." };
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: username });
      const profile = {
        username,
        email,
        role: "viewer",
        banned: false,
        plan: "basic", // every new account starts on the free Basic plan
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, USERS_COLLECTION, cred.user.uid), profile);
      await svAuth.log(`New viewer account created: ${username}`);

      // Welcome email — best-effort. The account is already fully created
      // at this point, so a failure here should never surface as a signup
      // error to the new user. IMPORTANT: this is awaited (not fired off
      // as an un-awaited IIFE) because login.html redirects the page the
      // instant signup() resolves — an un-awaited fetch here gets its
      // request cancelled mid-flight by that navigation before Brevo ever
      // receives it, which is why the email wasn't sending.
      try {
        const idToken = await cred.user.getIdToken();
        await fetch("/.netlify/functions/send-transactional-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ type: "welcome" })
        });
      } catch (emailErr) {
        console.error("Welcome email failed to send:", emailErr);
      }

      return { ok: true, user: { uid: cred.user.uid, ...profile } };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Log in with email + password. Pass requireRole:'admin' to restrict
   *  this login to admin accounts only (used by admin-login.html). */
  async login(email, password, requireRole) {
    email = (email || "").trim();
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      const profile = await getUserDoc(cred.user.uid);
      if (!profile) {
        await signOut(auth);
        return { ok: false, error: "No profile found for this account. Ask an administrator to create your profile or use the signup flow." };
      }
      if (profile.banned) {
        await signOut(auth);
        return { ok: false, error: "This account has been suspended." };
      }
      if (requireRole && profile.role !== requireRole) {
        await signOut(auth);
        return { ok: false, error: "This account does not have admin access." };
      }
      await svAuth.log(`${profile.role === "admin" ? "Admin" : "Viewer"} logged in: ${profile.username}`);
      return { ok: true, user: { uid: cred.user.uid, ...profile } };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  async logout() {
    const user = await svAuth.currentUser();
    if (user) await svAuth.log(`Logged out: ${user.username}`);
    await signOut(auth);
  },

  /* ------------------------- Admin: user management ------------------------- */

  async listUsers() {
    const snap = await getDocs(collection(db, USERS_COLLECTION));
    const out = [];
    snap.forEach((d) => out.push({ uid: d.id, ...d.data() }));
    return out;
  },

  async setBanned(uid, username, banned) {
    await updateDoc(doc(db, USERS_COLLECTION, uid), { banned });
    await svAuth.log(`${banned ? "Suspended" : "Reinstated"} viewer account: ${username}`);
  },

  async deleteUserProfile(uid, username) {
    // Note: this removes the Firestore profile. Deleting the underlying
    // Firebase Auth account requires an admin SDK / Cloud Function, since
    // a client can only delete its own signed-in auth account.
    await deleteDoc(doc(db, USERS_COLLECTION, uid));
    await svAuth.log(`Deleted viewer account: ${username}`);
  },

  /* ------------------------- Account Manager: profile ------------------------- */
  // Everything below backs the new Profile ("Account Manager") and Web App
  // Settings pages (profile.html / settings.html). Nothing here touches the
  // existing login/signup/admin flows above.

  /** Re-authenticates the current user with their existing password.
   *  Required by Firebase before sensitive ops (password/email change,
   *  account deletion) if the sign-in is not "recent". */
  async _reauth(currentPassword) {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ok: false, error: "You are signed out. Please log in again." };
    try {
      const cred = EmailAuthProvider.credential(fbUser.email, currentPassword);
      await reauthenticateWithCredential(fbUser, cred);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Updates display name / avatar URL. photoURL lives on the Firestore
   *  profile doc; displayName is mirrored into Firebase Auth too
   *  (updateProfile) so it stays consistent with the auth record.
   *  (The old free-text "bio" field has been replaced by the computed
   *  Movie Badge — see BADGE_TIERS / getWatchStats below.) */
  async updateProfileInfo({ username, photoURL } = {}) {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ok: false, error: "You are signed out. Please log in again." };
    try {
      const updates = {};
      if (typeof username === "string" && username.trim()) updates.username = username.trim();
      if (typeof photoURL === "string") updates.photoURL = photoURL.trim();

      if (Object.keys(updates).length) {
        await updateDoc(doc(db, USERS_COLLECTION, fbUser.uid), updates);
      }
      // Keep the Firebase Auth record's displayName in sync too. photoURL is
      // NOT mirrored here — profile pictures are now uploaded files stored
      // as data URIs, which can exceed Firebase Auth's photoURL length
      // limit. Every place that reads a user (onChange/currentUser) already
      // pulls photoURL from the Firestore doc, so this is the only source
      // of truth needed.
      if (updates.username) await updateProfile(fbUser, { displayName: updates.username });

      await svAuth.log(`Profile updated: ${updates.username || fbUser.displayName || fbUser.email}`);
      const profile = await getUserDoc(fbUser.uid);
      return { ok: true, user: { uid: fbUser.uid, ...profile } };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Changes the account email. Requires the current password to
   *  re-authenticate first (Firebase security requirement). */
  async changeEmail(newEmail, currentPassword) {
    newEmail = (newEmail || "").trim();
    if (!newEmail) return { ok: false, error: "Enter a new email address." };
    const reauth = await svAuth._reauth(currentPassword);
    if (!reauth.ok) return reauth;
    const fbUser = auth.currentUser;
    try {
      await updateEmail(fbUser, newEmail);
      await updateDoc(doc(db, USERS_COLLECTION, fbUser.uid), { email: newEmail });
      await svAuth.log(`Email changed for: ${fbUser.displayName || newEmail}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Changes the account password. Requires the current password. */
  async changePassword(newPassword, currentPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: "New password must be at least 6 characters." };
    }
    const reauth = await svAuth._reauth(currentPassword);
    if (!reauth.ok) return reauth;
    try {
      await updatePassword(auth.currentUser, newPassword);
      await svAuth.log(`Password changed for: ${auth.currentUser.displayName || auth.currentUser.email}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Permanently deletes the signed-in user's account (Auth + Firestore
   *  profile). Requires re-authentication. */
  async deleteAccount(currentPassword) {
    const reauth = await svAuth._reauth(currentPassword);
    if (!reauth.ok) return reauth;
    const fbUser = auth.currentUser;
    try {
      const uid = fbUser.uid;
      const name = fbUser.displayName || fbUser.email;
      await deleteDoc(doc(db, USERS_COLLECTION, uid));
      await deleteUser(fbUser);
      svAuth.log(`Account deleted: ${name}`); // best-effort; user is signed out already
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /* ------------------------- Web App Settings (preferences) ------------------------- */
  // Preferences (theme, language, notifications, autoplay, quality, privacy)
  // are stored per-user in Firestore under users/{uid}.settings, so they
  // follow the account across devices. A localStorage mirror is kept only
  // for instant, flicker-free theme application before Firestore responds.

  DEFAULT_SETTINGS: {
    theme: "dark",
    language: "en",
    notifyEmail: true,
    notifyPush: true,
    autoplay: true,
    videoQuality: "auto",
    privateProfile: false,
    showActivity: true
  },

  async getSettings() {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ...svAuth.DEFAULT_SETTINGS };
    const profile = await getUserDoc(fbUser.uid);
    return { ...svAuth.DEFAULT_SETTINGS, ...(profile && profile.settings ? profile.settings : {}) };
  },

  async updateSettings(partial) {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ok: false, error: "You are signed out. Please log in again." };
    try {
      const current = await svAuth.getSettings();
      const merged = { ...current, ...partial };
      await updateDoc(doc(db, USERS_COLLECTION, fbUser.uid), { settings: merged });
      try { localStorage.setItem("sv_theme", merged.theme); } catch (e) {}
      return { ok: true, settings: merged };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /* ------------------------- Subscription Plan ------------------------- */
  // Every account (new signups and legacy accounts backfilled via
  // getUserDoc above) carries a `plan` field on its users/{uid} doc:
  // 'basic' | 'standard' | 'premium'. This is display/gating metadata
  // only — no payment processor is wired up, so "upgrading" here just
  // records the chosen plan and logs it; swap upgradePlan()'s body for a
  // real checkout call when billing is added.
  PLANS: [
    {
      key: "basic",
      label: "Basic",
      price: "Free",
      tagline: "Get started with StreamVerse at no cost.",
      benefits: [
        "Unlimited access to the full catalog",
        "1 device streaming at a time",
        "Standard definition (SD) playback",
        "Movie Badge rank progression"
      ],
      demerits: [
        "Ads shown between titles",
        "No downloads for offline viewing",
        "No HD/4K playback"
      ]
    },
    {
      key: "standard",
      label: "Standard",
      price: "₦8.99/mo",
      tagline: "More devices, better picture, no ads.",
      benefits: [
        "Everything in Basic",
        "Ad-free viewing",
        "Full HD (1080p) playback",
        "2 devices streaming at once",
        "Offline downloads on 1 device"
      ],
      demerits: [
        "No 4K/HDR playback",
        "No simultaneous downloads across devices"
      ]
    },
    {
      key: "premium",
      label: "Premium",
      price: "₦14.99/mo",
      tagline: "The full StreamVerse experience.",
      benefits: [
        "Everything in Standard",
        "4K Ultra HD + HDR playback",
        "4 devices streaming at once",
        "Offline downloads on up to 4 devices",
        "Early access to new releases"
      ],
      demerits: [
        "Highest monthly cost",
        "4K benefit requires a compatible device/connection"
      ]
    }
  ],

  /** Returns the full plan catalog (benefits + demerits) for rendering
   *  the upgrade window. */
  getPlans() {
    return svAuth.PLANS;
  },

  /** Looks up a single plan definition by key, defaulting to Basic. */
  getPlan(key) {
    return svAuth.PLANS.find(p => p.key === key) || svAuth.PLANS[0];
  },

  /* ------------------------- Plan pricing (admin-controlled) -------------------------
     Prices normally live as static strings on PLANS above. Admins can
     override the monthly rate for any plan from the dashboard; the
     override is stored in settings/planPricing and, once loaded, is
     patched directly onto the matching PLANS entry so every existing
     price display (plan cards, checkout total, admin tables) picks it
     up with no other code changes needed. */
  /** Returns the symbol used for all subscription plan/billing price
   *  displays (plan cards, checkout total, admin Plan Pricing editor). */
  getBillingCurrencySymbol() {
    return BILLING_CURRENCY_SYMBOL;
  },

  async refreshPlanPricing() {
    try {
      const snap = await getDoc(doc(db, SETTINGS_COLLECTION, PLAN_PRICING_DOC));
      if (!snap.exists()) return svAuth.PLANS;
      const saved = snap.data() || {};
      svAuth.PLANS.forEach((p) => {
        const override = saved[p.key];
        if (override === undefined || override === null || override === "") return;
        const num = parseFloat(override);
        if (!isNaN(num)) p.price = num === 0 ? "Free" : `${BILLING_CURRENCY_SYMBOL}${num.toFixed(2)}/mo`;
      });
    } catch (err) {
      console.error("Failed to load plan pricing", err);
    }
    return svAuth.PLANS;
  },

  /** Admin-only: saves a monthly price (plain number, USD) for one or
   *  more plan keys, e.g. { standard: 9.99, premium: 16.99 }, and
   *  applies it immediately in-memory so the admin sees it update
   *  without a page reload. */
  async updatePlanPricing(prices) {
    const admin = await svAuth.currentUser();
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can edit plan pricing." };
    }
    try {
      await setDoc(doc(db, SETTINGS_COLLECTION, PLAN_PRICING_DOC), prices, { merge: true });
      Object.entries(prices).forEach(([key, val]) => {
        const plan = svAuth.PLANS.find(p => p.key === key);
        const num = parseFloat(val);
        if (plan && !isNaN(num)) plan.price = num === 0 ? "Free" : `${BILLING_CURRENCY_SYMBOL}${num.toFixed(2)}/mo`;
      });
      await svAuth.log(`Admin ${admin.username} updated plan pricing`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Self-service plan change for the signed-in viewer. Paid plans
   *  (Standard/Premium) are admin-controlled only — a viewer can use this
   *  to cancel back down to the free Basic plan, but cannot grant
   *  themselves a paid plan here. Admins assign/renew paid plans via
   *  svAuth.setUserPlan() from the admin dashboard instead. */
  async upgradePlan(planKey) {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ok: false, error: "You are signed out. Please log in again." };
    const plan = svAuth.PLANS.find(p => p.key === planKey);
    if (!plan) return { ok: false, error: "That plan doesn't exist." };
    if (plan.key !== "basic") {
      return { ok: false, error: "Standard and Premium are assigned by an admin. Contact support to upgrade your plan." };
    }
    try {
      await updateDoc(doc(db, USERS_COLLECTION, fbUser.uid), {
        plan: plan.key,
        planMonths: null,
        planStartedAt: null,
        planExpiresAt: null
      });
      await svAuth.log(`${fbUser.displayName || fbUser.email} switched to the ${plan.label} plan`);
      return { ok: true, plan: plan.key };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Admin-only: assign or renew a viewer's subscription plan, including
   *  how many months it runs for. Records a computed expiry date and the
   *  price snapshot at time of assignment so admin.js can show billing
   *  history/renewal state without recalculating from the live PLANS list. */
  async setUserPlan(uid, username, planKey, months, opts) {
    const admin = await svAuth.currentUser();
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can set a user's plan." };
    }
    const plan = svAuth.PLANS.find(p => p.key === planKey);
    if (!plan) return { ok: false, error: "That plan doesn't exist." };
    const numMonths = plan.key === "basic" ? null : Math.max(1, parseInt(months, 10) || 1);
    const startedAt = Date.now();
    const expiresAt = numMonths ? startedAt + numMonths * 30 * 24 * 60 * 60 * 1000 : null;
    try {
      await updateDoc(doc(db, USERS_COLLECTION, uid), {
        plan: plan.key,
        planMonths: numMonths,
        planPriceAtAssignment: plan.price,
        planStartedAt: startedAt,
        planExpiresAt: expiresAt,
        planSetByAdmin: admin.username
      });
      await svAuth.log(
        `Admin ${admin.username} set ${username}'s plan to ${plan.label}` +
        (numMonths ? ` for ${numMonths} month${numMonths === 1 ? '' : 's'} (${plan.price})` : '')
      );
      // Drop an "approved" event into upgradeRequests so plan-notify.js can
      // push a bell/toast notification to that viewer, the same way it
      // does for a checkout request the admin approves. Skipped when this
      // call is itself resolving an existing request (that doc's own
      // status flip to "approved" already serves as the event).
      if (!(opts && opts.skipNotification)) {
        await addDoc(collection(db, UPGRADE_REQUESTS_COLLECTION), {
          uid,
          username,
          planKey: plan.key,
          planLabel: plan.label,
          planPrice: plan.price,
          months: numMonths,
          methodKey: null,
          methodLabel: "Set by admin",
          status: "approved",
          source: "direct",
          createdAt: startedAt,
          resolvedAt: startedAt,
          resolvedBy: admin.username
        });
      }

      // Upgrade-approved email — best-effort, never blocks the plan
      // change itself. Skipped for "basic" since that's a downgrade, not
      // something worth an "you're now on X" congratulations email.
      if (plan.key !== "basic") {
        try {
          const targetSnap = await getDoc(doc(db, USERS_COLLECTION, uid));
          const targetEmail = targetSnap.exists() ? targetSnap.data().email : null;
          if (targetEmail) {
            const idToken = await svAuth.getIdToken();
            await fetch("/.netlify/functions/send-transactional-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
              body: JSON.stringify({
                type: "upgrade_approved",
                targetEmail,
                targetFirstName: username,
                planName: plan.label,
                planPrice: plan.price
              })
            });
          }
        } catch (emailErr) {
          console.error("Upgrade-approved email failed to send:", emailErr);
        }
      }

      return { ok: true, plan: plan.key, planExpiresAt: expiresAt };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Returns the fixed currency list used by the Bank/Wire Transfer
   *  "Currency" dropdown in the admin editor. */
  getPaymentCurrencies() {
    return PAYMENT_CURRENCIES;
  },

  /* ------------------------- Payment methods (admin-controlled) ------------------------- */
  // A single settings/paymentMethods doc holds which checkout payment
  // options are available (enabled/disabled) plus their label + payer
  // instructions. Only admins can edit this; every viewer reads the same
  // shared config when opening the upgrade checkout.
  async getPaymentMethods() {
    try {
      const snap = await getDoc(doc(db, SETTINGS_COLLECTION, PAYMENT_METHODS_DOC));
      const saved = snap.exists() ? snap.data() : {};
      // Merge over defaults so newly-added methods still show up even if
      // an older settings doc doesn't have them yet.
      const merged = {};
      Object.keys(DEFAULT_PAYMENT_METHODS).forEach((k) => {
        merged[k] = { ...DEFAULT_PAYMENT_METHODS[k], ...(saved[k] || {}) };
      });
      return merged;
    } catch (err) {
      return DEFAULT_PAYMENT_METHODS;
    }
  },

  /** Admin-only: enable/disable and edit the label + instructions for
   *  each checkout payment method. `methods` is the full {key: {...}} map
   *  as returned by getPaymentMethods(). */
  async updatePaymentMethods(methods) {
    const admin = await svAuth.currentUser();
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can edit payment methods." };
    }
    try {
      await setDoc(doc(db, SETTINGS_COLLECTION, PAYMENT_METHODS_DOC), methods, { merge: true });
      await svAuth.log(`Admin ${admin.username} updated the checkout payment methods`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /* ------------------------- Upgrade requests (checkout) ------------------------- */
  // Since there's no real payment processor wired up, "checkout" creates a
  // pending upgradeRequests/{id} doc with the chosen plan/months/payment
  // method. An admin reviews it in the dashboard and approves (which calls
  // setUserPlan) or rejects it. This keeps plan-granting admin-only while
  // still giving viewers a normal-feeling upgrade + checkout flow.
  //
  // Proof of payment (bank slip, PDF or JPG) is stored as a base64 data URL
  // directly on the request doc — the same approach already used for
  // avatar photos — rather than Firebase Storage, since this project's
  // Firebase Storage bucket isn't provisioned/enabled and uploadBytes()
  // would just hang indefinitely, silently preventing the request (and
  // proof) from ever reaching the admin. Firestore documents cap out at
  // 1MiB, so the caller (profile.html) enforces a modest raw-file size
  // limit before base64-encoding it; this is checked again here as a
  // safety net.
  async submitUpgradeRequest(planKey, months, methodKey, note, proof) {
    const fbUser = auth.currentUser;
    if (!fbUser) return { ok: false, error: "You are signed out. Please log in again." };
    const plan = svAuth.PLANS.find((p) => p.key === planKey);
    if (!plan || plan.key === "basic") return { ok: false, error: "Pick a paid plan to upgrade to." };
    const methods = await svAuth.getPaymentMethods();
    const method = methods[methodKey];
    if (!method || !method.enabled) return { ok: false, error: "That payment method isn't available right now." };
    const numMonths = Math.max(1, parseInt(months, 10) || 1);

    let proofDataUrl = "", proofType = "", proofName = "";
    if (proof && proof.dataUrl) {
      const allowed = ["application/pdf", "image/jpeg", "image/jpg"];
      if (!allowed.includes(proof.type)) {
        return { ok: false, error: "Proof of payment must be a PDF or JPG file." };
      }
      // Base64 data URLs run ~33% larger than the raw file; keep well
      // under Firestore's 1MiB document limit.
      if (proof.dataUrl.length > 950000) {
        return { ok: false, error: "That file is too large — please upload one under 650KB." };
      }
      proofDataUrl = proof.dataUrl;
      proofType = proof.type;
      proofName = proof.name || "";
    }

    try {
      const profile = await getUserDoc(fbUser.uid);
      const ref = await addDoc(collection(db, UPGRADE_REQUESTS_COLLECTION), {
        uid: fbUser.uid,
        username: (profile && profile.username) || fbUser.displayName || "",
        email: (profile && profile.email) || fbUser.email || "",
        planKey: plan.key,
        planLabel: plan.label,
        planPrice: plan.price,
        months: numMonths,
        methodKey,
        methodLabel: method.label,
        note: (note || "").trim(),
        proofUrl: proofDataUrl,
        proofType,
        proofName,
        status: "pending",
        createdAt: Date.now()
      });
      await svAuth.log(
        `${(profile && profile.username) || fbUser.email} requested to upgrade to ${plan.label} ` +
        `for ${numMonths} month${numMonths === 1 ? '' : 's'} via ${method.label}` +
        `${proofDataUrl ? ' (proof of payment attached)' : ''}`
      );
      return { ok: true, id: ref.id };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Admin-only: every upgrade request, newest first. */
  async listUpgradeRequests() {
    const snap = await getDocs(collection(db, UPGRADE_REQUESTS_COLLECTION));
    const out = [];
    snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
    return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },

  /** Admin-only: approve a pending upgrade request — grants the plan via
   *  setUserPlan() and marks the request approved. */
  async approveUpgradeRequest(requestId) {
    const admin = await svAuth.currentUser();
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can approve upgrade requests." };
    }
    try {
      const reqSnap = await getDoc(doc(db, UPGRADE_REQUESTS_COLLECTION, requestId));
      if (!reqSnap.exists()) return { ok: false, error: "That request no longer exists." };
      const req = reqSnap.data();
      const result = await svAuth.setUserPlan(req.uid, req.username, req.planKey, req.months, { skipNotification: true });
      if (!result.ok) return result;
      await updateDoc(doc(db, UPGRADE_REQUESTS_COLLECTION, requestId), {
        status: "approved",
        resolvedAt: Date.now(),
        resolvedBy: admin.username
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /** Admin-only: reject a pending upgrade request (no plan change). */
  async rejectUpgradeRequest(requestId, reason) {
    const admin = await svAuth.currentUser();
    if (!admin || admin.role !== "admin") {
      return { ok: false, error: "Only an admin can reject upgrade requests." };
    }
    try {
      await updateDoc(doc(db, UPGRADE_REQUESTS_COLLECTION, requestId), {
        status: "rejected",
        resolvedAt: Date.now(),
        resolvedBy: admin.username,
        rejectReason: (reason || "").trim()
      });
      await svAuth.log(`Admin ${admin.username} rejected an upgrade request`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  },

  /* ------------------------- Movie Badge (watch-history rank) ------------------------- */
  // A fixed 6-tier badge ladder, ranked up automatically from real watch
  // history (unique titles watched to completion). Replaces the old
  // free-text "bio" field on the profile — this is display-only and
  // computed, never hand-edited.
  BADGE_TIERS: [
    { key: "rookie",      label: "Rookie",      min: 0  },
    { key: "pro",         label: "Pro",         min: 5  },
    { key: "master",      label: "Master",      min: 15 },
    { key: "grandmaster", label: "Grandmaster", min: 30 },
    { key: "legend",      label: "Legend",      min: 50 },
    { key: "ultimate",    label: "Ultimate",    min: 80 }
  ],

  /** Returns the tier object for a given completed-title count. */
  badgeForCount(count) {
    const tiers = svAuth.BADGE_TIERS;
    let current = tiers[0];
    for (const t of tiers) { if (count >= t.min) current = t; }
    return current;
  },

  /** Returns the next tier above `count` (or null if already at the top). */
  nextBadge(count) {
    return svAuth.BADGE_TIERS.find(t => t.min > count) || null;
  },

  /** One-shot read of the current user's watch stats + badge, e.g. for
   *  painting the Profile page. Never throws — returns zeroed stats for
   *  signed-out callers. */
  async getWatchStats() {
    const fbUser = auth.currentUser;
    const empty = { completedTitles: [], count: 0, badge: svAuth.badgeForCount(0) };
    if (!fbUser) return empty;
    const profile = await getUserDoc(fbUser.uid);
    const stats = (profile && profile.watchStats) || {};
    const completedTitles = Array.isArray(stats.completedTitles) ? stats.completedTitles : [];
    return { completedTitles, count: completedTitles.length, badge: svAuth.badgeForCount(completedTitles.length) };
  },

  /** Called by watch-tracker.js as a title plays. `percent` is 0-100 of
   *  the video watched so far. A title only counts once it crosses 90%,
   *  and each title id only ever counts once toward the badge ladder.
   *  Returns whether this call unlocked a new (higher) badge, so the
   *  caller can show a "badge unlocked" notification. */
  async recordWatchProgress(movieId, percent) {
    const fbUser = auth.currentUser;
    if (!fbUser || !movieId || percent < 90) return { ok: false, leveledUp: false };
    try {
      const profile = await getUserDoc(fbUser.uid);
      const stats = (profile && profile.watchStats) || { completedTitles: [] };
      const completedTitles = Array.isArray(stats.completedTitles) ? stats.completedTitles : [];
      if (completedTitles.includes(movieId)) {
        // Already counted — nothing changed, but still hand back the
        // current badge so callers have a consistent return shape.
        return { ok: true, leveledUp: false, badge: svAuth.badgeForCount(completedTitles.length) };
      }
      const previousBadge = svAuth.badgeForCount(completedTitles.length);
      const updated = [...completedTitles, movieId];
      const newBadge = svAuth.badgeForCount(updated.length);
      await updateDoc(doc(db, USERS_COLLECTION, fbUser.uid), {
        watchStats: { completedTitles: updated }
      });
      const leveledUp = newBadge.key !== previousBadge.key;
      if (leveledUp) await svAuth.log(`${fbUser.displayName || fbUser.email} ranked up to ${newBadge.label}`);
      return { ok: true, leveledUp, badge: newBadge, previousBadge, count: updated.length };
    } catch (err) {
      return { ok: false, leveledUp: false, error: friendlyError(err) };
    }
  },

  /* ------------------------------- Activity log ------------------------------ */
  // Kept in localStorage (fast, no read/write costs) since it's just an
  // in-browser admin convenience log, not sensitive data.
  //
  // The logging bot itself can be switched off from the admin Activity
  // panel (isLoggingEnabled/setLoggingEnabled). While disabled, log()
  // becomes a no-op for every caller across the app — nothing new is
  // recorded until an admin re-enables it. The on/off flip is always
  // recorded (bypassing the flag) so there's a permanent audit trail of
  // who paused/resumed logging and when.
  isLoggingEnabled() {
    try {
      const raw = localStorage.getItem("sv_activity_log_enabled");
      return raw === null ? true : raw === "true"; // default: on
    } catch (e) { return true; }
  },
  setLoggingEnabled(enabled) {
    try {
      localStorage.setItem("sv_activity_log_enabled", enabled ? "true" : "false");
    } catch (e) { /* no-op */ }
    // Record the toggle itself even if we're turning logging off.
    this._writeLogEntry(`Activity logging bot ${enabled ? "enabled" : "disabled"}`);
  },
  log(message) {
    if (!this.isLoggingEnabled()) return;
    this._writeLogEntry(message);
  },
  _writeLogEntry(message) {
    try {
      const key = "sv_activity_log";
      const raw = localStorage.getItem(key);
      const log = raw ? JSON.parse(raw) : [];
      log.unshift({ message, time: Date.now() });
      if (log.length > 300) log.length = 300;
      localStorage.setItem(key, JSON.stringify(log));
    } catch (e) { /* no-op */ }
  },
  getLog() {
    try {
      const raw = localStorage.getItem("sv_activity_log");
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  },
  clearLog() {
    localStorage.removeItem("sv_activity_log");
  }
};

// Expose globally so plain <script> pages (non-module) can call it via
// the small shim below.
window.svAuth = svAuth;
window.dispatchEvent(new Event("svAuthReady"));
