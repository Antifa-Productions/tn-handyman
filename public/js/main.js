/**
 * T&N Handyman — main.js
 * Mobile nav toggle, welcome modal, testimonial carousel,
 * and Service Worker registration.
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

    if (modal && !sessionStorage.getItem('welcomeDismissed')) {
        setTimeout(() => {
            modal.showModal();
        }, 400);

        modal.addEventListener('close', () => {
            sessionStorage.setItem('welcomeDismissed', 'true');
        });

        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.close();
            });
        }
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
