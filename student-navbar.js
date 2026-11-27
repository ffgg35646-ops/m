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
