/* Kingston Chartered Auditing & Advisory – interactions */
(function () {
  'use strict';

  // ---------- WhatsApp floating chat (auto-injected on every page) ----------
  (function injectWhatsApp() {
    if (document.querySelector('.wa-float')) return;
    const phone = '971508747098';
    const msg = encodeURIComponent('Hi Kingston, I would like to enquire about your services.');
    const wrap = document.createElement('div');
    wrap.className = 'wa-float';
    wrap.innerHTML = `
      <div class="wa-bubble-wrap">
        <div class="wa-bubble" role="status">
          <span>
            <strong>Need a hand?</strong>
            <small>Chat with a Kingston advisor on WhatsApp</small>
          </span>
          <button class="wa-close" aria-label="Dismiss">×</button>
        </div>
      </div>
      <a class="wa-btn" href="https://wa.me/${phone}?text=${msg}" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp">
        <svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
          <path d="M19.11 17.205c-.372 0-1.088 1.39-1.518 1.39-.156 0-.382-.144-.806-.402-1.197-.726-2.16-1.578-2.973-2.83-.146-.224-.376-.488-.376-.776 0-.484.652-.74.916-1.226.236-.434.07-.808-.122-1.198-.196-.396-.838-2.022-1.146-2.638-.282-.566-.572-.494-.812-.494-.226 0-.484-.026-.74-.026s-.66.084-1.014.404c-.36.328-1.342 1.246-1.342 3.024 0 1.78 1.298 3.5 1.49 3.74.196.244 2.522 4.014 6.252 5.466 3.094 1.204 3.728.984 4.402.92.674-.062 2.182-.876 2.494-1.728.314-.852.314-1.582.218-1.728-.092-.142-.336-.226-.706-.412-.37-.184-2.18-1.072-2.518-1.196-.336-.124-.578-.184-.82.182zM16.026 32c-2.788 0-5.476-.83-7.78-2.402L0 32l2.494-7.39A14.02 14.02 0 0 1 0 16C0 7.178 7.18 0 16.024 0c8.85 0 16.01 7.178 16.01 16.026 0 8.844-7.16 16.024-16.01 16.024zm.024-29.418c-7.4 0-13.4 6-13.4 13.4 0 2.93.95 5.706 2.74 8.026l-1.46 4.32 4.474-1.42c2.247 1.674 4.93 2.46 7.65 2.46 7.4 0 13.4-6 13.4-13.4S23.45 2.582 16.05 2.582z"/>
        </svg>
      </a>
    `;
    document.body.appendChild(wrap);

    const bubble = wrap.querySelector('.wa-bubble');
    const close  = wrap.querySelector('.wa-close');
    const STORAGE_KEY = 'wa-bubble-dismissed';
    if (sessionStorage.getItem(STORAGE_KEY) !== '1') {
      setTimeout(() => bubble.classList.add('is-visible'), 1800);
    }
    close && close.addEventListener('click', () => {
      bubble.classList.remove('is-visible');
      sessionStorage.setItem(STORAGE_KEY, '1');
    });
  })();

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

  // ---------- Hero slider ----------
  const heroSlider = document.querySelector('[data-hero-slider]');
  if (heroSlider) {
    const track = heroSlider.querySelector('.hero-track');
    const slides = Array.from(track.children);
    const dotsWrap = heroSlider.querySelector('.hero-dots');
    const prev = heroSlider.querySelector('[data-hero-prev]');
    const next = heroSlider.querySelector('[data-hero-next]');
    const counterCurrent = heroSlider.querySelector('.hero-counter .current');
    const counterTotal = heroSlider.querySelector('.hero-counter .total');
    const progressBar = heroSlider.querySelector('.hero-progress-bar');
    const interval = parseInt(heroSlider.dataset.heroSlider, 10) || 6000;
    let i = 0, timer = null, progressTimer = null, paused = false;

    if (counterTotal) counterTotal.textContent = String(slides.length).padStart(2, '0');

    // build dots
    if (dotsWrap) {
      slides.forEach((_, idx) => {
        const b = document.createElement('button');
        b.setAttribute('aria-label', `Slide ${idx + 1}`);
        b.addEventListener('click', () => go(idx, true));
        dotsWrap.appendChild(b);
      });
    }
    const dots = dotsWrap ? Array.from(dotsWrap.children) : [];

    const go = (idx, manual) => {
      i = (idx + slides.length) % slides.length;
      track.style.transform = `translateX(-${i * 100}%)`;
      dots.forEach((d, k) => d.classList.toggle('active', k === i));
      if (counterCurrent) counterCurrent.textContent = String(i + 1).padStart(2, '0');
      if (manual) restart();
      else resetProgress();
    };
    const resetProgress = () => {
      if (!progressBar) return;
      progressBar.style.transition = 'none';
      progressBar.style.width = '0%';
      requestAnimationFrame(() => {
        progressBar.style.transition = `width ${interval}ms linear`;
        progressBar.style.width = '100%';
      });
    };
    const restart = () => {
      clearTimeout(timer);
      resetProgress();
      timer = setTimeout(() => go(i + 1), interval);
    };
    const start = () => { resetProgress(); timer = setTimeout(() => go(i + 1), interval); };

    prev && prev.addEventListener('click', () => go(i - 1, true));
    next && next.addEventListener('click', () => go(i + 1, true));

    heroSlider.addEventListener('mouseenter', () => { paused = true; clearTimeout(timer); progressBar && (progressBar.style.transition = 'none'); });
    heroSlider.addEventListener('mouseleave', () => { paused = false; restart(); });

    // Touch swipe
    let sx = 0;
    heroSlider.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    heroSlider.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1), true);
    });

    go(0);
    start();
  }

  // ---------- Generic slider (testimonials / cards) ----------
  document.querySelectorAll('[data-slider]').forEach((root) => {
    const track = root.querySelector('.slider-track');
    if (!track) return;
    const items = Array.from(track.children);
    if (items.length === 0) return;
    const prevBtn = root.querySelector('[data-slider-prev]');
    const nextBtn = root.querySelector('[data-slider-next]');
    const dotsWrap = root.querySelector('.slider-dots');
    let i = 0;

    const desktopPer = parseInt(root.dataset.sliderPer, 10) || 2;
    const perView = () => {
      if (window.matchMedia('(max-width: 720px)').matches) return 1;
      if (window.matchMedia('(max-width: 1024px)').matches) return Math.min(2, desktopPer);
      return desktopPer;
    };
    const pages = () => Math.max(1, Math.ceil(items.length / perView()));

    if (dotsWrap) {
      const rebuild = () => {
        dotsWrap.innerHTML = '';
        for (let k = 0; k < pages(); k++) {
          const b = document.createElement('button');
          b.setAttribute('aria-label', `Page ${k + 1}`);
          b.addEventListener('click', () => go(k));
          dotsWrap.appendChild(b);
        }
        update();
      };
      rebuild();
      window.addEventListener('resize', rebuild);
    }

    const go = (idx) => {
      i = Math.max(0, Math.min(pages() - 1, idx));
      const offset = (100 / perView()) * (perView() * i);
      track.style.transform = `translateX(-${offset}%)`;
      update();
    };
    const update = () => {
      if (!dotsWrap) return;
      Array.from(dotsWrap.children).forEach((d, k) => d.classList.toggle('active', k === i));
    };
    prevBtn && prevBtn.addEventListener('click', () => go(i - 1));
    nextBtn && nextBtn.addEventListener('click', () => go(i + 1));

    let sx = 0;
    track.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    });

    go(0);
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
