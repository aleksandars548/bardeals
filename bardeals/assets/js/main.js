const FORM_ENDPOINT =
"https://script.google.com/macros/s/AKfycbzJ6QaAo_19_NKcOclPvrnL-tTcTI0qxznoFRMaVzpFq_fPYysq6oNWyyetwRHRisvV/exec";

// ====== CONFIG ======
const DEFAULT_CENTER = [48.2082, 16.3738]; // Vienna
const DEFAULT_ZOOM = 11.5;

// If you ever want it to auto-ask for location on load, set true
const AUTO_NEAR_ME_ON_LOAD = false;

let map;
let markersLayer;
let bars = [];
const markersById = {};

// Filters
let activeTimeFilter = "now"; // now | later | tomorrow
let activeArea = "all";

// Categories:
// - "featured" = only featured
// - "all" = all bars
// - otherwise = category name
let activeCategory = "featured";
let showAllOverride = false; // legacy, used by "See all" link

// User location (set by Near me)
let userLocation = null; // {lat, lng}

// Keep last filtered list for Random
let lastFiltered = [];

// ====== ICONS (RED markers + person for user) ======
const BRAND_RED = "#e10600";

function redPinIcon() {
return L.divIcon({
className: "bd-pin",
html: `
<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg">
<path d="M14 0C6.8 0 1 5.8 1 13c0 9.5 13 27 13 27s13-17.5 13-27C27 5.8 21.2 0 14 0z"
fill="#e10600" stroke="#000" stroke-width="2"/>
<circle cx="14" cy="13" r="4.5" fill="#fff" stroke="#000" stroke-width="2"/>
</svg>
`,
iconSize: [28, 40],
iconAnchor: [14, 40],
popupAnchor: [0, -36],
});
}

function userPersonIcon() {
return L.divIcon({
className: "bd-user-dot",
html: `
<div class="bd-user-pulse">
<div class="bd-user-core"></div>
</div>
`,
iconSize: [28, 28],
iconAnchor: [14, 14],
});
}

// ====== MAP VISIBILITY (HIDE MAP UNTIL USER OPENS IT) ======
function showListView() {
document.body.classList.remove("view-map");
document.body.classList.add("view-list");

// If you add CSS later, these classes will be enough.
// As a fallback, force-hide/show via inline styles:
const mapCard = document.querySelector(".map-card");
const listCard = document.querySelector(".list-card");
if (mapCard) mapCard.style.display = "none";
if (listCard) listCard.style.display = "flex";
}

function showMapView(scroll = true) {
document.body.classList.remove("view-list");
document.body.classList.add("view-map");

const mapCard = document.querySelector(".map-card");
const listCard = document.querySelector(".list-card");
if (mapCard) mapCard.style.display = "block";
if (listCard) listCard.style.display = "flex";

// Leaflet needs invalidate after being unhidden
setTimeout(() => map?.invalidateSize?.(), 120);

if (scroll) scrollToMapWithOffset(12);
}

// ====== HOME UI (Foodora-style) ======
function getAllCategories() {
const cats = new Set();
bars.forEach((b) => {
if (b.category) cats.add(b.category);
});
return ["featured", "all", ...Array.from(cats)];
}

// Hero actions
const heroView = document.getElementById("heroViewMapBtn");
const heroNear = document.getElementById("heroNearMeBtn");
const heroSearchInput = document.getElementById("heroSearchInput");
const heroSearchBtn = document.getElementById("heroSearchBtn");

if (heroView)
heroView.addEventListener("click", () => {
showMapView(true);
});

if (heroNear)
heroNear.addEventListener("click", () => {
document.getElementById("nearMeBtn")?.click();
});

if (heroSearchBtn && heroSearchInput) {
heroSearchBtn.addEventListener("click", () => {
const q = heroSearchInput.value.trim();
const main = document.getElementById("searchInput");
if (main) main.value = q;
document.getElementById("searchBtn")?.click();
});
}

function renderCategories() {
const el = document.getElementById("homeCategories");
if (!el) return;

const cats = getAllCategories();

el.innerHTML = cats
.map((c) => {
const label = c === "featured" ? "⭐ Featured" : c === "all" ? "All bars" : escapeHtml(c);

return `
<button class="home-cat ${c === activeCategory ? "active" : ""}" data-cat="${escapeHtml(c)}">
${label}
</button>
`;
})
.join("");
}

