/* ================= Firebase ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateEmail as fbUpdateEmail,
  updatePassword as fbUpdatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC0gneQC_JYC4VprWDhwh94inXfLIFdAaU",
  authDomain: "phidagency.firebaseapp.com",
  projectId: "phidagency",
  storageBucket: "phidagency.firebasestorage.app",
  messagingSenderId: "902464394353",
  appId: "1:902464394353:web:d57c7913574b0ec3b677d0",
  measurementId: "G-BETNMQB0WN",
};

const firebaseApp = initializeApp(firebaseConfig);
try { getAnalytics(firebaseApp); } catch {}
const fbAuth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

/* ---- Cloudinary image hosting ---- */
const CLOUD_NAME = "dg1ed7obk";
const UPLOAD_PRESET = "lovelink_preset";

async function uploadToCloudinary(file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("upload_preset", UPLOAD_PRESET);
  const res = await fetch(
    "https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/image/upload",
    { method: "POST", body: fd }
  );
  if (!res.ok) throw new Error("Image upload failed");
  const json = await res.json();
  return json.secure_url;
}

/* ---- viewer for published studio sites: yourdomain#/s/<encoded-url> ---- */
(function initPublishedSiteViewer() {
  const m = location.hash.match(/^#\/s\/(.+)$/);
  if (!m) return;
  let target;
  try {
    target = decodeURIComponent(m[1]);
  } catch {
    return;
  }
  if (!/^https:\/\/res\.cloudinary\.com\//.test(target)) return;
  document.title = "Built with Phidagency Studio";
  const frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:9999;background:#fff";
  frame.src = target;
  document.body.appendChild(frame);
})();

const intro = document.getElementById("intro");
const content = document.getElementById("content");
const video = document.getElementById("intro-video");

const MIN_INTRO_TIME = 3500;
const start = Date.now();

function endIntro() {
  const elapsed = Date.now() - start;
  const wait = Math.max(0, MIN_INTRO_TIME - elapsed);

  setTimeout(() => {
    intro.classList.add("hide");
    content.classList.add("show");

    setTimeout(() => {
      video.pause();
      intro.remove();
    }, 1000);
  }, wait);
}

window.addEventListener("load", endIntro);

const themeToggle = document.getElementById("theme-toggle");

themeToggle.addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  themeToggle.innerHTML = next === "light" ? "&#9789;" : "&#9728;";
});

// Strict section access via navigation only
const views = document.querySelectorAll(".view");
const siteFooter = document.querySelector(".site-footer");

function showView(id) {
  views.forEach((v) => v.classList.toggle("active", v.id === id));
  const active = document.getElementById(id);
  if (siteFooter && active && siteFooter.parentElement !== active) {
    active.appendChild(siteFooter);
  }
}

// footer starts inside Home, scrolls with content
if (siteFooter) document.getElementById("home").appendChild(siteFooter);

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const hash = link.getAttribute("href");
    const target = document.getElementById(hash.slice(1));
    if (!target || !target.classList.contains("view")) return;
    e.preventDefault();
    showView(target.id);
    target.scrollTop = 0;
  });
});

// Drag to scroll for the cards track (desktop)
const track = document.getElementById("cards-track");

if (track) {
  let isDown = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;

  track.addEventListener("pointerdown", (e) => {
    isDown = true;
    moved = false;
    startX = e.clientX;
    startScroll = track.scrollLeft;
    track.classList.add("dragging");
  });

  window.addEventListener("pointermove", (e) => {
    if (!isDown) return;
    const delta = e.clientX - startX;
    if (Math.abs(delta) > 5) moved = true;
    track.scrollLeft = startScroll - delta;
  });

  window.addEventListener("pointerup", () => {
    isDown = false;
    track.classList.remove("dragging");
  });

  track.addEventListener(
    "click",
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    },
    true
  );
}

// Contact + application forms (no backend yet: shows confirmation and resets)
function handleForm(formId, sentText) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    const original = btn.textContent;
    btn.textContent = sentText;
    form.reset();
    setTimeout(() => {
      btn.textContent = original;
    }, 2500);
  });
}

handleForm("message-form", "Message Sent!");
handleForm("apply-form", "Sent!");

// In-page project viewer: opens linked site inside the website
const viewer = document.getElementById("project-viewer");
const viewerFrame = document.getElementById("viewer-frame");
const viewerTitle = document.getElementById("viewer-title");
const viewerClose = document.getElementById("viewer-close");
const viewerExternal = document.getElementById("viewer-open-external");

function openViewer(card) {
  const link = card.dataset.link;
  if (!link) return;
  viewerFrame.src = link;
  viewerExternal.href = link;
  viewerTitle.textContent = card.querySelector("h3, span")?.textContent || "";
  viewer.hidden = false;
  requestAnimationFrame(() => viewer.classList.add("open"));
}

function closeViewer() {
  viewer.classList.remove("open");
  setTimeout(() => {
    viewer.hidden = true;
    viewerFrame.removeAttribute("src");
  }, 300);
}

document.addEventListener("click", (e) => {
  const card = e.target.closest("[data-link]");
  if (card && !card.classList.contains("see-more-card")) {
    if (card.classList.contains("project-card") || card.classList.contains("project-item")) {
      openViewer(card);
    }
  }
});

viewerClose.addEventListener("click", closeViewer);
viewer.addEventListener("click", (e) => {
  if (e.target === viewer) closeViewer();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !viewer.hidden) closeViewer();
});

/* ================= Website Studio ================= */
const site = {
  type: "business",
  name: "",
  tagline: "",
  about: "",
  email: "",
  phone: "",
  bg: "#0f172a",
  text: "#f8fafc",
  accent: "#3b82f6",
  font: "sans",
  heroTitle: "",
  heroSub: "",
  heroBtn: "Get Started",
  heroImg: "",
  domain: "",
  blocks: [],
};

let uid = 1;
let step = 1;
let currentId = null;

const TYPE_META = {
  business: {
    label: "Business",
    tagline: "Professional services that grow your brand",
    palette: { bg: "#0f172a", text: "#f8fafc", accent: "#3b82f6" },
  },
  restaurant: {
    label: "Restaurant",
    tagline: "Delicious food, warm atmosphere",
    palette: { bg: "#fdf6ec", text: "#3f2d20", accent: "#d97706" },
  },
  portfolio: {
    label: "Portfolio",
    tagline: "Creative work that speaks for itself",
    palette: { bg: "#1e1b4b", text: "#eef2ff", accent: "#a78bfa" },
  },
  store: {
    label: "Online Store",
    tagline: "Quality products, fair prices",
    palette: { bg: "#ffffff", text: "#111827", accent: "#e11d48" },
  },
  blog: {
    label: "Blog",
    tagline: "Stories, ideas and inspiration",
    palette: { bg: "#0d1f17", text: "#ecfdf5", accent: "#22c55e" },
  },
  event: {
    label: "Event",
    tagline: "Join us for an unforgettable day",
    palette: { bg: "#170b29", text: "#f5f3ff", accent: "#c084fc" },
  },
};

