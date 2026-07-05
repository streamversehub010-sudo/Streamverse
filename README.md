# StreamVerse — Firebase-authenticated build

This package wires the StreamVerse demo site up to **real Firebase
Authentication**, and keeps the admin console fully separated and
standalone from the viewer login flow.

## What changed

- **`firebase-auth.js`** (new) — initializes Firebase and exposes a
  `window.svAuth` API (`signup`, `login`, `logout`, `currentUser`,
  `onChange`, `listUsers`, `setBanned`, `deleteUserProfile`, activity log).
  It replaces the old plaintext, localStorage-only login system.
- **`login.html`** — viewer sign-up / log-in, now backed by Firebase Auth.
  New accounts get a Firestore profile at `users/{uid}` with `role: "viewer"`.
- **`admin-login.html`** — a completely separate, standalone admin login
  page. It signs in through Firebase too, but only succeeds if the
  signed-in account's Firestore profile has `role: "admin"` — otherwise it
  signs the user back out and shows an error. It never shares state or
  code paths with `login.html`.
- **`admin.html` / `admin.js`** — the admin console now gates on
  `svAuth.currentUser()` and bounces anyone who isn't an admin back to
  `admin-login.html`. Viewer account management (suspend/reinstate/delete)
  now reads and writes real Firestore user docs.
- **`catalog-firestore.js`** (new) — the movie catalog now lives in
  Firestore instead of localStorage, so admin edits sync **live, across
  every browser/device**, not just the admin's own browser. It exposes
  `window.svCatalog` (`subscribe`, `getMovieById`, `saveMovie`,
  `deleteMovie`, `resetCatalog`). Two collections back it:
  - `movie_overrides/{id}` — full movie doc for anything an admin added
    or edited.
  - `movie_deleted/{id}` — a marker doc for any factory (bundled) title
    an admin removed.
  The bundled `movieDatabase` (from `movies-data.js`) + `movie_overrides`
  − `movie_deleted` = the live catalog everyone sees, updated in real
  time via Firestore's `onSnapshot`.