function renderFeatured() {
const track = document.getElementById("featuredTrack");
if (!track) return;

const featured = bars.filter((b) => !!b.featured);

track.innerHTML = featured
.map((b, idx) => {
const imgStyle = b.image ? `style="background-image:url('${b.image}')"` : "";
return `
<div class="featured-card" role="button" tabindex="0"
data-focus-id="${escapeHtml(b.id)}"
data-featured-index="${idx}">
<div class="featured-img" ${imgStyle}></div>
<div class="featured-body">
<div class="featured-name">${escapeHtml(b.name)}</div>
</div>
</div>
`;
})
.join("");

track.querySelectorAll(".featured-card").forEach((card) => {
const focusId = card.getAttribute("data-focus-id");
if (!focusId) return;

const openCard = () => {
showMapView(true);
focusBarOnMap(focusId);
};

card.addEventListener("click", openCard);
card.addEventListener("keydown", (e) => {
if (e.key === "Enter" || e.key === " ") {
e.preventDefault();
openCard();
}
});
});

renderFeaturedDots(featured.length);
}

function renderFeaturedDots(count) {
const dots = document.getElementById("featuredDots");
if (!dots) return;

dots.innerHTML = Array.from({ length: count })
.map((_, i) => `<span class="featured-dot ${i === 0 ? "is-active" : ""}" data-dot="${i}"></span>`)
.join("");

const track = document.getElementById("featuredTrack");
if (!track) return;

let raf = null;
track.addEventListener("scroll", () => {
if (raf) cancelAnimationFrame(raf);
raf = requestAnimationFrame(() => {
const cards = track.querySelectorAll(".featured-card");
if (!cards.length) return;

let active = 0;
let best = Infinity;

cards.forEach((c, idx) => {
const rect = c.getBoundingClientRect();
const dist = Math.abs(rect.left - 16);
if (dist < best) {
best = dist;
active = idx;
}
});

dots.querySelectorAll(".featured-dot").forEach((d) => d.classList.remove("is-active"));
const d = dots.querySelector(`.featured-dot[data-dot="${active}"]`);
if (d) d.classList.add("is-active");
});
});
}

// ====== INIT MAP ======
function initMap() {
map = L.map("map", { scrollWheelZoom: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
maxZoom: 19,
attribution: "&copy; OpenStreetMap &copy; CARTO",
}).addTo(map);

markersLayer = L.layerGroup().addTo(map);
}

// ====== LOAD DATA ======
async function loadBars() {
const res = await fetch("data/bars.json");
bars = await res.json();

renderCategories();
renderFeatured();
render();

// Default view = LIST (map hidden)
showListView();

if (AUTO_NEAR_ME_ON_LOAD) {
onNearMe();
}
}

// Scroll to map but keep sticky bars from covering the popup
function scrollToMapWithOffset(extra = 12) {
const mapWrap = document.querySelector(".map-card") || document.getElementById("map");
if (!mapWrap) return 120;

const topbar = document.querySelector(".topbar");
const filters = document.querySelector(".hero .filters");

const offset = (topbar?.offsetHeight || 0) + (filters?.offsetHeight || 0) + extra;

const y = mapWrap.getBoundingClientRect().top + window.pageYOffset - offset;
window.scrollTo({ top: y, behavior: "smooth" });

return offset;
}

// ====== TIME HELPERS ======
function toMinutes(hhmm) {
const [h, m] = String(hhmm).split(":").map(Number);
return h * 60 + (m || 0);
}

function isTimeWithinDeal(nowMin, fromMin, toMin) {
if (fromMin <= toMin) return nowMin >= fromMin && nowMin <= toMin;
return nowMin >= fromMin || nowMin <= toMin; // crosses midnight
}

function dayLabel(daysArr) {
const set = new Set(daysArr || []);
const all = [0, 1, 2, 3, 4, 5, 6].every((d) => set.has(d));
if (all) return "Daily";

const monFri = [1, 2, 3, 4, 5].every((d) => set.has(d)) && !set.has(0) && !set.has(6);
if (monFri) return "Mon–Fri";

const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
return (daysArr || []).map((d) => names[d]).join(", ");
}

// ====== DISTANCE ======
function haversineKm(lat1, lng1, lat2, lng2) {
const R = 6371;
const toRad = (x) => (x * Math.PI) / 180;
const dLat = toRad(lat2 - lat1);
const dLng = toRad(lng2 - lng1);
const a =
Math.sin(dLat / 2) * Math.sin(dLat / 2) +
Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
return R * c;
}

