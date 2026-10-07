/**
 * T&N Handyman — main.js
 * Mobile nav toggle, welcome modal, testimonial carousel,
 * before/after swipe sliders, and Service Worker registration.
 * Contact form interactivity lives in /js/contact-form.js (contact page only).
 */

(() => {
    'use strict';

    // ---- Mobile nav toggle ----
    const navToggle = document.querySelector('.nav-toggle');
    const primaryNav = document.querySelector('.primary-nav');

    if (navToggle && primaryNav) {
        navToggle.addEventListener('click', () => {
            const expanded = navToggle.getAttribute('aria-expanded') === 'true';
            navToggle.setAttribute('aria-expanded', String(!expanded));
            primaryNav.classList.toggle('open');
        });

        // Close nav after following a link (mobile)
        primaryNav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                primaryNav.classList.remove('open');
                navToggle.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // ---- Welcome modal: show once per session ----
    const modal = document.getElementById('welcome-modal');

    if (modal) {
        if (!sessionStorage.getItem('welcomeDismissed')) {
            setTimeout(() => {
                modal.showModal();
            }, 400);
        }

        // "Browse the Site" is a submit button inside <form method="dialog">:
        // the browser closes the dialog natively and sets returnValue to the
        // button's value. We react to the close to jump to the services section.
        modal.addEventListener('close', () => {
            sessionStorage.setItem('welcomeDismissed', 'true');

            if (modal.returnValue === 'browse') {
                document.getElementById('services')
                    ?.scrollIntoView({ behavior: 'smooth' });
            }
        });

        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.close();
            });
        }

        // Safety net: tapping the backdrop (outside the dialog box) closes it.
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                modal.close();
            }
        });
    }

    // ---- Testimonial carousel controls ----
    const track = document.querySelector('.carousel-track');
    const prevBtn = document.querySelector('.carousel-btn.prev');
    const nextBtn = document.querySelector('.carousel-btn.next');

    if (track && prevBtn && nextBtn) {
        const cardWidth = () => {
            const card = track.querySelector('.testimonial-card');
            if (!card) return 0;
            // card width + gap
            const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
            return card.getBoundingClientRect().width + gap;
        };

        prevBtn.addEventListener('click', () => {
            track.scrollBy({
                left: -cardWidth(),
                behavior: 'smooth'
            });
        });

        nextBtn.addEventListener('click', () => {
            track.scrollBy({
                left: cardWidth(),
                behavior: 'smooth'
            });
        });
    }

    // ---- Before/After swipe sliders ----
    const sliders = document.querySelectorAll('.ba-slider');

    sliders.forEach((slider) => {
        const handle = slider.querySelector('.ba-handle');
        const afterImg = slider.querySelector('.img-after');
        let isDragging = false;

        const setPos = (percent) => {
            const pos = Math.max(0, Math.min(100, percent));
            handle.style.left = `${pos}%`;
            afterImg.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
            slider.setAttribute('aria-valuenow', String(Math.round(pos)));
        };

        const posFromX = (x) => {
            const rect = slider.getBoundingClientRect();
            return ((x - rect.left) / rect.width) *100;
        };

        const startDrag = () => {
            isDragging = true;
        };
        const endDrag = () => {
            isDragging = false;
        };

        // Initialize the split at 50%
        setPos(50);

        // Pointer events cover mouse, touch, and stylus in one API
        slider.addEventListener('pointerdown', (e) => {
            startDrag();
            setPos(posFromX(e.clientX));
            slider.setPointerCapture(e.pointerId);
        });
        slider.addEventListener('pointermove', (e) => {
            if (!isDragging) return;
            setPos(posFromX(e.clientX));
        });
        slider.addEventListener('pointerup', endDrag);
        slider.addEventListener('pointercancel', endDrag);

        // Keyboard accessibility: arrow keys scrub the comparison
        slider.tabIndex = 0;
        slider.addEventListener('keydown', (e) => {
            const current = parseFloat(handle.style.left) || 50;
            if (e.key === 'ArrowLeft') { setPos(current - 5); e.preventDefault(); }
            if (e.key === 'ArrowRight') { setPos(current + 5); e.preventDefault(); }
        });
    });

    // ---- Service Worker registration ----
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register('/sw.js', {
                    scope: '/'
                })
                .then((registration) => {
                    console.log('SW registered:', registration);

                    // Detect a newly installed worker waiting to activate
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        if (!newWorker) return;

                        newWorker.addEventListener('statechange', () => {
                            if (
                                newWorker.state === 'installed' &&
                                navigator.serviceWorker.controller
                            ) {
                                console.log(
                                    'New content available; refresh to update.'
                                );
                                // Optional: surface a "Refresh" toast to the user here.
                            }
                        });
                    });
                })
                .catch((error) => {
                    console.error('SW registration failed:', error);
                });
        });
    }
})();
