// Código da galeria em código (bloco HTML do modelo PGdeVendas3) com suporte a
// vídeo: .mp4 vira <video> sem som, em loop, tocando só no slide atual, e abre
// com controles no zoom. O gerador usa este código quando o carrossel tem vídeo
// e o do modelo ainda não suporta (marca srx-gallery-video-support).
// Também troca as imagens pela cor escolhida no seletor de variantes do
// PageFly (lista em .srx-gallery-colors; marca srx-gallery-colors-support).
export const GALLERY_VIDEO_MARKER = "srx-gallery-video-support";
export const GALLERY_COLORS_MARKER = "srx-gallery-colors-support";

export const SRX_GALLERY_CODE = String.raw`<style>
/* ================================
   SRX PRODUCT GALLERY (srx-gallery-video-support, srx-gallery-colors-support)
================================ */

.srx-gallery {
  --srx-radius: 18px;
  --srx-gap: 10px;
  --srx-bg: #f3f4f4;

  width: 100%;
  max-width: 700px;
  margin: 0 auto;
  font-family: Arial, sans-serif;
}

.srx-gallery * {
  box-sizing: border-box;
}

/* MAIN IMAGE */

.srx-gallery-main {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: var(--srx-radius);
  background: var(--srx-bg);

  touch-action: pan-y;
  cursor: grab;

  user-select: none;
  -webkit-user-select: none;
}

.srx-gallery-main.is-dragging {
  cursor: grabbing;
}

.srx-gallery-track {
  display: flex;
  width: 100%;
  height: 100%;

  transition: transform .38s cubic-bezier(.22,1,.36,1);
  will-change: transform;
}

.srx-gallery-main.is-dragging .srx-gallery-track {
  transition: none !important;
}

.srx-gallery-slide {
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
}

.srx-gallery-slide img,
.srx-gallery-slide video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;

  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

/* ARROWS */

.srx-gallery-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);

  width: 42px;
  height: 42px;

  border: 1px solid rgba(0,0,0,.05);
  border-radius: 50%;

  background: rgba(255,255,255,.94);
  color: #171717;

  display: flex;
  align-items: center;
  justify-content: center;

  cursor: pointer;
  z-index: 2;

  box-shadow: 0 3px 15px rgba(0,0,0,.07);

  opacity: 0;
  transition: opacity .2s, background .2s;
}

.srx-gallery-main:hover .srx-gallery-arrow,
.srx-gallery-arrow:focus-visible {
  opacity: 1;
}

.srx-gallery-arrow:hover {
  background: #fff;
}

.srx-gallery-prev {
  left: 15px;
}

.srx-gallery-next {
  right: 15px;
}

.srx-gallery-arrow svg {
  width: 20px;
  height: 20px;
}

/* IMAGE COUNTER */

.srx-gallery-counter {
  position: absolute;
  bottom: 16px;
  right: 16px;

  padding: 7px 11px;
  border-radius: 20px;

  background: rgba(255,255,255,.9);

  font-size: 11px;
  font-weight: 600;
  color: #333;

  z-index: 2;
  pointer-events: none;
}

/* THUMBNAILS */

.srx-gallery-thumbs {
  display: flex;
  gap: var(--srx-gap);

  margin-top: 12px;
  overflow-x: auto;

  scrollbar-width: none;
  scroll-behavior: smooth;

  padding: 2px;
}

.srx-gallery-thumbs::-webkit-scrollbar {
  display: none;
}

.srx-gallery-thumb {
  flex: 0 0 calc((100% - 30px) / 4);
  aspect-ratio: 1 / 1;

  padding: 0;

  border: 2px solid transparent;
  border-radius: 10px;

  overflow: hidden;
  background: var(--srx-bg);

  cursor: pointer;

  transition: border-color .2s, opacity .2s;
  opacity: .75;
}

.srx-gallery-thumb {
  position: relative;
}

.srx-gallery-thumb-play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0,0,0,.55);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.srx-gallery-thumb-play svg {
  width: 12px;
  height: 12px;
  margin-left: 2px;
  fill: #fff;
}

.srx-gallery-thumb.is-active {
  border-color: #171717;
  opacity: 1;
}

.srx-gallery-thumb:hover {
  opacity: 1;
}

.srx-gallery-thumb img,
.srx-gallery-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}

/* LIGHTBOX */

.srx-lightbox {
  position: fixed;
  inset: 0;

  z-index: 2147483647;

  background: rgba(255,255,255,.98);

  display: none;
  align-items: center;
  justify-content: center;
}

.srx-lightbox.is-open {
  display: flex;
}

.srx-lightbox-image,
.srx-lightbox-video {
  max-width: 90vw;
  max-height: 88vh;
  object-fit: contain;
}

.srx-lightbox-image[hidden],
.srx-lightbox-video[hidden] {
  display: none;
}

.srx-lightbox-close,
.srx-lightbox-arrow {
  position: absolute;

  border: 0;
  background: #f1f1f1;

  border-radius: 50%;

  width: 44px;
  height: 44px;

  font-size: 25px;
  color: #111;

  cursor: pointer;

  display: flex;
  align-items: center;
  justify-content: center;
}

.srx-lightbox-close {
  top: 20px;
  right: 20px;
}

.srx-lightbox-prev {
  left: 20px;
  top: 50%;
  transform: translateY(-50%);
}

.srx-lightbox-next {
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
}

/* MOBILE */

@media (max-width: 767px) {

  .srx-gallery {
    --srx-radius: 12px;
    --srx-gap: 7px;
  }

  .srx-gallery-arrow {
    opacity: 1;
    width: 34px;
    height: 34px;
  }

  .srx-gallery-prev {
    left: 9px;
  }

  .srx-gallery-next {
    right: 9px;
  }

  .srx-gallery-thumb {
    flex-basis: calc((100% - 21px) / 4);
    border-radius: 7px;
  }

  .srx-gallery-counter {
    bottom: 10px;
    right: 10px;
  }

  .srx-lightbox-arrow {
    width: 35px;
    height: 35px;
  }

  .srx-lightbox-prev {
    left: 8px;
  }

  .srx-lightbox-next {
    right: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .srx-gallery-track {
    transition: none;
  }
}
</style>


<!-- ================================
     PRODUCT GALLERY
================================ -->

<div class="srx-gallery" data-srx-gallery>

  <!-- PRODUCT IMAGES -->

  <script type="application/json" class="srx-gallery-data">
  []
  </script>

  <!-- IMAGES BY COLOR: { "colors": [...], "groups": { "Black": [...] } } -->

  <script type="application/json" class="srx-gallery-colors">
  {}
  </script>

  <div class="srx-gallery-main"
       aria-label="Product image gallery">

    <div class="srx-gallery-track"></div>

    <button
      class="srx-gallery-arrow srx-gallery-prev"
      type="button"
      aria-label="Previous image">

      <svg viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="1.8">
        <path d="m15 18-6-6 6-6"/>
      </svg>

    </button>

    <button
      class="srx-gallery-arrow srx-gallery-next"
      type="button"
      aria-label="Next image">

      <svg viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="1.8">
        <path d="m9 18 6-6-6-6"/>
      </svg>

    </button>

    <div class="srx-gallery-counter"></div>

  </div>

  <div class="srx-gallery-thumbs"
       aria-label="Product image thumbnails">
  </div>

</div>


<!-- ================================
     LIGHTBOX
================================ -->

<div class="srx-lightbox"
     data-srx-lightbox
     role="dialog"
     aria-modal="true"
     aria-label="Expanded product image"
     aria-hidden="true">

  <button
    class="srx-lightbox-close"
    type="button"
    aria-label="Close image">×</button>

  <button
    class="srx-lightbox-arrow srx-lightbox-prev"
    type="button"
    aria-label="Previous image">‹</button>

  <img
    class="srx-lightbox-image"
    alt="Expanded product image">

  <video
    class="srx-lightbox-video"
    controls
    loop
    playsinline
    hidden></video>

  <button
    class="srx-lightbox-arrow srx-lightbox-next"
    type="button"
    aria-label="Next image">›</button>

</div>


<script>
(function () {

  function initGallery(gallery) {

    if (gallery.dataset.initialized === "true") return;

    gallery.dataset.initialized = "true";

    let images;

    try {
      images = JSON.parse(
        gallery.querySelector(".srx-gallery-data").textContent
      ).filter(url =>
        typeof url === "string" &&
        /^https?:\/\//i.test(url)
      );
    } catch (error) {
      console.error("Invalid gallery image data", error);
      return;
    }

    const main = gallery.querySelector(".srx-gallery-main");
    const track = gallery.querySelector(".srx-gallery-track");
    const thumbs = gallery.querySelector(".srx-gallery-thumbs");
    const counter = gallery.querySelector(".srx-gallery-counter");
    const prev = gallery.querySelector(".srx-gallery-prev");
    const next = gallery.querySelector(".srx-gallery-next");

    const lightbox = document.querySelector(
      "[data-srx-lightbox]"
    );

    const lightboxImage = lightbox.querySelector(
      ".srx-lightbox-image"
    );

    const lightboxVideo = lightbox.querySelector(
      ".srx-lightbox-video"
    );

    function isVideo(url) {
      return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url) ||
        /cdn\.shopify\.com\/videos\//i.test(url);
    }

    function makeVideo(url) {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.preload = "metadata";
      video.src = url;
      return video;
    }

    function showInLightbox(index) {
      const url = images[index];
      if (isVideo(url)) {
        lightboxImage.hidden = true;
        lightboxImage.removeAttribute("src");
        lightboxVideo.hidden = false;
        if (lightboxVideo.getAttribute("src") !== url) {
          lightboxVideo.src = url;
        }
        lightboxVideo.play().catch(() => {});
      } else {
        lightboxVideo.pause();
        lightboxVideo.hidden = true;
        lightboxImage.hidden = false;
        lightboxImage.src = url;
        lightboxImage.alt = "Product image " + (index + 1);
      }
    }

    let current = 0;

    let wasSwiped = false;
    let lightboxOpen = false;
    let previousFocus = null;

    /* DRAG VARIABLES */

    let dragStartX = 0;
    let dragCurrentX = 0;
    let dragStartTime = 0;

    let isDragging = false;
    let dragMoved = false;

    const dragThreshold = 50;

    if (!images.length) {
      main.innerHTML =
        '<div style="padding:30px;text-align:center">' +
        'Add your product image URLs to the gallery.' +
        '</div>';
      return;
    }

    /* CREATE SLIDES AND THUMBNAILS */

    const baseImages = images;
    let thumbButtons = [];
    let slideVideos = [];

    function build() {

    track.innerHTML = "";
    thumbs.innerHTML = "";

    images.forEach((url, index) => {

      const slide = document.createElement("div");
      slide.className = "srx-gallery-slide";

      if (isVideo(url)) {
        const video = makeVideo(url);
        if (index === 0) video.autoplay = true;
        slide.appendChild(video);
      } else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Product image " + (index + 1);
        img.loading = index === 0 ? "eager" : "lazy";
        img.decoding = "async";
        img.draggable = false;
        slide.appendChild(img);
      }

      track.appendChild(slide);

      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "srx-gallery-thumb";

      thumb.setAttribute(
        "aria-label",
        "View product image " + (index + 1)
      );

      if (isVideo(url)) {
        const thumbVideo = makeVideo(url + "#t=0.1");
        thumb.appendChild(thumbVideo);
        const play = document.createElement("span");
        play.className = "srx-gallery-thumb-play";
        play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
        thumb.appendChild(play);
      } else {
        const thumbImg = document.createElement("img");
        thumbImg.src = url;
        thumbImg.alt = "";
        thumbImg.loading = "lazy";
        thumbImg.draggable = false;
        thumb.appendChild(thumbImg);
      }

      thumbs.appendChild(thumb);

      thumb.addEventListener("click", () => {
        goTo(index);
      });

    });

    thumbButtons = Array.from(thumbs.children);

    slideVideos = Array.from(track.children).map(
      slide => slide.querySelector("video")
    );

    }

    build();

    /* CHANGE IMAGE */

    function goTo(index) {

      current = (index + images.length) % images.length;

      track.style.transform =
        "translate3d(-" + (current * 100) + "%,0,0)";

      thumbButtons.forEach((button, i) => {

        const active = i === current;

        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));

      });

      thumbButtons[current].scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
      });

      counter.textContent =
        (current + 1) + " / " + images.length;

      /* Só o vídeo do slide atual toca (sem som, em loop). */
      slideVideos.forEach((video, i) => {
        if (!video) return;
        if (i === current && !lightboxOpen) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });

      if (lightboxOpen) {
        showInLightbox(current);
      }

    }

    /* ARROW NAVIGATION */

    prev.addEventListener("click", event => {
      event.stopPropagation();
      goTo(current - 1);
    });

    next.addEventListener("click", event => {
      event.stopPropagation();
      goTo(current + 1);
    });

    /* ================================
       REAL-TIME DRAG & SWIPE
    ================================ */

    main.addEventListener("pointerdown", function(e) {

      if (e.target.closest("button")) return;

      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }

      dragStartX = e.clientX;
      dragCurrentX = e.clientX;
      dragStartTime = Date.now();

      isDragging = true;
      dragMoved = false;
      wasSwiped = false;

      main.setPointerCapture(e.pointerId);

    });

    main.addEventListener("pointermove", function(e) {

      if (!isDragging) return;

      dragCurrentX = e.clientX;

      const deltaX = dragCurrentX - dragStartX;

      if (Math.abs(deltaX) > 5) {
        dragMoved = true;
        main.classList.add("is-dragging");
      }

      const galleryWidth = main.offsetWidth;

      let movement = deltaX;

      /* RESISTANCE AT EDGES */

      if (
        (current === 0 && deltaX > 0) ||
        (current === images.length - 1 && deltaX < 0)
      ) {
        movement = deltaX * 0.25;
      }

      const offset =
        (-current * galleryWidth) + movement;

      track.style.transform =
        "translate3d(" + offset + "px,0,0)";

    });

    function finishDrag(e) {

      if (!isDragging) return;

      isDragging = false;

      const deltaX =
        dragCurrentX - dragStartX;

      const elapsed =
        Math.max(Date.now() - dragStartTime, 1);

      const velocity =
        Math.abs(deltaX) / elapsed;

      main.classList.remove("is-dragging");

      if (dragMoved) {
        wasSwiped = true;
      }

      if (
        Math.abs(deltaX) > dragThreshold ||
        (
          Math.abs(deltaX) > 20 &&
          velocity > 0.5
        )
      ) {

        if (deltaX < 0) {
          goTo(
            Math.min(current + 1, images.length - 1)
          );
        } else {
          goTo(
            Math.max(current - 1, 0)
          );
        }

      } else {
        goTo(current);
      }

      if (main.hasPointerCapture(e.pointerId)) {
        main.releasePointerCapture(e.pointerId);
      }

    }

    main.addEventListener("pointerup", finishDrag);
    main.addEventListener("pointercancel", finishDrag);

    main.addEventListener("dragstart", function(e) {
      e.preventDefault();
    });

    /* ================================
       OPEN IMAGE ZOOM
    ================================ */

    main.addEventListener("click", event => {

      if (event.target.closest("button")) return;

      if (wasSwiped) {
        wasSwiped = false;
        return;
      }

      previousFocus = document.activeElement;
      lightboxOpen = true;

      if (slideVideos[current]) slideVideos[current].pause();
      showInLightbox(current);

      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");

      document.body.style.overflow = "hidden";

      lightbox.querySelector(
        ".srx-lightbox-close"
      ).focus();

    });

    /* CLOSE ZOOM */

    function closeLightbox() {

      lightboxOpen = false;

      lightboxVideo.pause();
      if (slideVideos[current]) slideVideos[current].play().catch(() => {});

      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");

      document.body.style.overflow = "";

      if (
        previousFocus &&
        typeof previousFocus.focus === "function"
      ) {
        previousFocus.focus();
      }

    }

    lightbox.querySelector(
      ".srx-lightbox-close"
    ).addEventListener("click", closeLightbox);

    /* LIGHTBOX NAVIGATION */

    lightbox.querySelector(
      ".srx-lightbox-prev"
    ).addEventListener("click", () => {
      goTo(current - 1);
    });

    lightbox.querySelector(
      ".srx-lightbox-next"
    ).addEventListener("click", () => {
      goTo(current + 1);
    });

    lightbox.addEventListener("click", event => {

      if (event.target === lightbox) {
        closeLightbox();
      }

    });

    /* KEYBOARD NAVIGATION */

    document.addEventListener("keydown", event => {

      if (!lightboxOpen) return;

      if (event.key === "Escape") {
        closeLightbox();
      }

      if (event.key === "ArrowLeft") {
        goTo(current - 1);
      }

      if (event.key === "ArrowRight") {
        goTo(current + 1);
      }

    });

    /* IMAGES BY COLOR
       Cor clicada no seletor de variantes (botão, select ou rádio) troca
       a lista; cor sem grupo volta pras imagens principais. */

    let colorData = {};
    try {
      const el = gallery.querySelector(".srx-gallery-colors");
      colorData = el ? JSON.parse(el.textContent || "{}") || {} : {};
    } catch (error) {
      colorData = {};
    }

    const colorNames = Array.isArray(colorData.colors) ? colorData.colors : [];
    const colorGroups = colorData.groups || {};
    let activeColor = null;

    function norm(value) {
      return String(value == null ? "" : value).trim().toLowerCase();
    }

    function findColor(value) {
      const v = norm(value);
      if (!v) return null;
      return colorNames.find(name => norm(name) === v) || null;
    }

    function setColor(name) {
      if (name === activeColor) return;
      activeColor = name;
      const list = (colorGroups[name] || []).filter(url =>
        typeof url === "string" &&
        /^https?:\/\//i.test(url)
      );
      images = list.length ? list : baseImages;
      build();
      goTo(0);
    }

    function colorFrom(el) {
      for (let node = el, depth = 0; node && node.nodeType === 1 && depth < 5; node = node.parentElement, depth++) {
        if (node === gallery || node === document.body) return null;
        const candidates = [
          node.getAttribute("data-value"),
          node.getAttribute("data-pf-value"),
          node.getAttribute("value"),
          node.getAttribute("title"),
          node.getAttribute("aria-label"),
          node.children.length === 0 || depth < 2 ? node.textContent : null
        ];
        for (const c of candidates) {
          const found = findColor(c);
          if (found) return found;
        }
      }
      return null;
    }

    function colorFromControl(el) {
      if (el.tagName === "SELECT") {
        const opt = el.options[el.selectedIndex];
        return findColor(el.value) || (opt ? findColor(opt.textContent) : null);
      }
      if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox") && el.checked) {
        return findColor(el.value) || colorFrom(el.parentElement);
      }
      return null;
    }

    if (colorNames.length) {

      document.addEventListener("click", event => {
        if (gallery.contains(event.target) || lightbox.contains(event.target)) return;
        const found = colorFrom(event.target);
        if (found) setColor(found);
      }, true);

      document.addEventListener("change", event => {
        const found = colorFromControl(event.target);
        if (found) setColor(found);
      }, true);

      /* Cor já marcada ao abrir a página. */
      document.querySelectorAll("select, input:checked").forEach(el => {
        if (activeColor) return;
        const found = colorFromControl(el);
        if (found && colorGroups[found]) setColor(found);
      });

    }

    /* INITIAL IMAGE */

    goTo(0);

  }

  function initAll() {

    document.querySelectorAll(
      "[data-srx-gallery]"
    ).forEach(initGallery);

  }

  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      initAll
    );

  } else {

    initAll();

  }

})();
</script>
`;
