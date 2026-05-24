document.addEventListener('DOMContentLoaded', () => {
    // Update year in footer
    const yearElement = document.getElementById('year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    // ── Hamburger Menu ──────────────────────────────────────────
    const hamburger = document.getElementById('hamburger');
    const navLinks = document.getElementById('nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('open');
            navLinks.classList.toggle('open');
        });

        // Close nav when a link is clicked (mobile UX)
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('open');
                navLinks.classList.remove('open');
            });
        });
    }

    // ── Scroll Animations ───────────────────────────────────────
    const observerOptions = { threshold: 0.1 };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.service-card, .section-title, .hero-content, .team-card, .solution-card, .testimonial-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s ease-out';
        observer.observe(el);
    });

    // ── Form Handling ───────────────────────────────────────────
    const form = document.getElementById('booking-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button');
            const originalText = submitBtn.textContent;

            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            submitBtn.textContent = 'Sending...';
            submitBtn.disabled = true;

            try {
                const apiHost = window.location.port === '3001' ? '' : 'http://localhost:3001';
                const response = await fetch(`${apiHost}/api/bookings`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });

                if (response.ok) {
                    alert('Thank you for contacting Anant Ambulance. We will get back to you immediately.');
                    form.reset();
                } else {
                    alert('Something went wrong. Please try calling us directly.');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Connection error. Please check your internet or call us directly.');
            } finally {
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });
    }

    // ── FAQ Accordion ───────────────────────────────────────────
    document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', () => {
            const item = question.parentElement;
            // Close others
            document.querySelectorAll('.faq-item.active').forEach(other => {
                if (other !== item) other.classList.remove('active');
            });
            item.classList.toggle('active');
        });
    });

    // ── Translation Logic ───────────────────────────────────────
    const langSwitch = document.getElementById('lang-switch');
    let translations = {};

    async function loadTranslations() {
        try {
            const apiHost = window.location.port === '3001' ? '' : 'http://localhost:3001';
            const response = await fetch(`${apiHost}/translations.json`);
            translations = await response.json();

            const savedLang = localStorage.getItem('preferredLang') || 'en';
            if (langSwitch) langSwitch.value = savedLang;
            updateLanguage(savedLang);
        } catch (error) {
            console.error('Error loading translations:', error);
        }
    }

    function updateLanguage(lang) {
        if (!translations[lang]) return;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (translations[lang][key]) {
                el.textContent = translations[lang][key];
            }
        });
        localStorage.setItem('preferredLang', lang);
    }

    if (langSwitch) {
        langSwitch.addEventListener('change', (e) => updateLanguage(e.target.value));
    }

    loadTranslations();

    // ── Smooth Scrolling ────────────────────────────────────────
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                window.scrollTo({ top: target.offsetTop - 80, behavior: 'smooth' });
            }
        });
    });

    // ── Price Calculator ────────────────────────────────────────
    const estService = document.getElementById('est-service');
    const estKm = document.getElementById('est-km');
    const totalEstimate = document.getElementById('total-estimate');

    if (estService && estKm && totalEstimate) {
        const calculatePrice = () => {
            const basePrice = parseInt(estService.value) || 0;
            const km = parseFloat(estKm.value) || 0;
            const total = basePrice + (km * 18);
            totalEstimate.textContent = total.toLocaleString('en-IN');
        };

        estService.addEventListener('change', calculatePrice);
        estKm.addEventListener('input', calculatePrice);
    }

    // ── Counter Animation ───────────────────────────────────────
    const counters = document.querySelectorAll('.counter');

    const animateCounters = () => {
        counters.forEach(counter => {
            const target = +counter.getAttribute('data-target');
            let count = 0;
            const inc = Math.ceil(target / 80);

            const updateCount = () => {
                count += inc;
                if (count < target) {
                    counter.innerText = count.toLocaleString();
                    setTimeout(updateCount, 20);
                } else {
                    counter.innerText = target.toLocaleString();
                }
            };
            updateCount();
        });
    };

    const statsSection = document.querySelector('.stats');
    if (statsSection) {
        const statsObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                animateCounters();
                statsObserver.unobserve(statsSection);
            }
        }, { threshold: 0.5 });
        statsObserver.observe(statsSection);
    }
});