- **`store.js`** — now only handles the live-stream simulation ("who's
  streaming right now") and the activity log; catalog logic moved to
  `catalog-firestore.js`, auth moved to `firebase-auth.js`.
- **`broadcast.js`** (new) — site-wide admin announcements, synced live
  via Firestore (`window.svBroadcast`). Lets an admin push a message —
  downtime notice, "new movie incoming" hype, cinema ticket news, or
  anything else — straight into **every** registered user's notification
  bell, instantly and without a page refresh. Two collections back it:
  - `broadcasts/{id}` — one doc per announcement (icon, title, body,
    category, timestamp).
  - `app_config/broadcast` — a single settings doc holding the
    **"notify everyone when a stream goes live"** toggle. When on,
    switching a title Live from the admin Dashboard automatically sends
    a "Now streaming live: &lt;title&gt;" broadcast to everyone; when
    off, going live stays silent.
  Managed from the new **Broadcast** tab in `admin.html`/`admin.js`.
  `notifications.js` merges this live feed into each user's existing
  notification bell/panel alongside their personal alerts (e.g. badge
  unlocks) — one unified notification center, no separate UI needed.
  "Read" state for broadcasts (which are one shared doc, not per-user)
  is tracked locally per browser/account so dismissing them doesn't
  affect other users.
- **`nav-auth.js`** — renders the navbar login pill / account menu from
  live Firebase auth state.

Everything else (page layout, styling, movie data defaults) is unchanged.
Live-stream viewer counts are still a per-browser simulated random walk —
say the word if you'd like those synced through Firestore too.

## Header redesign: Trending Movies Carousel

The old static hero panel is gone. `index.html` now opens with a full-width
**Trending Movies Carousel**:

- Pulls only titles with `trending: true` in the catalog, ordered by their
  `order` field.
- Auto-slides every 5s, loops infinitely, pauses on hover (desktop), and
  supports swipe (mobile) plus prev/next arrows and pagination dots.
- Each slide shows the backdrop image, title, rating, year, genre, a
  short description, and Watch Now / Download buttons, inside a light
  "liquid glass" panel.
- Built with `transform: translateX()` only (no `left`/`margin`
  animation), `will-change`/`translateZ(0)` for GPU acceleration,
  `loading="lazy"` on every slide but the first, and next-slide image
  preloading.

**Admin control (Content Library panel):**
- Each title's Add/Edit form has a **Movie Settings** section with
  **Featured**, **Trending**, and **New Release** checkboxes, plus a
  **Backdrop Image URL** field (falls back to the poster if left blank).
- A new **Trending Slideshow Order** card lists every Trending title as a
  drag-and-drop-reorderable row; dropping a row persists the new `order`
  values to Firestore, which is what the homepage carousel plays in.

## Footer

`index.html` and `category.html` now share a fuller footer with quick
links (Home / Movies / Series / Anime / Live Sports / Privacy Policy /
Terms of Service / Contact Us / DMCA) and the standard disclaimer. The
linked pages (`privacy.html`, `terms.html`, `contact.html`, `dmca.html`)
are simple static placeholders — replace the copy with your own legal text
before going live.

**"Contact Us" popup (index.html only).** The footer's Contact Us item is
now a button, not a link — clicking it opens an in-page popup instead of
navigating to `contact.html`:

- **Support info** (support email, phone, and any number of custom rows —
  office hours, live chat, mailing address, etc.) is always shown, to
  every visitor, signed in or not. It's fully admin-managed from the new
  **Support Contact** tab in `admin.html`/`admin.js`: edit the email/phone
  and use **+ Add Field** / **Remove** to manage the custom rows, then
  **Save Changes**. Backed by Firestore at `app_config/supportContact`
  (`support-contact.js`, `window.svSupportContact`), synced live the same
  way Broadcasts are.
- **The message form** ("Send Feedback or Request a Movie") underneath
  that info is a **Premium-plan perk**: signed-out visitors and
  Basic/Standard viewers see an upgrade/sign-in prompt instead. Signed-in
  Premium viewers (`user.plan === 'premium'`) get a real form (type,
  email, message) that sends straight to your inbox via EmailJS — same
  no-backend approach as `contact.html`, wired up in `footer-contact.js`
  (fill in `EMAILJS_PUBLIC_KEY` / `EMAILJS_SERVICE_ID` / `EMAILJS_TEMPLATE_ID`
  there, matching the values already set in `contact.js`).

## One-time Firebase setup

1. In the [Firebase console](https://console.firebase.google.com/) for
   project **streamverselab-4a5f5**, enable **Authentication → Sign-in
   method → Email/Password**.
2. Enable **Firestore Database** (production mode is fine).
3. Create your first admin account:
   - Go to `login.html` on your deployed site and sign up normally
     (this creates a `role: "viewer"` account), **or** create the user
     directly in Firebase Auth.
   - In Firestore, open `users/{that user's uid}` and change
     `role` from `"viewer"` to `"admin"`.
   - That account can now sign in at `admin-login.html`.
4. Recommended Firestore security rules (Console → Firestore →
   Rules) so viewers can't grant themselves admin or read other users:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isAdmin() {
         return request.auth != null &&
           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
       }

       match /users/{uid} {
         allow read: if request.auth != null &&
           (request.auth.uid == uid || isAdmin());
         allow create: if request.auth != null && request.auth.uid == uid;
         allow update, delete: if isAdmin();
       }

       // Movie catalog: anyone (including signed-out visitors) can read
       // the live catalog; only admins can add/edit/remove titles.
       match /movie_overrides/{movieId} {
         allow read: if true;
         allow write: if isAdmin();
       }
       match /movie_deleted/{movieId} {
         allow read: if true;
         allow write: if isAdmin();
       }

       // Broadcast announcements (admin -> all users): every signed-in
       // user reads the feed for their notification center; only admins
       // can publish/remove entries.
       match /broadcasts/{broadcastId} {
         allow read: if request.auth != null;
         allow write: if isAdmin();
       }
       // Single settings doc: the "notify everyone when a stream goes
       // live" toggle on the admin Broadcast panel.
       match /app_config/{docId} {
         allow read: if request.auth != null;
         allow write: if isAdmin();
       }

       // Contact Us popup support info (email/phone/custom fields).
       // Readable by anyone, including signed-out visitors, since the
       // footer popup shows it to every site visitor; only admins can
       // edit it from the Support Contact panel.
       match /app_config/supportContact {
         allow read: if true;
         allow write: if isAdmin();
       }
     }
   }
   ```

## Deploying to Netlify

This is a static site — no build step required.

1. Drag-and-drop this whole folder onto
   [app.netlify.com/drop](https://app.netlify.com/drop), **or**
   connect the repo/folder as a new Netlify site with:
   - Build command: *(none)*
   - Publish directory: `.`
2. In Firebase console → Authentication → Settings → **Authorized
   domains**, add your Netlify domain (e.g. `your-site.netlify.app`) so
   sign-in works from production.

## Notes

- The movie catalog, live-stream toggles, and activity log still use
  `localStorage` as a lightweight demo "database" — swap that for
  Firestore too if you want catalog data to sync across devices/admins.
- `firebase-auth.js` is loaded as an ES module (`<script type="module">`)
  directly from the `gstatic.com` Firebase CDN, so there's no npm build
  step needed for deployment.