function block(kind, extra) {
  const base = { id: uid++, kind };
  if (kind === "heading") base.text = "Your heading here";
  if (kind === "text")
    base.text =
      "Write anything here. Double-click this text while building to edit it, and it will appear on your finished website.";
  if (kind === "button") base.text = "Click Me";
  if (kind === "image") base.src = "https://picsum.photos/seed/" + base.id + "/800/400";
  if (kind === "features")
    base.items = ["Fast delivery", "Great quality", "Friendly support"];
  if (kind === "testimonials")
    base.items = [
      "Absolutely amazing service!",
      "Best decision we ever made.",
      "Five stars, highly recommended.",
    ];
  if (kind === "pricing")
    base.items = ["Basic — $9/mo", "Pro — $29/mo", "Team — $79/mo"];
  if (kind === "stats") base.items = ["150+ Clients", "8 Years", "99% Happy"];
  return Object.assign(base, extra || {});
}

const TEMPLATES = {
  business: () => [
    block("stats"),
    block("features"),
    block("heading", { text: "About Us" }),
    block("text"),
    block("testimonials"),
    block("form"),
  ],
  restaurant: () => [
    block("heading", { text: "Our Menu" }),
    block("features", { items: ["Margherita Pizza", "Grilled Salmon", "Tiramisu"] }),
    block("gallery"),
    block("testimonials"),
    block("button", { text: "Book a Table" }),
    block("form"),
  ],
  portfolio: () => [
    block("gallery"),
    block("heading", { text: "Selected Work" }),
    block("text"),
    block("stats"),
    block("testimonials"),
    block("button", { text: "Hire Me" }),
    block("form"),
  ],
  store: () => [
    block("button", { text: "Shop Now" }),
    block("features", { items: ["Free shipping", "Easy returns", "Secure payment"] }),
    block("gallery"),
    block("pricing"),
    block("form"),
  ],
  blog: () => [
    block("heading", { text: "Latest Posts" }),
    block("features", { items: ["Getting started", "Behind the scenes", "Tips & tricks"] }),
    block("text"),
    block("testimonials"),
    block("form"),
  ],
  event: () => [
    block("heading", { text: "Schedule" }),
    block("features", { items: ["Opening talk — 10:00", "Workshops — 13:00", "Live show — 20:00"] }),
    block("stats", { items: ["3 Stages", "20 Speakers", "500+ Seats"] }),
    block("button", { text: "Get Tickets" }),
    block("form"),
  ],
};

/* ---- wizard refs ---- */
const stepsBar = document.querySelectorAll("#steps-bar li");
const wsteps = document.querySelectorAll(".wstep");
const btnBack = document.getElementById("w-back");
const btnNext = document.getElementById("w-next");
const canvas = document.getElementById("site-canvas");

document.querySelectorAll(".type-card").forEach((cardBtn) => {
  cardBtn.addEventListener("click", () => {
    document
      .querySelectorAll(".type-card")
      .forEach((c) => c.classList.remove("selected"));
    cardBtn.classList.add("selected");
    site.type = cardBtn.dataset.type;
    site.blocks = [];
    const meta = TYPE_META[site.type];
    if (meta.palette) {
      site.bg = meta.palette.bg;
      site.text = meta.palette.text;
      site.accent = meta.palette.accent;
      document.getElementById("ws-bg").value = site.bg;
      document.getElementById("ws-text").value = site.text;
      document.getElementById("ws-accent").value = site.accent;
    }
  });
});

[
  ["ws-name", "name"],
  ["ws-tagline", "tagline"],
  ["ws-about", "about"],
  ["ws-email", "email"],
  ["ws-phone", "phone"],
].forEach(([id, key]) => {
  const el = document.getElementById(id);
  el.addEventListener("input", () => (site[key] = el.value));
});

document.getElementById("ws-bg").addEventListener("input", (e) => {
  site.bg = e.target.value;
});
document.getElementById("ws-text").addEventListener("input", (e) => {
  site.text = e.target.value;
});
document.getElementById("ws-accent").addEventListener("input", (e) => {
  site.accent = e.target.value;
});
document.getElementById("ws-font").addEventListener("change", (e) => {
  site.font = e.target.value;
});
document.getElementById("ws-domain").addEventListener("input", (e) => {
  site.domain = e.target.value.trim();
});

document.querySelectorAll(".swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    site.bg = sw.dataset.bg;
    site.text = sw.dataset.text;
    site.accent = sw.dataset.accent;
    document.getElementById("ws-bg").value = site.bg;
    document.getElementById("ws-text").value = site.text;
    document.getElementById("ws-accent").value = site.accent;
    paintCanvas();
  });
});

btnBack.addEventListener("click", () => goStep(step - 1));
btnNext.addEventListener("click", () => goStep(step + 1));

function goStep(n) {
  step = Math.min(4, Math.max(1, n));
  if (step === 4) prepareBuild();
  wsteps.forEach((s) =>
    s.classList.toggle("active", +s.dataset.step === step)
  );
  stepsBar.forEach((li, i) => {
    li.classList.toggle("active", i === step - 1);
    li.classList.toggle("done", i < step - 1);
  });
  btnBack.disabled = step === 1;
  btnNext.style.display = step === 4 ? "none" : "";
}

function prepareBuild() {
  const meta = TYPE_META[site.type];
  if (!site.name.trim()) {
    site.name = meta.label + " Website";
    document.getElementById("ws-name").value = site.name;
  }
  if (!site.tagline.trim()) {
    site.tagline = meta.tagline;
    document.getElementById("ws-tagline").value = site.tagline;
  }
  if (!site.blocks.length) site.blocks = TEMPLATES[site.type]();
  paintCanvas();
}

/* ---- hero image upload ---- */
const heroFile = document.getElementById("hero-file");

