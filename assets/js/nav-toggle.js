// サイドメニューの開閉（nav.html が読み込まれた後に nav-loader.js から呼ばれる）
function initNavToggle() {
  const navToggle = document.getElementById('navToggle');
  const sideMenu  = document.getElementById('sideMenu');
  const sideClose = document.getElementById('sideClose');
  const backdrop  = document.getElementById('sideBackdrop');

  if (!navToggle || !sideMenu || !sideClose) return;

  const setOpen = (open) => {
    sideMenu.classList.toggle('is-open', open);
    if (backdrop) backdrop.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  navToggle.addEventListener('click', () => setOpen(true));
  sideClose.addEventListener('click', () => setOpen(false));
  if (backdrop) backdrop.addEventListener('click', () => setOpen(false));

  // メニュー内のリンクを押したら閉じる（同じページ内の移動でも閉じるように）
  sideMenu.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}

// 他のJSから呼べるようにしておく
window.initNavToggle = initNavToggle;
