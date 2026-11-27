(() => {
  const applyStudentName = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return;
      const data = await response.json();
      const name = String(data?.user?.name || '').trim();
      if (!data?.ok || !name) return;

      document.querySelectorAll('[data-student-name]').forEach(node => {
        node.textContent = name;
      });
      document.querySelectorAll('[data-student-greeting]').forEach(node => {
        node.textContent = 'مرحبا ' + name;
      });

      const firstInitial = Array.from(name)[0] || 'م';
      document.querySelectorAll('[data-student-avatar]').forEach(node => {
        node.textContent = firstInitial;
      });

      document.querySelectorAll('[data-shared-page-nav]').forEach(header => {
        const nav = header.querySelector('nav');
        if (nav) {
          const currentPage = location.pathname.split('/').pop() || '';
          const links = [
            ['الرئيسية', 'dashboard.html', false],
            ['كورساتي', 'courses.html', currentPage === 'course-details.html'],
            ['كتبي', 'library.html', currentPage === 'library-details.html'],
            ['المدونة', 'blog.html', false],
            ['تواصل معنا', 'student-support.html', false]
          ];
          nav.replaceChildren();
          links.forEach(([label, href, active]) => {
            const link = document.createElement('a');
            link.href = href;
            link.textContent = label;
            if (active) link.setAttribute('aria-current', 'page');
            nav.appendChild(link);
          });
        }
        const actions = header.querySelector('.actions');
        if (actions) {
          actions.replaceChildren();
          const accountLink = document.createElement('a');
          accountLink.className = 'btn btn-outline';
          accountLink.href = 'account.html';
          accountLink.textContent = 'حسابي';
          const greeting = document.createElement('span');
          greeting.className = 'tool';
          greeting.textContent = 'مرحبا ' + name;
          const language = document.createElement('button');
          language.className = 'tool';
          language.type = 'button';
          language.setAttribute('aria-label', 'اللغة');
          language.textContent = '🌐';
          const currency = document.createElement('span');
          currency.className = 'tool';
          currency.textContent = 'EGP';
          actions.append(accountLink, greeting, language, currency);
        }
      });

      const dashboardHeading = document.querySelector('.welcome h1');
      if (dashboardHeading) dashboardHeading.textContent = 'مرحباً بك، ' + name + ' 👋';

      const courseHeader = document.querySelector('.top .user');
      if (courseHeader && courseHeader.hasAttribute('data-student-greeting')) {
        courseHeader.textContent = 'مرحبا ' + name + '　|　EGP';
      }
    } catch (error) {
      // Keep the page usable if the session endpoint is temporarily unavailable.
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStudentName, { once: true });
  } else {
    applyStudentName();
  }
})();
