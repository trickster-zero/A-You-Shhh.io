async function loadPhotos() {
  const photos = await fetch('data/photos.json').then(r => r.json());
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = photos.map(p => `
    <figure><img src="images/${p.file}" alt="${p.alt}" loading="lazy"></figure>
  `).join('');
  grid.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img));
  });
}

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

loadPhotos();