document.getElementById("hero-upload").addEventListener("click", () => heroFile.click());
heroFile.addEventListener("change", async () => {
  const f = heroFile.files[0];
  if (!f) return;
  heroFile.value = "";
  const btn = document.getElementById("hero-upload");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
  try {
    site.heroImg = await uploadToCloudinary(f);
    paintCanvas();
  } catch (e) {
    alert("Image upload failed — please try again.");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-upload"></i> Upload';
});
document.getElementById("hero-remove").addEventListener("click", () => {
  site.heroImg = "";
  paintCanvas();
});

/* ---- canvas rendering ---- */
function paintCanvas() {
  canvas.style.setProperty("--sa", site.accent);
  canvas.style.background =
    "linear-gradient(160deg," + hexRgba(site.accent, 0.1) + ",transparent 42%)," +
    "radial-gradient(120% 90% at 50% -10%," + hexRgba(site.accent, 0.14) + ",transparent 55%)," +
    site.bg;
  canvas.style.color = site.text;
  canvas.style.fontFamily =
    site.font === "serif"
      ? 'Georgia, "Times New Roman", serif'
      : site.font === "mono"
      ? 'Consolas, "Courier New", monospace'
      : '"Segoe UI", Arial, sans-serif';

  canvas.innerHTML = "";

  const nav = document.createElement("div");
  nav.className = "sc-nav";
  nav.textContent = site.name || "My Website";
  canvas.appendChild(nav);

  const hero = document.createElement("div");
  hero.className = "sc-hero" + (site.heroImg ? " has-img" : "");
  if (site.heroImg) hero.style.backgroundImage = "url(" + site.heroImg + ")";
  const shade = document.createElement("div");
  shade.className = "sc-shade";
  const inner = document.createElement("div");
  inner.className = "hero-inner";
  const h1 = editable(site, "heroTitle", "h1");
  if (!site.heroTitle) h1.textContent = site.name || "My Website";
  const hp = editable(site, "heroSub", "p");
  if (!site.heroSub) hp.textContent = site.tagline;
  const hbtn = editable(site, "heroBtn", "span");
  hbtn.className = "sc-btn";
  hbtn.style.display = site.heroBtn.trim() ? "" : "none";
  inner.append(h1, hp, document.createElement("br"), hbtn);
  hero.append(shade, inner);
  canvas.appendChild(hero);

  site.blocks.forEach((b) => canvas.appendChild(renderBlock(b)));
  stripeCanvasBlocks();
}

function stripeCanvasBlocks() {
  const blks = [...canvas.querySelectorAll(".blk")];
  blks.forEach((el, i) => {
    if (i % 2 === 0) {
      el.style.background = hexRgba(site.text, 0.04);
      el.style.borderRadius = "16px";
      el.style.padding = "18px";
    } else {
      el.style.background = "transparent";
    }
  });
}

function renderBlock(b) {
  const wrap = document.createElement("div");
  wrap.className = "blk";
  wrap.dataset.id = b.id;
  wrap.draggable = true;

  const del = document.createElement("button");
  del.className = "blk-del";
  del.innerHTML = '<i class="fas fa-xmark"></i>';
  del.title = "Remove block";
  del.addEventListener("click", () => {
    site.blocks = site.blocks.filter((x) => x.id !== b.id);
    wrap.remove();
  });
  wrap.appendChild(del);

  const nameInput = document.createElement("input");
  nameInput.className = "blk-name";
  nameInput.value = b.name || "";
  nameInput.placeholder = "+ Nav section name";
  nameInput.title = "Give this section a name to add it to the menu";
  nameInput.addEventListener("change", () => {
    b.name = nameInput.value.trim();
  });
  wrap.appendChild(nameInput);

  if (b.kind === "heading") {
    const h2 = editable(b, "text", "h2");
    h2.className = "";
    wrap.appendChild(h2);
  } else if (b.kind === "text") {
    wrap.appendChild(editable(b, "text", "p"));
  } else if (b.kind === "button") {
    const span = editable(b, "text", "span");
    span.className = "sc-btn";
    wrap.appendChild(span);
  } else if (b.kind === "image") {
    const img = document.createElement("img");
    img.className = "sc-img";
    img.src = b.src;
    img.alt = "";
    const url = document.createElement("input");
    url.className = "blk-url";
    url.value = b.src;
    url.placeholder = "Paste image URL...";
    url.addEventListener("change", () => {
      b.src = url.value.trim();
      img.src = b.src;
    });
    wrap.append(img, url);
  } else if (b.kind === "features") {
    const ul = document.createElement("ul");
    ul.className = "sc-features";
    b.items.forEach((item, i) => ul.appendChild(editable(b, "item", "li", i)));
    wrap.appendChild(ul);
  } else if (b.kind === "gallery") {
    const g = document.createElement("div");
    g.className = "sc-gallery";
    for (let i = 0; i < 3; i++) g.appendChild(document.createElement("div"));
    wrap.appendChild(g);
  } else if (b.kind === "testimonials") {
    const ul = document.createElement("ul");
    ul.className = "sc-testimonials";
    b.items.forEach((item, i) => ul.appendChild(editable(b, "item", "li", i)));
    wrap.appendChild(ul);
  } else if (b.kind === "pricing") {
    const ul = document.createElement("ul");
    ul.className = "sc-pricing";
    b.items.forEach((item, i) => ul.appendChild(editable(b, "item", "li", i)));
    wrap.appendChild(ul);
  } else if (b.kind === "stats") {
    const ul = document.createElement("ul");
    ul.className = "sc-stats";
    b.items.forEach((item, i) => ul.appendChild(editable(b, "item", "li", i)));
    wrap.appendChild(ul);
  } else if (b.kind === "form") {
    const f = document.createElement("div");
    f.className = "sc-form";
    ["Your name", "Your email", "Your message"].forEach((ph) => {
      const s = document.createElement("span");
      s.textContent = ph;
      f.appendChild(s);
    });
    const send = document.createElement("b");
    send.textContent = "Send";
    f.appendChild(send);
    wrap.appendChild(f);
  }

  wrap.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", "move:" + b.id);
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => wrap.classList.add("dragging"));
  });
  wrap.addEventListener("dragend", () => {
    wrap.classList.remove("dragging");
    clearDropLine();
  });

  return wrap;
}

function editable(b, field, tag, index) {
  const el = document.createElement(tag);
  el.contentEditable = "true";
  el.spellcheck = false;
  el.textContent =
    field === "item" ? b.items[index] : b[field];
  el.dataset.field = field;
  if (index !== undefined) el.dataset.index = index;
  el.addEventListener("input", () => {
    if (field === "item") b.items[index] = el.textContent;
    else b[field] = el.textContent;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
  });
  return el;
}

/* ---- drag & drop ---- */
const dropLine = document.createElement("div");
dropLine.className = "drop-line";

function clearDropLine() {
  dropLine.remove();
}

canvas.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const blks = [...canvas.querySelectorAll(".blk")];
  let before = null;
  for (const blk of blks) {
    const r = blk.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      before = blk;
      break;
    }
  }
  canvas.insertBefore(dropLine, before || null);
});

canvas.addEventListener("drop", (e) => {
  e.preventDefault();
  const data = e.dataTransfer.getData("text/plain");
  const blks = [...canvas.querySelectorAll(".blk")];
  let idx = blks.indexOf(dropLine.previousElementSibling);
  idx = idx === -1 ? blks.length : idx + 1;
  if (data.startsWith("kind:")) {
    const nb = block(data.slice(5));
    site.blocks.splice(idx, 0, nb);
    canvas.insertBefore(renderBlock(nb), dropLine);
  } else if (data.startsWith("move:")) {
    const id = +data.slice(5);
    const from = site.blocks.findIndex((b) => b.id === id);
    const [moved] = site.blocks.splice(from, 1);
    let to = blks.filter((el) => +el.dataset.id !== id).indexOf(
      dropLine.previousElementSibling
    );
    to = to === -1 ? site.blocks.length : to + 1;
    site.blocks.splice(to, 0, moved);
    paintCanvas();
  }
  clearDropLine();
});

