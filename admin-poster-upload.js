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

  let uploading = false; // guarded by isUploading(); admin.js checks this before letting a save go through

  // Cached references — grabbed lazily on init() since admin-poster-upload.js
  // loads before the DOM elements it needs are guaranteed parsed in some
  // load orders; init() is called once, right after DOMContentLoaded, from admin.js.
  let els = null;

  function grabElements() {
    return {
      fileInput: document.getElementById("fPosterFile"),
      urlField: document.getElementById("fPoster"),       // existing hidden field admin.js already reads
      preview: document.getElementById("fPosterPreview"),
      previewWrap: document.getElementById("fPosterPreviewWrap"),
      progressWrap: document.getElementById("fPosterProgressWrap"),
      progressBar: document.getElementById("fPosterProgressBar"),
      status: document.getElementById("fPosterStatus")
    };
  }

  function setStatus(message, isError) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.style.color = isError ? "var(--danger, #e5484d)" : "var(--text-lo, #9aa)";
  }

  function setProgress(percent) {
    if (!els.progressWrap || !els.progressBar) return;
    if (percent == null) {
      els.progressWrap.style.display = "none";
      return;
    }
    els.progressWrap.style.display = "block";
    els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  function showPreview(url) {
    if (!els.preview || !els.previewWrap) return;
    if (url) {
      els.preview.src = url;
      els.previewWrap.style.display = "block";
    } else {
      els.preview.removeAttribute("src");
      els.previewWrap.style.display = "none";
    }
  }

  function validateFile(file) {
    if (!ALLOWED_MIME.includes(file.type)) {
      return "Please choose a JPG, PNG, WebP, or GIF image.";
    }
    if (file.size > MAX_BYTES) {
      return `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`;
    }
    return null;
  }

  // Step 2 of the flow: ask our own Netlify function for a signature. Sends
  // the admin's Firebase ID token so only logged-in admins can mint one.
  async function requestSignature() {
    const idToken = await window.svAuth.getIdToken();
    if (!idToken) throw new Error("You must be signed in as an admin to upload images.");

    const res = await fetch(SIGN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Could not prepare the upload.");
    }
    return data; // { signature, timestamp, apiKey, cloudName, folder, allowedFormats }
  }

  // Step 3: upload the file directly to Cloudinary. Uses XMLHttpRequest
  // (rather than fetch) purely because it's the one that exposes real
  // upload-progress events for the progress bar.
  function uploadToCloudinary(file, sig) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", sig.apiKey);
      formData.append("timestamp", sig.timestamp);
      formData.append("signature", sig.signature);
      formData.append("folder", sig.folder);
      formData.append("allowed_formats", sig.allowedFormats.join(","));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress((e.loaded / e.total) * 100);
      };

      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { data = null; }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
          resolve(data.secure_url);
        } else {
          reject(new Error((data && data.error && data.error.message) || "Cloudinary upload failed."));
        }
      };
      xhr.onerror = () => reject(new Error("Network error while uploading to Cloudinary."));

      xhr.send(formData);
    });
  }

  async function handleFileSelected(file) {
    const validationError = validateFile(file);
    if (validationError) {
      setStatus(validationError, true);
      els.fileInput.value = "";
      return;
    }

    // Local instant preview while the real upload runs, so the admin isn't
    // staring at a blank box during the round trip.
    const localPreviewUrl = URL.createObjectURL(file);
    showPreview(localPreviewUrl);

    uploading = true;
    setStatus("Uploading…");
    setProgress(0);

    try {
      const sig = await requestSignature();
      const secureUrl = await uploadToCloudinary(file, sig);

      // This is the whole point: the existing #fPoster field now holds a
      // real Cloudinary HTTPS URL, exactly as if it had been typed in —
      // admin.js's submit handler and Firestore schema need no changes.
      els.urlField.value = secureUrl;
      showPreview(secureUrl);
      setStatus("Upload complete.");
    } catch (err) {
      setStatus(err.message || "Upload failed. Please try again.", true);
      // Fall back to whatever poster URL was already in the field (if any)
      // rather than leaving the preview pointed at a blob: URL that will
      // stop working once this tab session ends.
      showPreview(els.urlField.value || null);
    } finally {
      URL.revokeObjectURL(localPreviewUrl);
      setProgress(null);
      uploading = false;
      els.fileInput.value = ""; // allow re-selecting the same file again if needed
    }
  }

  /**
   * Called once, on page load, from admin.js to wire up the file input.
   */
  function init() {
    els = grabElements();
    if (!els.fileInput) return; // markup not present — nothing to wire up

    els.fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileSelected(file);
    });
  }

  /**
   * Called by admin.js every time the Add/Edit Title modal opens.
   * @param {string} existingUrl - movie.poster when editing, '' when adding new.
   */
  function reset(existingUrl) {
    if (!els) els = grabElements();
    if (els.fileInput) els.fileInput.value = "";
    setStatus("");
    setProgress(null);
    showPreview(existingUrl || null);
  }

  /**
   * Called by admin.js's submit handler to block saving mid-upload.
   */
  function isUploading() {
    return uploading;
  }

  window.svPosterUpload = { init, reset, isUploading };
})();