function formatDistance(km) {
if (km == null) return "";
if (km < 1) return `${Math.round(km * 1000)}m`;
return `${km.toFixed(1)}km`;
}

// ====== DEALS (multi-deal aware) ======
function getDealsForBar(bar) {
if (Array.isArray(bar.deals) && bar.deals.length) return bar.deals;
if (bar.deal) return [bar.deal];
return [];
}

function dealStatusForDay(deal, day, nowMin) {
if (!deal || !deal.from || !deal.to || !Array.isArray(deal.days)) return { type: "none" };
if (!deal.days.includes(day)) return { type: "none" };

const fromMin = toMinutes(deal.from);
const toMin = toMinutes(deal.to);

if (isTimeWithinDeal(nowMin, fromMin, toMin)) return { type: "open" };

const crossesMidnight = fromMin > toMin;
if (!crossesMidnight && nowMin < fromMin) return { type: "soon" };
if (crossesMidnight && nowMin < fromMin) return { type: "soon" };

return { type: "ended" };
}

function dealMatchesTimeFilter(bar) {
const deals = getDealsForBar(bar);
if (!deals.length) return true;

const now = new Date();
const today = now.getDay();
const nowMin = now.getHours() * 60 + now.getMinutes();

if (activeTimeFilter === "tomorrow") {
const tomorrow = (today + 1) % 7;
return deals.some((d) => d?.days && d.days.includes(tomorrow));
}

const todaysDeals = deals.filter((d) => d?.days && d.days.includes(today));
if (!todaysDeals.length) return false;

if (activeTimeFilter === "now") {
return todaysDeals.some((d) => dealStatusForDay(d, today, nowMin).type === "open");
}
if (activeTimeFilter === "later") {
return todaysDeals.some((d) => dealStatusForDay(d, today, nowMin).type === "soon");
}

return true;
}

function pickDealForBar(bar) {
const deals = getDealsForBar(bar);
if (!deals.length) return null;

const now = new Date();
const today = now.getDay();
const nowMin = now.getHours() * 60 + now.getMinutes();

if (activeTimeFilter === "tomorrow") {
const tomorrow = (today + 1) % 7;
const candidates = deals
.filter((d) => d?.days?.includes(tomorrow))
.sort((a, b) => toMinutes(a.from) - toMinutes(b.from));
return candidates[0] || null;
}

const todays = deals.filter((d) => d?.days?.includes(today));
if (!todays.length) return deals[0];

if (activeTimeFilter === "now") {
const open = todays.find((d) => dealStatusForDay(d, today, nowMin).type === "open");
return open || todays[0];
}

if (activeTimeFilter === "later") {
const soon = todays
.filter((d) => dealStatusForDay(d, today, nowMin).type === "soon")
.sort((a, b) => toMinutes(a.from) - toMinutes(b.from));
return soon[0] || todays[0];
}

return todays[0];
}

function getStatusForPickedDeal(deal) {
if (!deal) return { type: "ended", label: "No deal info" };

const now = new Date();
const today = now.getDay();
const nowMin = now.getHours() * 60 + now.getMinutes();

if (activeTimeFilter === "tomorrow") return { type: "soon", label: `Tomorrow ${deal.from}` };

const s = dealStatusForDay(deal, today, nowMin).type;
if (s === "open") return { type: "open", label: "Open now" };
if (s === "soon") return { type: "soon", label: `Starts at ${deal.from}` };
return { type: "ended", label: "Ended" };
}

function statusBadgeHtml(status) {
if (status.type === "open") return `<div class="badge badge-open">🟢 ${status.label}</div>`;
if (status.type === "soon") return `<div class="badge badge-soon">🟡 ${status.label}</div>`;
return `<div class="badge badge-ended">🔴 ${status.label}</div>`;
}

// ====== CORE FILTERING ======
function filterBars() {
return bars
.filter((b) => {
if (activeArea !== "all" && b.zip !== activeArea) return false;

if (!showAllOverride) {
if (activeCategory === "featured") {
if (!b.featured) return false;
} else if (activeCategory === "all") {
// show all
} else {
if ((b.category || "") !== activeCategory) return false;
}
} else {
if (activeCategory !== "all" && activeCategory !== "featured") {
if ((b.category || "") !== activeCategory) return false;
}
}

if (!dealMatchesTimeFilter(b)) return false;

return true;
})
.map((b) => {
const distKm = userLocation ? haversineKm(userLocation.lat, userLocation.lng, b.lat, b.lng) : null;
return { ...b, _distKm: distKm };
})
.sort((a, b) => {
const order = { open: 0, soon: 1, ended: 2 };
const sa = getStatusForPickedDeal(pickDealForBar(a)).type;
const sb = getStatusForPickedDeal(pickDealForBar(b)).type;

if (order[sa] !== order[sb]) return order[sa] - order[sb];
if (a._distKm != null && b._distKm != null) return a._distKm - b._distKm;
return a.name.localeCompare(b.name);
});
}