canvas.addEventListener("dragleave", (e) => {
  if (!canvas.contains(e.relatedTarget)) clearDropLine();
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", "kind:" + chip.dataset.kind);
    e.dataTransfer.effectAllowed = "copy";
  });
  chip.addEventListener("click", () => {
    if (step !== 4) return;
    const nb = block(chip.dataset.kind);
    site.blocks.push(nb);
    canvas.insertBefore(renderBlock(nb), null);
    stripeCanvasBlocks();
    canvas.scrollTop = canvas.scrollHeight;
  });
});

/* ---- generator ---- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function blockHTML(b) {
  switch (b.kind) {
    case "heading":
      return "<h2>" + esc(b.text) + "</h2>";
    case "text":
      return "<p>" + esc(b.text) + "</p>";
    case "button":
      return '<p class="center"><a class="s-btn" href="#">' + esc(b.text) + "</a></p>";
    case "image":
      return '<img src="' + esc(b.src) + '" alt="" loading="lazy" />';
    case "features":
      return (
        "<ul class=\"features\">" +
        b.items.map((i) => "<li>" + esc(i) + "</li>").join("") +
        "</ul>"
      );
    case "gallery":
      return '<div class="gallery"><div></div><div></div><div></div></div>';
    case "testimonials":
      return (
        '<ul class="testimonials">' +
        b.items
          .map(
            (i) =>
              "<li><p>&ldquo;" +
              esc(i) +
              "&rdquo;</p></li>"
          )
          .join("") +
        "</ul>"
      );
    case "pricing":
      return (
        '<ul class="pricing">' +
        b.items.map((i) => "<li>" + esc(i) + '</li>').join("") +
        "</ul>"
      );
    case "stats":
      return (
        '<ul class="stats">' +
        b.items.map((i) => "<li>" + esc(i) + "</li>").join("") +
        "</ul>"
      );
    case "form":
      return (
        '<form class="c-form" onsubmit="event.preventDefault();this.reset();alert(\'Message sent!\');">' +
        '<input type="text" placeholder="Your name" required />' +
        '<input type="email" placeholder="Your email" required />' +
        '<textarea rows="4" placeholder="Your message" required></textarea>' +
        "<button>Send</button></form>"
      );
  }
  return "";
}

function hexRgba(hex, a) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return (
    "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"
  );
}

function buildSiteHTML() {
  const fonts = {
    sans: '"Segoe UI", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Courier New", monospace',
  };
  const contact = [];
  if (site.email) contact.push("<span>" + esc(site.email) + "</span>");
  if (site.phone) contact.push("<span>" + esc(site.phone) + "</span>");

  const heroTitle = site.heroTitle.trim() || site.name || "My Website";
  const heroSub = site.heroSub.trim() || site.tagline;
  const heroStyle = site.heroImg
    ? "background-image:url(" + site.heroImg + ")"
    : "background-image:radial-gradient(90% 130% at 50% 0%," +
      hexRgba(site.accent, 0.28) +
      " 0%,transparent 62%)";

  let navLinks = '<a href="#top">Home</a>';
  const sections = site.blocks.map((b, i) => {
    const inner = blockHTML(b);
    if (!inner) return "";
    const id = b.name ? ' id="sec-' + i + '"' : "";
    if (b.name)
      navLinks += '<a href="#sec-' + i + '">' + esc(b.name) + "</a>";
    return "<section class=\"rv\"" + id + ">" + inner + "</section>";
  });
  navLinks += '<a href="#contact">Contact</a>';

  return [
"<!DOCTYPE html>",
'<html lang="en">',
"<head>",
'<meta charset="UTF-8" />',
'<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
"<title>" + esc(site.name || "My Website") + "</title>",
'<meta name="description" content="' + esc(site.tagline || site.about || "Built with Phidagency Studio") + '" />',
site.domain
  ? '<link rel="canonical" href="https://' + esc(site.domain) + '/" />\n<meta property="og:url" content="https://' + esc(site.domain) + '/" />'
  : "",
'<meta property="og:title" content="' + esc(site.name || "My Website") + '" />',
'<meta property="og:description" content="' + esc(site.tagline) + '" />',
"<style>",
"*{margin:0;padding:0;box-sizing:border-box}",
"html{scroll-behavior:smooth}",
"body{background:linear-gradient(160deg," + hexRgba(site.accent, 0.1) + ",transparent 42%),radial-gradient(120% 90% at 50% -10%," + hexRgba(site.accent, 0.14) + ",transparent 55%)," + site.bg + ";color:" + site.text + ";font-family:" + fonts[site.font] + ";line-height:1.6;background-attachment:fixed}",
".wrap{max-width:1000px;margin:0 auto;padding:0 22px}",
"nav{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:15px 22px;border-bottom:1px solid " + hexRgba(site.text, 0.12) + ";background:" + hexRgba(site.bg, 0.82) + ";backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}",
"nav b{font-size:1.15rem;letter-spacing:.02em;white-space:nowrap}",
"nav .links{display:flex;gap:4px;overflow-x:auto}",
"nav a{color:" + site.text + ";opacity:.72;text-decoration:none;font-size:.9rem;padding:6px 12px;border-radius:8px;white-space:nowrap;transition:opacity .25s,background .25s}",
"nav a:hover{opacity:1;background:" + hexRgba(site.accent, 0.16) + "}",
".hero{position:relative;text-align:center;padding:clamp(70px,14vw,130px) 20px;background-size:cover;background-position:center}",
".hero .shade{position:absolute;inset:0;background:linear-gradient(180deg," + hexRgba("#000000", 0.18) + "," + hexRgba("#000000", 0.58) + ");pointer-events:none}",
".hero-in{position:relative}",
".hero h1{font-size:clamp(2.1rem,6vw,3.4rem);text-shadow:0 2px 24px rgba(0,0,0,.35)}",
".hero p{opacity:.88;margin:12px auto 0;max-width:560px;font-size:1.08rem}",
".hero .s-btn{margin-top:26px}",
"main{padding:10px 22px 50px}",
"main section{margin-top:48px;padding:26px;border-radius:16px;background:" + hexRgba(site.text, 0.035) + "}",
"main section:nth-child(even){background:" + hexRgba(site.accent, 0.07) + "}",
"h2{margin-bottom:12px;font-size:1.45rem}",
"p{margin:10px 0}",
"a.s-btn{display:inline-block;background:" + site.accent + ";color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;transition:transform .25s,box-shadow .25s}",
"a.s-btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px " + hexRgba(site.accent, 0.4) + "}",
"img{max-width:100%;border-radius:12px;display:block}",
"ul.features,ul.testimonials,ul.pricing,ul.stats{list-style:none;margin-top:14px}",
"ul.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}",
"ul.features li{border:2px solid " + hexRgba(site.accent, 0.2) + ";border-radius:12px;padding:22px 12px;text-align:center;background:" + hexRgba(site.accent, 0.05) + ";transition:transform .25s}",
"ul.features li:hover{transform:translateY(-4px)}",
"ul.testimonials{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}",
"ul.testimonials li{border-left:4px solid " + site.accent + ";border-radius:12px;padding:18px;background:" + hexRgba(site.text, 0.04) + ";font-style:italic}",
".gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:14px}",
".gallery div{aspect-ratio:4/3;border-radius:12px;background:linear-gradient(135deg," + site.accent + ",transparent)}",
"ul.pricing{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}",
"ul.pricing li{border:1px solid " + hexRgba(site.text, 0.15) + ";border-top:4px solid " + site.accent + ";border-radius:12px;padding:26px 14px;text-align:center;font-weight:700;font-size:1.02rem;transition:transform .25s}",
"ul.pricing li:hover{transform:translateY(-4px)}",
"ul.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:14px;text-align:center}",
"ul.stats li{font-size:1.5rem;font-weight:800;color:" + site.accent + "}",
".c-form{display:grid;gap:10px;max-width:420px;margin:16px auto}",
'.c-form input,.c-form textarea{padding:12px;border-radius:9px;border:2px solid ' + hexRgba(site.accent, 0.33) + ';background:' + site.bg + ';color:' + site.text + ';font-family:inherit}',
'.c-form input:focus,.c-form textarea:focus{outline:none;border-color:' + site.accent + '}',
".c-form button{padding:12px;border:none;border-radius:9px;background:" + site.accent + ";color:#fff;font-weight:700;cursor:pointer}",
"footer{border-top:1px solid " + hexRgba(site.text, 0.13) + ";padding:30px 0;text-align:center;font-size:.85rem;opacity:.78;display:grid;gap:6px}",
".rv{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s ease}",
".rv.in{opacity:1;transform:none}",
"@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.rv{opacity:1;transform:none;transition:none}}",
"</style>",
"</head>",
"<body>",
'<nav><b>' + esc(site.name || "My Website") + '</b><span class="links">' + navLinks + "</span></nav>",
'<header class="hero" id="top" style="' + heroStyle + '"><div class="shade"></div>',
'<div class="hero-in"><h1>' + esc(heroTitle) + "</h1>",
"<p>" + esc(heroSub) + "</p>",
site.heroBtn.trim() ? '<a class="s-btn" href="#contact">' + esc(site.heroBtn) + "</a>" : "",
"</div></header>",
'<main class="wrap">',
sections.join("\n"),
"</main>",
'<footer id="contact">' + esc(site.name || "My Website") + " &copy; " + new Date().getFullYear(),
contact.join(""),
"<small>Made with Phidagency Studio</small>",
"</footer>",
"<script>",
"const io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});",
"document.querySelectorAll('.rv').forEach(function(el){io.observe(el)});",
"<\/script>",
"</body>",
"</html>",
  ].join("\n");
}

/* ---- preview & download ---- */
document.getElementById("btn-preview").addEventListener("click", () => {
  goStep(4);
  prepareBuild();
  const blob = new Blob([buildSiteHTML()], { type: "text/html" });
  window.open(URL.createObjectURL(blob), "_blank");
});

