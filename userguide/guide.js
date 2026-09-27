// Progressive enhancement: guide content, screenshots, and video links also work without JS.
(() => {
  const sidebar = document.querySelector('.sidebar');
  const menu = document.querySelector('.menu-toggle');
  const filter = document.querySelector('#topic-filter');
  const links = [...document.querySelectorAll('.sidebar-link')];
  const status = document.querySelector('#topic-status');
  const mobile = window.matchMedia('(max-width: 900px)');
  const setMenu = open => {
    sidebar.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
    menu.textContent = open ? 'Close contents' : 'Contents';
  };
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    setMenu(open);
    if (open) filter.focus();
  });
  mobile.addEventListener('change', () => setMenu(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      setMenu(false);
      menu.focus();
    }
  });
  links.forEach(link => {
    const section = document.querySelector(link.hash);
    link.dataset.search = [link.textContent, ...section.querySelectorAll('h3')].map(item => typeof item === 'string' ? item : item.textContent).join(' ').toLowerCase();
    link.addEventListener('click', () => {
      setMenu(false);
      if (mobile.matches) {
        section.setAttribute('tabindex', '-1');
        section.focus({ preventScroll: true });
      }
    });
  });
  filter.addEventListener('input', () => {
    const query = filter.value.trim().toLowerCase();
    let count = 0;
    links.forEach(link => { link.hidden = !link.dataset.search.includes(query); if (!link.hidden) count++; });
    document.querySelectorAll('.sidebar-group').forEach(group => { group.hidden = !group.querySelector('.sidebar-link:not([hidden])'); });
    status.hidden = !query;
    status.textContent = count ? `${count} matching topic${count === 1 ? '' : 's'}` : 'No matching topics. Try “logs”, “processes”, or “settings”.';
  });
  const sections = [...document.querySelectorAll('main > section[id]')];
  const updateActive = () => {
    let current = sections[0];
    for (const section of sections) if (section.getBoundingClientRect().top <= 145) current = section;
    links.forEach(link => {
      const active = link.hash === `#${current.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    });
  };
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) requestAnimationFrame(() => { updateActive(); ticking = false; });
    ticking = true;
  }, { passive: true });
  updateActive();
  document.querySelectorAll('.video-player').forEach(player => {
    const preview = player.innerHTML;
    const attach = () => player.querySelector('.video-launch').addEventListener('click', () => {
      // Pause any earlier video by restoring its preview before opening the next one.
      document.querySelectorAll('.video-player iframe').forEach(frame => frame.parentElement.dispatchEvent(new Event('restore-preview')));
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${player.dataset.videoId}?autoplay=1&rel=0`;
      iframe.title = `${player.dataset.videoTitle} — Alter demo`;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      player.replaceChildren(iframe);
      iframe.focus();
    });
    player.addEventListener('restore-preview', () => { player.innerHTML = preview; attach(); });
    attach();
  });
  const dialog = document.querySelector('.image-dialog');
  if (typeof dialog.showModal === 'function') {
    document.querySelectorAll('.screenshot-link').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();
      const image = link.closest('figure').querySelector('img');
      const expanded = dialog.querySelector('img');
      expanded.src = link.href;
      expanded.alt = image.alt;
      dialog.querySelector('.image-original').href = link.href;
      dialog.querySelector('p').textContent = image.alt;
      dialog.showModal();
    }));
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  }
  document.querySelectorAll('main table').forEach(table => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', `${table.closest('section').querySelector('h2').textContent} reference table`);
    table.before(wrap);
    wrap.append(table);
  });
  document.querySelectorAll('pre').forEach(pre => {
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    const button = document.createElement('button');
    button.className = 'copy-code';
    button.type = 'button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    const announcement = document.createElement('span');
    announcement.className = 'sr-only';
    announcement.setAttribute('role', 'status');
    pre.before(wrap);
    wrap.append(pre, button, announcement);
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.textContent);
        button.textContent = 'Copied';
        announcement.textContent = 'Code copied to clipboard.';
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        button.textContent = 'Code selected';
        announcement.textContent = 'Clipboard unavailable. Code selected; copy it with your keyboard.';
      }
      setTimeout(() => { button.textContent = 'Copy'; announcement.textContent = ''; }, 2500);
    });
  });
})();