// ====== FOCUS BAR ON MAP ======
function focusBarOnMap(id) {
const b = bars.find((x) => x.id === id);
if (!b) return;

showMapView(true);

const offset = scrollToMapWithOffset(16);
map.setView([b.lat, b.lng], Math.max(map.getZoom(), 15));

const marker = markersById[id];
if (marker) {
marker.openPopup();
setTimeout(() => {
map.panInside([b.lat, b.lng], {
paddingTopLeft: [20, offset + 20],
paddingBottomRight: [20, 120],
});
}, 180);
}
}

// ====== UI RENDER ======
function render() {
const filtered = filterBars();
lastFiltered = filtered;

// Markers
markersLayer.clearLayers();
Object.keys(markersById).forEach((k) => delete markersById[k]);

// User marker
if (userLocation) {
L.marker([userLocation.lat, userLocation.lng], { icon: userPersonIcon() })
.addTo(markersLayer)
.bindPopup("You are here");
}

// Bar markers
filtered.forEach((b) => {
const d = pickDealForBar(b);
const popupHtml = `
<div style="font-weight:800;margin-bottom:4px">${escapeHtml(b.name)}</div>
<div style="font-weight:700;color:#64748b;margin-bottom:6px">
${
d
? `${escapeHtml(dayLabel(d.days))} · ${escapeHtml(d.from)}–${escapeHtml(d.to)}<br/>${escapeHtml(
d.text
)}`
: "Deals vary by day"
}
</div>
<a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}">
Directions
</a>
`;

const m = L.marker([b.lat, b.lng], { icon: redPinIcon() }).bindPopup(popupHtml);
m.addTo(markersLayer);
markersById[b.id] = m;

m.on("click", () => {
showMapView(false);
map.setView([b.lat, b.lng], Math.max(map.getZoom(), 15));
});
});

// List
const list = document.getElementById("dealList");
if (list) list.innerHTML = filtered.map((b) => dealCard(b)).join("");

const rc = document.getElementById("resultCount");
if (rc) rc.textContent = `${filtered.length} result(s)`;
}

// ====== LIST CARD ======
function dealCard(b) {
const deal = pickDealForBar(b);
const dist = formatDistance(b._distKm);
const status = getStatusForPickedDeal(deal);

// day label: show today name instead of "Daily" if you want — keeping your current helper
const daysText = deal?.days ? dayLabel(deal.days) : "";
const fromTo = deal?.from && deal?.to ? `${deal.from} – ${deal.to}` : "";
const whenLine = `${daysText}${fromTo ? " · " + fromTo : ""}`.trim();

// status label (no shadows, clean)
const statusText =
status.type === "open" ? "OPEN NOW" :
status.type === "soon" ? "STARTS LATER" :
"CLOSED";

const statusClass =
status.type === "open" ? "deal-status--open" :
status.type === "soon" ? "deal-status--soon" :
"deal-status--closed";

return `
<div class="deal deal--poster">
<div class="deal-inner">

<div class="deal-top">
<div class="deal-status ${statusClass}">
<span class="dot" aria-hidden="true"></span>
<span>${escapeHtml(statusText)}</span>
</div>

<button class="go go--poster" data-focus-id="${escapeHtml(b.id)}" type="button">
VIEW
</button>
</div>

<h3 class="deal-title">${escapeHtml(b.name)}</h3>

<div class="deal-when">${escapeHtml(whenLine || "See details")}</div>

<div class="deal-offer">
${escapeHtml(deal?.text || "Deals vary by day")}
</div>

<div class="deal-loc">
<span class="pin" aria-hidden="true">📍</span>
<span>${escapeHtml(b.address)}</span>
${dist ? `<span class="sep"> · </span><span class="dist">${escapeHtml(dist)}</span>` : ""}
</div>

<a class="deal-dir" target="_blank" rel="noopener"
href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}">
🗺️ Directions
</a>

</div>
</div>
`;
}