document.getElementById("btn-download").addEventListener("click", () => {
  prepareBuild();
  const blob = new Blob([buildSiteHTML()], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "index.html";
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ---- publish built site to a public link (Cloudinary raw hosting) ---- */
async function publishSiteHtml(html, name) {
  const slug =
    (name || "my-site").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "site";
  const publicId = slug + "-" + Date.now().toString(36) + ".html";
  const fd = new FormData();
  fd.append(
    "file",
    new File([html], publicId, { type: "text/html" })
  );
  fd.append("upload_preset", UPLOAD_PRESET);
  fd.append("public_id", publicId);
  const res = await fetch(
    "https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/raw/upload",
    { method: "POST", body: fd }
  );
  if (!res.ok) throw new Error("Publish failed");
  const json = await res.json();
  const rawUrl =
    "https://res.cloudinary.com/" + CLOUD_NAME + "/raw/upload/" + json.public_id;
  // shareable link starts with the domain the portfolio is hosted on
  return (
    location.origin + location.pathname + "#/s/" + encodeURIComponent(rawUrl)
  );
}

const publishResult = document.getElementById("publish-result");
const publishUrlInput = document.getElementById("publish-url");

document.getElementById("btn-publish").addEventListener("click", async () => {
  prepareBuild();
  const btn = document.getElementById("btn-publish");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';
  try {
    const url = await publishSiteHtml(buildSiteHTML(), site.name);
    publishUrlInput.value = url;
    publishResult.hidden = false;
    if (currentId) {
      setDoc(
        doc(db, "studioSites", currentId),
        { publishedUrl: url },
        { merge: true }
      ).catch(() => {});
    }
  } catch (e) {
    alert("Publishing failed — please try again.");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-globe"></i> Publish &amp; Get Link';
});

document.getElementById("publish-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(publishUrlInput.value).catch(() => {
    publishUrlInput.select();
    document.execCommand("copy");
  });
});

/* ---- saved sites (Firestore) ---- */
function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

async function refreshStudioSites() {
  try {
    const sn = await getDocs(collection(db, "studioSites"));
    studioSitesCache = sn.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("studioSites:", e.message);
    studioSitesCache = [];
  }
refreshStudioSites();
}

const saveLabel = document.getElementById("save-label");

document.getElementById("btn-save").addEventListener("click", () => {
  prepareBuild();
  const data = deepClone({ ...site, blocks: site.blocks });
  const payload = { name: site.name || "Untitled Site", savedAt: Date.now(), data };

  if (currentId) {
    setDoc(doc(db, "studioSites", currentId), payload)
      .then(() => refreshStudioSites())
      .catch((e) => alert("Save failed: " + e.message));
  } else {
    addDoc(collection(db, "studioSites"), payload)
      .then((ref) => {
        currentId = ref.id;
        return refreshStudioSites();
      })
      .catch((e) => alert("Save failed: " + e.message));
  }
  saveLabel.textContent = "Saved!";
  setTimeout(() => (saveLabel.textContent = "Save Site Here"), 1800);
});

function populateInputs() {
  document.getElementById("ws-name").value = site.name;
  document.getElementById("ws-tagline").value = site.tagline;
  document.getElementById("ws-about").value = site.about;
  document.getElementById("ws-email").value = site.email;
  document.getElementById("ws-phone").value = site.phone;
  document.getElementById("ws-bg").value = site.bg;
  document.getElementById("ws-text").value = site.text;
  document.getElementById("ws-accent").value = site.accent;
  document.getElementById("ws-font").value = site.font;
  document.getElementById("ws-domain").value = site.domain || "";
  document.querySelectorAll(".type-card").forEach((c) =>
    c.classList.toggle("selected", c.dataset.type === site.type)
  );
}

function openSaved(id) {
  const entry = studioSitesCache.find((s) => s.id === id);
  if (!entry) return;
  Object.assign(site, deepClone(entry.data));
  let maxId = 0;
  site.blocks.forEach((b) => (maxId = Math.max(maxId, b.id)));
  uid = maxId + 1;
  currentId = id;
  populateInputs();
  goStep(4);
  paintCanvas();
}

function downloadSaved(id) {
  const prev = deepClone({ ...site, blocks: site.blocks });
  const prevId = currentId;
  const entry = studioSitesCache.find((s) => s.id === id);
  if (!entry) return;
  Object.assign(site, deepClone(entry.data));
  const blob = new Blob([buildSiteHTML()], { type: "text/html" });
  Object.assign(site, prev);
  currentId = prevId;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    (entry.data.name || "site").toLowerCase().replace(/[^a-z0-9]+/g, "-") +
    ".html";
  a.click();
  URL.revokeObjectURL(a.href);
}

function deleteSaved(id) {
  if (!confirm("Delete this saved site?")) return;
  deleteDoc(doc(db, "studioSites", id))
    .then(() => refreshStudioSites())
    .catch((e) => alert(e.message));
  if (currentId === id) currentId = null;
}

const savedListEl = document.getElementById("saved-list");

function renderSavedList() {
  savedListEl.innerHTML = "";
  if (!studioSitesCache.length) {
    const p = document.createElement("p");
    p.className = "saved-empty";
    p.textContent =
      "Nothing saved yet — build a site above and click \u201CSave Site Here\u201D.";
    savedListEl.appendChild(p);
    return;
  }
  studioSitesCache
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt)
    .forEach((entry) => {
      const row = document.createElement("div");
      row.className = "saved-item";

      const info = document.createElement("div");
      info.className = "s-info";
      const strong = document.createElement("strong");
      strong.textContent = entry.data.name || "Untitled Site";
      const small = document.createElement("small");
      small.textContent =
        TYPE_META[entry.data.type]?.label +
        (entry.data.domain ? " \u00B7 " + entry.data.domain : "") +
        " \u00B7 saved " +
        new Date(entry.savedAt).toLocaleDateString();
      info.append(strong, small);

      const actions = document.createElement("div");
      actions.className = "s-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "mini-btn";
      editBtn.innerHTML = '<i class="fas fa-pen"></i> Edit';
      editBtn.addEventListener("click", () => openSaved(entry.id));

      const dlBtn = document.createElement("button");
      dlBtn.className = "mini-btn";
      dlBtn.innerHTML = '<i class="fas fa-download"></i>';
      dlBtn.title = "Download";
      dlBtn.addEventListener("click", () => downloadSaved(entry.id));

      const delBtn = document.createElement("button");
      delBtn.className = "mini-btn danger";
      delBtn.innerHTML = '<i class="fas fa-trash"></i>';
      delBtn.title = "Delete";
      delBtn.addEventListener("click", () => deleteSaved(entry.id));

      actions.append(editBtn, dlBtn, delBtn);
      row.append(info, actions);
      savedListEl.appendChild(row);
    });
}

