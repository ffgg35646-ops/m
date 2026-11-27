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
      const role = String(data?.user?.role || 'student').trim().toLowerCase();
      if (!data?.ok || !name || role !== 'student') return;

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

      const pageParams = new URLSearchParams(window.location.search);
      const currentPath = window.location.pathname.split('/').pop() || '';
      const coursePurchase = document.getElementById('purchaseLink');
      if (coursePurchase && currentPath === 'course-details.html') {
        const courseId = pageParams.get('courseId') || '';
        coursePurchase.href = 'orders.html?targetType=courses&targetId=' + encodeURIComponent(courseId);
        coursePurchase.textContent = 'تفعيل الكورس بكود';
      }
      const bookPurchase = document.getElementById('buyLink');
      if (bookPurchase && currentPath === 'library-details.html') {
        const productId = pageParams.get('productId') || '';
        bookPurchase.href = 'orders.html?targetType=library&targetId=' + encodeURIComponent(productId);
        bookPurchase.textContent = 'تفعيل الكتاب بكود';
      }
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
          const logoutLink = document.createElement('a');
          logoutLink.className = 'btn btn-outline';
          logoutLink.href = 'login.html';
          logoutLink.dataset.studentLogout = 'true';
          logoutLink.textContent = 'تسجيل الخروج';
          actions.append(accountLink, greeting, language, currency, logoutLink);
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

  document.addEventListener('click', event => {
    const logout = event.target instanceof Element ? event.target.closest('[data-student-logout], a.logout, button.menu-logout') : null;
    if (!logout) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .catch(() => {})
      .finally(() => window.location.replace('login.html'));
  }, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStudentName, { once: true });
  } else {
    applyStudentName();
  }
})();
