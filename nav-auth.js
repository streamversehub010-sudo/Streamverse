/* =========================================================================
   nav-auth.js
   Renders the account/login state into the `.nav-right` slot on the public
   pages (index.html, viewer.html). Requires firebase-auth.js (window.svAuth)
   to be loaded first.
   ========================================================================= */
(function(){
  const slot = document.getElementById('navAuthSlot');
  if (!slot) return;

  // Attached once, not inside render() — render() runs on every auth state
  // change (login, logout, token refresh), and previously re-added this
  // listener each time, stacking up duplicate handlers for the life of
  // the page.
  document.addEventListener('click', () => {
    const openDropdown = document.getElementById('accountDropdown');
    if (openDropdown) openDropdown.classList.remove('open');
  });

  function render(user){
    slot.innerHTML = '';
    const authBox = document.createElement('div');
    authBox.className = 'auth-box';

    if (user){
      const initial = user.username.charAt(0).toUpperCase();
      // Show the user's uploaded avatar (photoURL, set from Profile) if
      // they have one, otherwise fall back to the initial-letter circle.
      const avatarHtml = user.photoURL
        ? `<span class="avatar-circle"><img src="${user.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='${initial}';"></span>`
        : `<span class="avatar-circle">${initial}</span>`;
      authBox.innerHTML = `
        <div class="account-menu">
          <button class="account-pill" id="accountPillBtn">
            ${avatarHtml}
            <span class="account-name">${user.username}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="account-dropdown" id="accountDropdown">
            <a href="profile.html">My Profile</a>
            <a href="settings.html">Settings</a>
            ${user.role === 'admin' ? '<a href="admin.html">Admin Panel</a>' : ''}
            <a href="#" id="logoutLink">Log Out</a>
          </div>
        </div>`;
      slot.appendChild(authBox);

      const pillBtn = document.getElementById('accountPillBtn');
      const dropdown = document.getElementById('accountDropdown');
      pillBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });

      document.getElementById('logoutLink').addEventListener('click', async (e) => {
        e.preventDefault();
        await svAuth.logout();
        window.location.reload();
      });
    } else {
      authBox.innerHTML = `<a class="btn-login" href="login.html">Log In</a>`;
      slot.appendChild(authBox);
    }
  }

  function init(){
    svAuth.onChange(render);
  }

  if (window.svAuth) init();
  else window.addEventListener('svAuthReady', init, { once: true });
})();