// View button
document.addEventListener("click", (e) => {
const btn = e.target.closest(".go");
if (!btn) return;
const id = btn.dataset.focusId;
if (!id) return;
focusBarOnMap(id);
});

// ====== SEARCH (Nominatim) ======
async function geocode(query) {
const url = new URL("https://nominatim.openstreetmap.org/search");
url.searchParams.set("q", query);
url.searchParams.set("format", "json");
url.searchParams.set("limit", "1");
url.searchParams.set("addressdetails", "1");

const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
const data = await res.json();
if (!data || !data.length) return null;

return {
lat: parseFloat(data[0].lat),
lng: parseFloat(data[0].lon),
displayName: data[0].display_name,
};
}

async function onSearch() {
const input = document.getElementById("searchInput");
const q = (input?.value || "").trim();
if (!q) return;

const result = await geocode(`${q}, Vienna`);
if (!result) {
alert("No results found. Try a different place.");
return;
}

showMapView(true);
map.setView([result.lat, result.lng], 15);

L.popup()
.setLatLng([result.lat, result.lng])
.setContent(`<b>Search result</b><br>${escapeHtml(result.displayName)}`)
.openOn(map);
}

// ====== NEAR ME ======
function onNearMe() {
if (!navigator.geolocation) {
alert("Geolocation not supported in this browser.");
return;
}

navigator.geolocation.getCurrentPosition(
(pos) => {
userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
showMapView(true);
map.setView([userLocation.lat, userLocation.lng], 15);
render();
},
(err) => {
alert("Could not get your location. Please allow location permission.");
console.warn(err);
},
{ enableHighAccuracy: true, timeout: 8000 }
);
}

// ====== FILTERS + HOME CATEGORIES ======
function setTimeFilter(val) {
activeTimeFilter = val;

document.querySelectorAll(".bd-group .bd-btn").forEach((b) => b.classList.remove("bd-btn--active"));
const btn = document.querySelector(`.bd-group .bd-btn[data-time="${val}"]`);
if (btn) btn.classList.add("bd-btn--active");

render();
}

