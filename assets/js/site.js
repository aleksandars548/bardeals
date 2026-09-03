(() => {
  const navs = document.querySelectorAll('.site-nav');
  navs.forEach((nav) => {
    const toggle = nav.querySelector('.site-menu-toggle');
    const panel = nav.querySelector('.nav-wrap');
    if (!toggle || !panel) return;

    const close = () => {
      nav.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', () => {
      const open = !nav.classList.contains('menu-open');
      nav.classList.toggle('menu-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });

    panel.addEventListener('click', (event) => {
      if (event.target.closest('a')) close();
    });

    document.addEventListener('click', (event) => {
      if (!nav.contains(event.target)) close();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 760) close();
    }, { passive: true });
  });
})();
