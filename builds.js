async function loadProjects() {
  const projects = await fetch('data/projects.json').then(r => r.json());
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = projects.map(p => `
    <div class="card">
      <h3>${p.title}</h3>
      <p>${p.description}</p>
      <div class="tags">${p.tags.map(t => `<span>${t}</span>`).join('')}</div>
      ${p.link ? `<div class="links"><a href="${p.link}" target="_blank" rel="noopener">View →</a></div>` : ''}
    </div>
  `).join('');
}

loadProjects();
