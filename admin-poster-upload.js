/* =========================================================================
   admin-poster-upload.js — powers the "Poster Image" uploader inside the
   Add/Edit Title modal on admin.html.
   -------------------------------------------------------------------------
   PURPOSE
   Replaces manual "paste a URL" entry for the poster with a real file
   picker that uploads straight to Cloudinary and fills in the SAME
   #fPoster field admin.js already reads on save. Nothing about the
   Firestore schema or admin.js's save logic changes — `movie.poster`
   is still just a plain URL string, same as always.

   HOW IT FITS TOGETHER
     admin.html   -> markup for the file input, preview, progress bar,
                     and the (now hidden) #fPoster field that holds the URL.
     THIS FILE    -> all the upload behavior, exposed as window.svPosterUpload.
     admin.js     -> calls svPosterUpload.reset(...) when the modal opens
                     (to show the right preview for add vs. edit), and
                     svPosterUpload.isUploading() as a guard before saving.

   UPLOAD FLOW
     1. Admin picks a file -> validate type + size in the browser first
        (fast feedback, avoids a wasted round trip).
     2. Ask netlify/functions/cloudinary-sign.js for a signed timestamp
        (requires the admin's Firebase ID token — keeps this endpoint from
        being usable by non-admins).
     3. Upload the file directly to Cloudinary's REST API using that
        signature, tracking progress via XMLHttpRequest's upload.onprogress.
     4. On success, Cloudinary returns secure_url (https). That value is
        written straight into #fPoster.value, and the preview image + the
        rest of the app all pick it up exactly like a hand-typed URL would.

   Loaded as a plain (non-module) script, same as admin.js, and attaches
   itself to window.svPosterUpload so admin.js can call into it.
   ========================================================================= */

(function () {
  const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — mirrors MAX_BYTES in the Netlify function's cloudinary-config.js
  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const SIGN_ENDPOINT = "/.netlify/functions/cloudinary-sign";

  let uploading = false; // guarded by isUploading(); admin.js chec