/* ---- skill bars animation ---- */
const skillsSection = document.getElementById("skills");

if (skillsSection) {
  const skillObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          skillsSection.querySelectorAll(".bar span").forEach((s) => {
            s.style.width = s.dataset.level + "%";
          });
          skillObserver.disconnect();
        }
      });
    },
    { threshold: 0.25 }
  );
  skillObserver.observe(skillsSection);
}

/* ================= ADMIN DASHBOARD (Firestore-backed) ================= */
let currentUser = null;
let siteData = {
  socials: { github: "", linkedin: "", x: "", instagram: "", tiktok: "" },
  heroImg: "",
  contact: { email: "", phone: "", location: "" },
  projects: {},
  removed: [],
  customs: [],
};
let appsCache = [];
let studioSitesCache = [];

onAuthStateChanged(fbAuth, (user) => {
  currentUser = user;
  if (user) loadApps();
  else {
    appsCache = [];
    updateAppsBadge();
    renderAdminApps();
  }
});

async function loadContent() {
  try {
    const snap = await getDoc(doc(db, "config", "site"));
    if (snap.exists()) Object.assign(siteData, snap.data());
  } catch (e) {
    console.warn("loadContent:", e.message);
  }
  applyContent();
}

function getContent() {
  return siteData;
}

function setContent(patch) {
  Object.assign(siteData, patch);
  setDoc(doc(db, "config", "site"), JSON.parse(JSON.stringify(siteData))).catch(
    (e) => alert("Save failed: " + e.message)
  );
  applyContent();
}

async function loadApps() {
  try {
    const sn = await getDocs(collection(db, "applications"));
    appsCache = sn.docs.map((d) => ({ id: d.id, ...d.data() }));
    appsCache.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
  } catch (e) {
    console.warn("loadApps:", e.message);
    appsCache = [];
  }
  updateAppsBadge();
}

function updateAppsBadge() {
  const badge = document.getElementById("apps-badge");
  if (!badge) return;
  if (!currentUser) {
    badge.hidden = true;
    return;
  }
  const unseen = appsCache.filter((a) => !a.seen).length;
  badge.hidden = unseen === 0;
  badge.textContent = unseen;
}

/* ---- apply stored content across the site ---- */
const SOCIAL_SELECTORS = {
  github: 'a[aria-label="GitHub"]',
  linkedin: 'a[aria-label="LinkedIn"]',
  x: 'a[aria-label="X / Twitter"]',
  instagram: 'a[aria-label="Instagram"]',
  tiktok: 'a[aria-label="TikTok"]',
};

const DEFAULT_PROJECT_URLS = {};

function applyContent() {
  const c = getContent();

  Object.entries(SOCIAL_SELECTORS).forEach(([key, sel]) => {
    document.querySelectorAll(sel).forEach((a) => {
      a.href = c.socials[key] || "#";
      a.target = c.socials[key] ? "_blank" : "";
      a.rel = "noopener";
    });
  });

  if (c.heroImg) {
    const heroImg = document.querySelector(".hero-image img");
    if (heroImg) heroImg.src = c.heroImg;
  }

  if (c.contact.email) {
    document.querySelectorAll(".contact-email").forEach((a) => {
      a.textContent = c.contact.email;
      a.href = "mailto:" + c.contact.email;
    });
  }
  if (c.contact.phone) {
    document.querySelectorAll(".contact-phone").forEach((a) => {
      a.textContent = c.contact.phone;
      a.href = "https://wa.me/" + c.contact.phone.replace(/[^0-9]/g, "");
    });
  }
  if (c.contact.location) {
    document
      .querySelectorAll(".contact-location")
      .forEach((el) => (el.textContent = c.contact.location));
  }

  document.querySelectorAll(".project-item").forEach((card) => {
    const title = card.querySelector("span")?.textContent.trim();
    if (title) {
      if ((getContent().removed || []).includes(title)) {
        card.style.display = "none";
      }
      if (c.projects[title]) card.dataset.link = c.projects[title];
      const img = card.querySelector(".card-thumb img");
      if (img && card.dataset.link) img.src = previewUrl(card.dataset.link);
    }
  });

  renderCustomProjectCards();

  const preview = document.getElementById("ad-hero-preview");
  if (preview) preview.src = c.heroImg || "phidagency.png";
}

