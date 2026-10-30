// ---------- Data loading ----------
async function loadData() {
  const [photos, projects] = await Promise.all([
    fetch('data/photos.json').then(r => r.json()),
    fetch('data/projects.json').then(r => r.json())
  ]);
  renderGallery(photos);
  renderProjects(projects);
  observeReveals();
}

// ---------- Render ----------
function renderGallery(photos) {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = photos.map(p => `
    <figure><img src="images/${p.file}" alt="${p.alt}" loading="lazy"></figure>
  `).join('');
  grid.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img));
  });
}

function renderProjects(projects) {
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

// ---------- Portal ----------
function enterGallery() {
  const warp = document.getElementById('warp');
  warp.classList.remove('go');
  void warp.offsetWidth;
  warp.classList.add('go');
  setTimeout(() => {
    document.getElementById('gallery').scrollIntoView({ behavior: 'auto' });
    setTimeout(() => warp.classList.remove('go'), 300);
  }, 1000);
}

const portal = document.getElementById('portal');
portal.addEventListener('click', enterGallery);
portal.addEventListener('keydown', e => { if (e.key === 'Enter') enterGallery(); });

// ---------- Scroll reveal ----------
function observeReveals() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

// ---------- Lightbox ----------
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');

function openLightbox(img) {
  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightbox.classList.add('open');
}
function closeLightbox() { lightbox.classList.remove('open'); }

document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

loadData();
