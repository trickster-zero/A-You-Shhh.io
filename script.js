// Portal: flash, then travel to the gallery page
function enterGallery() {
  const warp = document.getElementById('warp');
  warp.classList.remove('go');
  void warp.offsetWidth;
  warp.classList.add('go');
  setTimeout(() => { window.location.href = 'gallery.html'; }, 1000);
}

const portal = document.getElementById('portal');
portal.addEventListener('click', enterGallery);
portal.addEventListener('keydown', e => { if (e.key === 'Enter') enterGallery(); });
