/* Kingston Chartered Auditing & Advisory – interactions */
(function () {
  'use strict';

  // Sticky header shadow
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Mobile menu
  const toggle = document.querySelector('.nav-toggle');
  const drawer = document.querySelector('.mobile-menu');
  const closeBtn = document.querySelector('.mobile-menu .close');
  const open = () => { drawer && drawer.classList.add('is-open'); document.body.style.overflow = 'hidden'; };
  const close = () => { drawer && drawer.classList.remove('is-open'); document.body.style.overflow = ''; };
  toggle && toggle.addEventListener('click', open);
  closeBtn && closeBtn.addEventListener('click', close);
  drawer && drawer.querySelectorAll('a[href]').forEach(a => a.addEventListener('click', close));

  // Reveal on scroll
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  // Animated counters
  const counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window && counters.length) {
    const animate = (el) => {
      const target = parseFloat(el.dataset.count);
      const decimals = (el.dataset.decimals || 0) | 0;
      const dur = 1400;
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = (target * eased).toFixed(decimals);
        el.textContent = Number(v).toLocaleString(undefined, { minimumFractionDigits: decimals });
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const io2 = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { animate(e.target); io2.unobserve(e.target); } });
    }, { threshold: 0.4 });
    counters.forEach(el => io2.observe(el));
  }

  // Smooth scroll for in-page anchors
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href');
      if (id.length > 1) {
        const t = document.querySelector(id);
        if (t) {
          e.preventDefault();
          t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // Form prevent + simple feedback (no backend in this static demo)
  const form = document.querySelector('.contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      setTimeout(() => {
        btn.textContent = 'Thank you — we will be in touch';
        form.reset();
        setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 3000);
      }, 900);
    });
  }
})();