/* ---- capture form submissions as applications (Firestore) ---- */
["message-form", "apply-form"].forEach((formId) => {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("submit", () => {
    const fd = new FormData(form);
    addDoc(collection(db, "applications"), {
      kind: formId === "message-form" ? "Message" : "Application",
      name: fd.get("name") || "",
      email: fd.get("email") || "",
      detail: fd.get("type")
        ? fd.get("type") + " — " + (fd.get("description") || "")
        : fd.get("message") || "",
      date: new Date().toLocaleString(),
      dateMs: Date.now(),
      seen: false,
    })
      .then(() => loadApps())
      .catch((e) => alert("Could not send: " + e.message));
  });
});

function isLoggedIn() {
  return !!currentUser;
}

/* ---- login / logout ---- */
const loginOverlay = document.getElementById("admin-login");

function openLogin() {
  loginOverlay.hidden = false;
  requestAnimationFrame(() => loginOverlay.classList.add("open"));
  setTimeout(() => document.getElementById("admin-email").focus(), 100);
}

function closeLogin() {
  loginOverlay.classList.remove("open");
  setTimeout(() => (loginOverlay.hidden = true), 250);
}

// hidden entry: tap "Phidalis" in the hero heading
document.getElementById("secret-admin").addEventListener("click", () => {
  if (isLoggedIn()) showView("admin");
  else openLogin();
});

document.getElementById("login-close").addEventListener("click", closeLogin);
loginOverlay.addEventListener("click", (e) => {
  if (e.target === loginOverlay) closeLogin();
});

document.getElementById("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = document.getElementById("admin-email").value.trim();
  const pass = document.getElementById("admin-pass").value;
  signInWithEmailAndPassword(fbAuth, email, pass)
    .then(() => {
      closeLogin();
      document.getElementById("login-error").hidden = true;
      showView("admin");
      openAdmin();
    })
    .catch(() => {
      document.getElementById("login-error").hidden = false;
    });
});

document.getElementById("ad-logout").addEventListener("click", () => {
  fbSignOut(fbAuth).then(() => showView("home"));
});

// guard the admin view behind login + hide header/footer in admin
const origShowView = showView;
showView = function (id) {
  if (id === "admin" && !isLoggedIn()) {
    openLogin();
    return;
  }
  origShowView(id);
  document.body.classList.toggle("admin-mode", id === "admin");
  if (id === "admin") openAdmin();
};

/* ---- admin tabs ---- */
document.querySelectorAll(".atab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".atab")
      .forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".apanel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === tab.dataset.tab);
    });
    if (tab.dataset.tab === "apps") loadApps().then(renderAdminApps);
  });
});

function openAdmin() {
  const c = getContent();
  ["github", "linkedin", "x", "instagram", "tiktok"].forEach((k) => {
    document.getElementById("ad-" + k).value = c.socials[k] || "";
  });
  document.getElementById("ad-email").value = c.contact.email || "";
  document.getElementById("ad-phone").value = c.contact.phone || "";
  document.getElementById("ad-location").value = c.contact.location || "";
  renderAdminProjects();
  updateAppsBadge();
}

/* ---- save socials & contact ---- */
document.getElementById("ad-save-content").addEventListener("click", () => {
  const val = (id) => document.getElementById(id).value.trim();
  setContent({
    ...getContent(),
    socials: {
      github: val("ad-github"),
      linkedin: val("ad-linkedin"),
      x: val("ad-x"),
      instagram: val("ad-instagram"),
      tiktok: val("ad-tiktok"),
    },
    contact: {
      email: val("ad-email"),
      phone: val("ad-phone"),
      location: val("ad-location"),
    },
  });
  flashSaved(document.getElementById("ad-save-content"), "Saved!");
});

function flashSaved(btn, text) {
  const old = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-check"></i> ' + text;
  setTimeout(() => (btn.innerHTML = old), 1600);
}

/* ---- hero image ---- */
const adHeroFile = document.getElementById("ad-hero-file");