function initUI() {
document.getElementById("searchBtn")?.addEventListener("click", onSearch);
document.getElementById("searchInput")?.addEventListener("keydown", (e) => {
if (e.key === "Enter") onSearch();
});

document.getElementById("nearMeBtn")?.addEventListener("click", onNearMe);

document.getElementById("seeAllFeatured")?.addEventListener("click", (e) => {
e.preventDefault();
showAllOverride = true;
activeCategory = "all";
renderCategories();
render();
showListView();
});

document.querySelectorAll(".bd-group .bd-btn[data-time]").forEach((btn) => {
btn.addEventListener("click", () => setTimeFilter(btn.dataset.time));
});

document.getElementById("areaSelect")?.addEventListener("change", (e) => {
activeArea = e.target.value;
render();
});

document.getElementById("homeCategories")?.addEventListener("click", (e) => {
const btn = e.target.closest("[data-cat]");
if (!btn) return;

activeCategory = btn.dataset.cat || "featured";
showAllOverride = false;

renderCategories();
render();
showListView();
});

// Bottom nav
document.getElementById("bnList")?.addEventListener("click", () => {
showListView();
document.querySelector(".list-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("bnMap")?.addEventListener("click", () => {
showMapView(true);
});

// Random if exists
document.getElementById("bnRandom")?.addEventListener("click", () => {
if (!lastFiltered.length) return;
const pick = lastFiltered[Math.floor(Math.random() * lastFiltered.length)];
if (pick?.id) focusBarOnMap(pick.id);
});

// Add modal
document.getElementById("bnAdd")?.addEventListener("click", (e) => {
e.preventDefault();
openModal("add");
});

// Footer quick actions (safe)
document.getElementById("footerNowOpen")?.addEventListener("click", (e) => {
e.preventDefault();
setTimeFilter("now");
showMapView(true);
});

document.getElementById("footerNearMe")?.addEventListener("click", (e) => {
e.preventDefault();
onNearMe();
});

document.getElementById("footerAllAreas")?.addEventListener("click", (e) => {
e.preventDefault();
activeArea = "all";
const sel = document.getElementById("areaSelect");
if (sel) sel.value = "all";
render();
});

document.getElementById("footerViewMap")?.addEventListener("click", (e) => {
e.preventDefault();
showMapView(true);
});
}

// ====== MODAL OPEN ======
function openModal(type) {
const modal = document.getElementById("modal");
const title = document.getElementById("modalTitle");
const form = document.getElementById("dealForm");
const typeInput = document.getElementById("formType");
const reportNoteWrap = document.getElementById("reportNoteWrap");
const status = document.getElementById("formStatus");

if (!modal || !title || !form || !typeInput || !reportNoteWrap || !status) return;

modal.classList.add("is-open");
modal.setAttribute("aria-hidden", "false");
status.textContent = "";
form.reset();

if (type === "report") {
title.textContent = "Report outdated deal";
typeInput.value = "report";
reportNoteWrap.style.display = "flex";
} else {
title.textContent = "Add your bar";
typeInput.value = "add";
reportNoteWrap.style.display = "none";
}
}

// ====== MODAL + FORMS ======
function initForms() {
const modal = document.getElementById("modal");
const closeBtn = document.getElementById("modalClose");
const backdrop = document.getElementById("modalBackdrop");

const addBtn = document.getElementById("addBarBtn");
const reportBtn = document.getElementById("reportBtn");
const reportBtn2 = document.getElementById("reportBtn2");

const footerAdd = document.getElementById("footerAddBar");
const footerReport = document.getElementById("footerReport");

const form = document.getElementById("dealForm");
const status = document.getElementById("formStatus");
const submitBtn = document.getElementById("submitBtn");

if (!modal || !form || !status) {
console.warn("Modal/form elements not found. Check index.html IDs.");
return;
}

function close() {
modal.classList.remove("is-open");
modal.setAttribute("aria-hidden", "true");
}

addBtn?.addEventListener("click", (e) => {
e.preventDefault();
openModal("add");
});
reportBtn?.addEventListener("click", (e) => {
e.preventDefault();
openModal("report");
});
reportBtn2?.addEventListener("click", (e) => {
e.preventDefault();
openModal("report");
});

footerAdd?.addEventListener("click", (e) => {
e.preventDefault();
openModal("add");
});
footerReport?.addEventListener("click", (e) => {
e.preventDefault();
openModal("report");
});

closeBtn?.addEventListener("click", (e) => {
e.preventDefault();
close();
});
backdrop?.addEventListener("click", (e) => {
e.preventDefault();
close();
});
document.addEventListener("keydown", (e) => {
if (e.key === "Escape") close();
});

form.addEventListener("submit", async (e) => {
e.preventDefault();

if (!FORM_ENDPOINT) {
status.textContent = "Form endpoint not set.";
return;
}

status.textContent = "Submitting...";
if (submitBtn) submitBtn.disabled = true;

const payload = Object.fromEntries(new FormData(form).entries());
payload.timestamp = new Date().toISOString();
payload.page = location.origin + location.pathname;
payload.user_agent = navigator.userAgent;
payload.ip_hint = "";
payload.source = "website_form";

const params = new URLSearchParams(payload);

try {
await fetch(FORM_ENDPOINT, {
method: "POST",
mode: "no-cors",
headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
body: params.toString(),
});

status.textContent = "Thanks! Submitted ✅";
form.reset();
setTimeout(() => close(), 900);
} catch (err) {
console.warn(err);
status.textContent = "Could not submit. Try again later.";
} finally {
if (submitBtn) submitBtn.disabled = false;
}
});
}

// Action bar view
document.getElementById("actionViewMap")?.addEventListener("click", () => {
showMapView(true);
});

// Mobile hamburger menu
const navBurger = document.getElementById("navBurger");
const mobileMenu = document.getElementById("mobileMenu");

if (navBurger && mobileMenu) {
navBurger.addEventListener("click", () => {
const isOpen = navBurger.classList.toggle("is-open");
navBurger.setAttribute("aria-expanded", String(isOpen));
mobileMenu.classList.toggle("is-open", isOpen);
mobileMenu.setAttribute("aria-hidden", String(!isOpen));
});

mobileMenu.querySelectorAll("a").forEach((a) => {
a.addEventListener("click", () => {
navBurger.classList.remove("is-open");
navBurger.setAttribute("aria-expanded", "false");
mobileMenu.classList.remove("is-open");
mobileMenu.setAttribute("aria-hidden", "true");
});
});
}

// ====== HELPERS ======
function escapeHtml(str) {
return String(str ?? "")
.replaceAll("&", "&amp;")
.replaceAll("<", "&lt;")
.replaceAll(">", "&gt;")
.replaceAll('"', "&quot;")
.replaceAll("'", "&#039;");
}

// ====== BOOT ======
initMap();
initUI();
initForms();
loadBars();