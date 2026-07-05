/* =========================================================================
   netlify/functions/cloudinary-sign.js
   -------------------------------------------------------------------------
   Serverless endpoint: POST /.netlify/functions/cloudinary-sign

   Why this function exists at all:
   StreamVerse's admin panel is a static page with no backend server in
   front of it — admin.js talks to Firestore directly from the browser.
   That's fine for Firestore (security rules protect it), but Cloudinary
   uploads need an API secret, and secrets can never live in browser code.
   So this tiny function is the one server-side step in the flow: the
   browser asks it for a signature, then uploads the file straight to
   Cloudinary itself (the file bytes never pass through this function or
   through Firestore).

   Flow:
     1. admin-poster-upload.js POSTs here with the caller's Firebase ID
        token (so only logged-in admins can mint upload signatures).
     2. This function verifies that token + admin role, then signs a
        timestamp + folder + allowed-formats payload with the Cloudinary
        API secret.
     3. It returns the signature (never the secret) plus everything the
        browser needs to complete the upload directly against Cloudinary.

   REQUIRED SETUP (Netlify env vars)
     CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
       -> see lib/cloudinary-config.js
     FIREBASE_SERVICE_ACCOUNT
       -> same one already used by send-transactional-email.js, reused
          here only to verify the caller's ID token + admin role.
   ========================================================================= */

const admin = require("firebase-admin");
const {
  cloudinary,
  POSTER_FOLDER,
  ALLOWED_FORMATS,
  isConfigured
} = require("./lib/cloudinary-config");

let firebaseInitError = null;
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    if (!serviceAccount.project_id) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing or invalid JSON.");
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (err) {
    firebaseInitError = err;
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

// Same "is this caller an admin" check used by the admin_custom email type
// in send-transactional-email.js — kept local here so this function has no
// dependency on that file, just on the same env vars/collections it uses.
async function getCallerFromAuthHeader(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    const db = admin.firestore();
    const snap = await db.collection("users").doc(decoded.uid).get();
    return { decoded, profile: snap.exists ? snap.data() : null };
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "Method not allowed." });
  }
  if (firebaseInitError) {
    return json(500, { ok: false, error: "Server misconfigured (Firebase)." });
  }
  if (!isConfigured()) {
    return json(500, {
      ok: false,
      error: "Server misconfigured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
    });
  }

  const caller = await getCallerFromAuthHeader(event);
  if (!caller || caller.profile?.role !== "admin") {
    return json(403, { ok: false, error: "Admin access required." });
  }

  // Every parameter that will be sent to Cloudinary's upload endpoint and
  // that affects the signature must be listed here, with the SAME values,
  // by admin-poster-upload.js when it actually uploads the file. Including
  // allowed_formats in the signed payload means it can't be stripped or
  // changed client-side — Cloudinary itself will reject anything outside
  // jpg/jpeg/png/webp/gif server-side, even if browser validation is bypassed.
  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = {
    timestamp,
    folder: POSTER_FOLDER,
    allowed_formats: ALLOWED_FORMATS.join(",")
  };

  try {
    const signature = cloudinary.utils.api_sign_request(paramsToSign, cloudinary.config().api_secret);
    return json(200, {
      ok: true,
      signature,
      timestamp,
      apiKey: cloudinary.config().api_key,
      cloudName: cloudinary.config().cloud_name,
      folder: POSTER_FOLDER,
      allowedFormats: ALLOWED_FORMATS
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message || "Could not sign upload request." });
  }
};