document.getElementById("ad-hero-upload").addEventListener("click", () => adHeroFile.click());
adHeroFile.addEventListener("change", async () => {
  const f = adHeroFile.files[0];
  if (!f) return;
  adHeroFile.value = "";
  const btn = document.getElementById("ad-hero-upload");
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
  try {
    const url = await uploadToCloudinary(f);
    setContent({ ...getContent(), heroImg: url });
    document.querySelector(".hero-image img").src = url;
    document.getElementById("ad-hero-preview").src = url;
  } catch (e) {
    alert("Image upload failed — please try again.");
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-upload"></i> Upload New Image';
});

document.getElementById("ad-hero-remove").addEventListener("click", () => {
  setContent({ ...getContent(), heroImg: "" });
  document.querySelector(".hero-image img").src = "phidagency.png";
  document.getElementById("ad-hero-preview").src = "phidagency.png";
});

/* ---- project links manager ---- */
function projectCards() {
  return [...document.querySelectorAll(".project-item")];
}

function removedBuiltins() {
  return getContent().removed || [];
}

function customProjects() {
  return getContent().customs || [];
}

function renderCustomProjectCards() {
  const grid = document.querySelector(".projects-grid");
  if (!grid) return;
  grid.querySelectorAll(".custom-project").forEach((el) => el.remove());
  customProjects().forEach((p, i) => {
    const card = document.createElement("article");
    card.className = "project-item custom-project has-link";
    card.dataset.link = p.link;
    let thumb;
    if (p.link) {
      thumb =
        '<div class="card-thumb"><img alt="' +
        esc(p.title) +
        ' preview" loading="lazy" src="' +
        previewUrl(p.link) +
        '" /></div>';
    } else {
      thumb =
        '<div class="card-thumb thumb-' + ((i % 8) + 1) + '"><span class="thumb-fallback">' +
        esc((p.title || "?").slice(0, 2).toUpperCase()) +
        "</span></div>";
    }
    card.innerHTML =
      thumb +
      "<span>" +
      esc(p.title) +
      '</span><p class="card-desc">' +
      esc(p.desc) +
      "</p>";
    grid.appendChild(card);
  });
  projectCards().forEach((card) => {
    const t = card.querySelector("span")?.textContent.trim();
    if (removedBuiltins().includes(t)) card.style.display = "none";
  });
}

function previewUrl(link) {
  return (
    "https://s.wordpress.com/mshots/v1/" +
    encodeURIComponent(link) +
    "?w=640&h=560"
  );
}

function renderAdminProjects() {
  const listEl = document.getElementById("admin-projects-list");
  const c = getContent();
  listEl.innerHTML = "";

  // built-in projects (deletable, editable link)
  projectCards().forEach((card) => {
    const title = card.querySelector("span")?.textContent.trim();
    if (!title) return;
    if (listEl.querySelector('[data-title="' + title + '"]')) return;
    const row = document.createElement("div");
    row.className = "project-row";
    row.dataset.title = title;
    const label = document.createElement("span");
    label.innerHTML = "<i class='fas fa-link'></i> " + esc(title);
    const input = document.createElement("input");
    input.type = "url";
    input.placeholder = "https://your-live-project.com";
    input.value = c.projects[title] || "";
    const del = document.createElement("button");
    del.className = "mini-btn danger";
    del.innerHTML = '<i class="fas fa-trash"></i>';
    del.title = "Hide this project from the site";
    del.addEventListener("click", () => {
      if (!confirm('Hide "' + title + '"?')) return;
      setContent({
        ...getContent(),
        removed: [...removedBuiltins(), title],
      });
      renderAdminProjects();
    });
    row.append(label, input, del);
    listEl.appendChild(row);
  });

  // custom added projects
  customProjects().forEach((p) => {
    const row = document.createElement("div");
    row.className = "project-row custom";
    row.dataset.customId = p.id;
    const label = document.createElement("span");
    label.innerHTML =
      "<i class='fas fa-star' style='color:#f59e0b'></i> " + esc(p.title);
    const input = document.createElement("input");
    input.type = "url";
    input.value = p.link;
    input.placeholder = "https://...";
    input.addEventListener("change", () => {
      const all = customProjects();
      const t = all.find((x) => x.id === p.id);
      t.link = input.value.trim();
      setContent({ ...getContent(), customs: all });
      applyContent();
    });
    const del = document.createElement("button");
    del.className = "mini-btn danger";
    del.innerHTML = '<i class="fas fa-trash"></i>';
    del.title = "Delete this project permanently";
    del.addEventListener("click", () => {
      if (!confirm('Delete "' + p.title + '" permanently?')) return;
      setContent({
        ...getContent(),
        customs: customProjects().filter((x) => x.id !== p.id),
      });
      applyContent();
      renderAdminProjects();
    });
    row.append(label, input, del);
    listEl.appendChild(row);
  });
}

// add-new-project form
const addProjForm = document.getElementById("add-project-form");

if (addProjForm) {
  addProjForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = document.getElementById("np-title").value.trim();
    const desc = document.getElementById("np-desc").value.trim();
    const link = document.getElementById("np-link").value.trim();
    if (!title) return;
    setContent({
      ...getContent(),
      customs: [
        ...customProjects(),
        { id: Date.now().toString(36), title, desc, link },
      ],
    });
    addProjForm.reset();
    applyContent();
    renderAdminProjects();
  });
}

document.getElementById("ad-save-projects").addEventListener("click", () => {
  const projects = {};
  document
    .querySelectorAll("#admin-projects-list .project-row[data-title]")
    .forEach((row) => {
      const url = row.querySelector("input").value.trim();
      if (url) projects[row.dataset.title] = url;
    });
  setContent({ ...getContent(), projects });
  applyContent();
  flashSaved(document.getElementById("ad-save-projects"), "Links Saved!");
});

/* ---- applications viewer ---- */
function renderAdminApps() {
  const listEl = document.getElementById("admin-apps-list");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!appsCache.length) {
    const p = document.createElement("p");
    p.className = "saved-empty";
    p.textContent = "No messages or applications yet.";
    listEl.appendChild(p);
    return;
  }

  appsCache.forEach((app) => {
    const card = document.createElement("div");
    card.className = "app-card" + (app.seen ? "" : " unseen");

    const head = document.createElement("div");
    head.className = "app-head";
    head.innerHTML =
      "<strong>" + esc(app.name) + "</strong>" +
      '<a href="mailto:' + esc(app.email) + '">' + esc(app.email) + "</a>" +
      '<span class="app-kind">' + esc(app.kind) + "</span>" +
      "<small>" + esc(app.date) + "</small>";

    const body = document.createElement("p");
    body.textContent = app.detail;

    const actions = document.createElement("div");
    actions.className = "row-btns";
    const seenBtn = document.createElement("button");
    seenBtn.className = "mini-btn";
    seenBtn.innerHTML = app.seen
      ? '<i class="fas fa-envelope-open"></i> Seen'
      : '<i class="fas fa-envelope"></i> Mark seen';
    seenBtn.addEventListener("click", () => {
      updateDoc(doc(db, "applications", app.id), { seen: !app.seen })
        .then(() => loadApps().then(renderAdminApps))
        .catch((e) => alert(e.message));
    });
    const delBtn = document.createElement("button");
    delBtn.className = "mini-btn danger";
    delBtn.innerHTML = '<i class="fas fa-trash"></i>';
    delBtn.addEventListener("click", () => {
      deleteDoc(doc(db, "applications", app.id))
        .then(() => loadApps().then(renderAdminApps))
        .catch((e) => alert(e.message));
    });
    actions.append(seenBtn, delBtn);

    card.append(head, body, actions);
    listEl.appendChild(card);
  });
}

document.getElementById("ad-apps-clear").addEventListener("click", () => {
  if (!confirm("Delete ALL messages and applications?")) return;
  getDocs(collection(db, "applications"))
    .then((sn) => {
      const batch = writeBatch(db);
      sn.docs.forEach((d) => batch.delete(d.ref));
      return batch.commit();
    })
    .then(() => loadApps().then(renderAdminApps))
    .catch((e) => alert(e.message));
});

/* ---- account credentials (Firebase Auth) ---- */
document.getElementById("ad-save-account").addEventListener("click", () => {
  const cur = document.getElementById("ad-cur-pass").value;
  const newEmail = document.getElementById("ad-new-email").value.trim();
  const newPass = document.getElementById("ad-new-pass").value;

  if (!currentUser) {
    alert("You are logged out.");
    return;
  }
  if (!cur || (!newEmail && !newPass)) {
    alert("Enter your current password and a new email and/or password.");
    return;
  }

  const cred = EmailAuthProvider.credential(currentUser.email, cur);
  reauthenticateWithCredential(currentUser, cred)
    .then(async () => {
      if (newEmail) await fbUpdateEmail(currentUser, newEmail);
      if (newPass) await fbUpdatePassword(currentUser, newPass);
      document.getElementById("ad-cur-pass").value = "";
      document.getElementById("ad-new-email").value = "";
      document.getElementById("ad-new-pass").value = "";
      alert("Credentials updated.");
    })
    .catch((e) => alert("Update failed: " + e.message));
});

/* ---- boot ---- */
loadContent();
updateAppsBadge();
